/**
 * Shared contract for the HYBRID sync data path: the phone acting as a BLE
 * gateway for a Greenr sensor.
 *
 * The battery idea (see the engineering review §00): a Wi-Fi upload costs
 * ~100–180 mA for several seconds; a BLE exchange costs a fraction of that. So
 * when someone is home, their phone collects the sensor's buffered readings over
 * BLE and uploads them to the cloud — the sensor's expensive Wi-Fi radio stays
 * off. When nobody's phone has been in range for a while (they're away/on
 * vacation), the sensor falls back to Wi-Fi on its own so the cloud stays fresh.
 *
 * This file is the transport-agnostic contract; wifiSetup-style platform splits
 * (bleGateway.ts = web, bleGateway.native.ts = native) implement it so the web
 * bundle never imports the native BLE module. The UUIDs MUST match the firmware
 * data service.
 */

// Distinct from the provisioning service (c0de0001…). This is the always-on
// data service the sensor exposes during its short awake window each cycle.
export const DATA_SERVICE = 'c0de0010-feed-4b1e-9d0b-c0ffee000001';
/** read: JSON of the device id + firmware + buffered readings (see BleBatch) */
export const CHAR_DATA = 'c0de0011-feed-4b1e-9d0b-c0ffee000001';
/** write: the number of readings the phone successfully uploaded → sensor drops
 *  them and records "a phone was here" (so it can skip its Wi-Fi fallback) */
export const CHAR_ACK = 'c0de0012-feed-4b1e-9d0b-c0ffee000001';

/** One buffered reading as the sensor reports it over BLE. `ago` = seconds
 *  before the moment of transfer (so the phone can reconstruct real timestamps
 *  even for readings captured hours earlier). */
export interface BleReading {
  ago: number; // seconds ago
  l?: number; // light index 0–100
  d?: number; // DLI so far today
  s?: number; // soil %
  t?: number; // temp °C
  h?: number; // humidity %
  b?: number; // battery % (−1 / omitted = unmeasured)
}

export interface BleBatch {
  /** the device's Supabase id (uuid) — which `devices` row these belong to */
  dev: string;
  /** firmware version, for diagnostics */
  fw?: string;
  rows: BleReading[];
}

/** Rows shaped for the ingest_batch RPC: absolute timestamps computed on the
 *  phone from each reading's `ago` against the phone's clock. */
export interface IngestRow {
  at: string; // ISO timestamp
  light_lux: number | null;
  dli: number | null;
  soil_pct: number | null;
  temp_c: number | null;
  humidity_pct: number | null;
  battery_pct: number | null;
}

export function batchToIngestRows(batch: BleBatch, now = Date.now()): IngestRow[] {
  return batch.rows.map((r) => ({
    at: new Date(now - Math.max(0, r.ago) * 1000).toISOString(),
    light_lux: r.l ?? null,
    dli: r.d ?? null,
    soil_pct: r.s ?? null,
    temp_c: r.t ?? null,
    humidity_pct: r.h ?? null,
    battery_pct: r.b == null || r.b < 0 ? null : r.b,
  }));
}

export function parseBatch(raw: string): BleBatch | null {
  try {
    const o = JSON.parse(raw);
    if (o && typeof o.dev === 'string' && Array.isArray(o.rows)) {
      return { dev: o.dev, fw: typeof o.fw === 'string' ? o.fw : undefined, rows: o.rows };
    }
  } catch {
    // malformed — ignore this window, try again next time
  }
  return null;
}

export interface SyncResult {
  deviceId: string;
  uploaded: number;
}

/**
 * Upload a batch the phone collected over BLE. Authenticates as the signed-in
 * USER (who owns the device) via the ingest_batch RPC — the device secret never
 * travels over Bluetooth. Returns how many rows the server inserted.
 */
export async function uploadBatch(batch: BleBatch): Promise<number> {
  const { supabase } = await import('./supabase');
  if (!supabase) return 0;
  const rows = batchToIngestRows(batch);
  if (!rows.length) return 0;
  const { data, error } = await supabase.rpc('ingest_batch', { p_device: batch.dev, p_rows: rows });
  if (error) throw new Error(error.message);
  const inserted = data && typeof (data as { inserted?: number }).inserted === 'number'
    ? (data as { inserted: number }).inserted
    : rows.length;
  return inserted;
}

