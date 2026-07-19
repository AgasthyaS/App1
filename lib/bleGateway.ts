import {
  CHAR_ACK,
  CHAR_DATA,
  DATA_SERVICE,
  parseBatch,
  uploadBatch,
  type SyncResult,
} from './bleGatewayTypes';

/**
 * WEB implementation of the phone-as-gateway sync (default resolution; native
 * platforms use bleGateway.native.ts).
 *
 * Web Bluetooth cannot scan in the background or passively listen for
 * advertisements — every connection needs a user gesture and the browser's
 * device chooser. So on web this is a MANUAL "sync a nearby sensor now" action,
 * not the automatic home gateway. The phone app (native) does the real
 * background version; the sensor's own Wi-Fi fallback covers everything else.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const g: any = typeof globalThis !== 'undefined' ? globalThis : {};

export const isSupported = typeof g.navigator?.bluetooth?.requestDevice === 'function';
/** Web can't run a background gateway — reflected in the UI. */
export const supportsBackground = false;

export function startGateway(): void { /* no-op on web */ }
export function stopGateway(): void { /* no-op on web */ }

/** Manual sync: pick a nearby Greenr sensor, drain its buffer to the cloud. */
export async function syncNow(): Promise<SyncResult[]> {
  const device = await g.navigator.bluetooth.requestDevice({ filters: [{ services: [DATA_SERVICE] }] });
  const server = await device.gatt.connect();
  const svc = await server.getPrimaryService(DATA_SERVICE);
  const dataChar = await svc.getCharacteristic(CHAR_DATA);
  const ackChar = await svc.getCharacteristic(CHAR_ACK);

  let uploaded = 0;
  let deviceId = '';
  const dec = new TextDecoder();
  const enc = new TextEncoder();

  // Drain in batches: read → upload → ACK (sensor then serves the next batch).
  for (let i = 0; i < 16; i++) {
    const batch = parseBatch(dec.decode(await dataChar.readValue()));
    if (!batch || batch.rows.length === 0) break;
    deviceId = batch.dev;
    const n = await uploadBatch(batch);
    await ackChar.writeValue(enc.encode(String(batch.rows.length)));
    uploaded += n;
    if (batch.rows.length < 8) break; // last (partial) batch
  }
  try { device.gatt?.disconnect(); } catch { /* already gone */ }
  return deviceId ? [{ deviceId, uploaded }] : [];
}
