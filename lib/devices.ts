import { relTime } from './format';
import { supabase } from './supabase';

/**
 * Client helpers for the physical sensors. Pairing is a claim: the QR code
 * carries the device id + key; register_device links it to the signed-in user.
 * Readings are read straight from the `readings` table (RLS shows only yours).
 */

export interface Reading {
  device_id: string;
  light_lux: number | null;
  dli: number | null;
  soil_pct: number | null;
  temp_c: number | null;
  humidity_pct: number | null;
  battery_pct: number | null;
  created_at: string;
}

export interface Device {
  id: string;
  label: string | null;
  plant_key: string | null;
  wake_seconds: number;
  battery_pct: number | null;
  last_seen: string | null;
}

export interface DeviceConnection {
  status: 'online' | 'idle' | 'offline';
  quality: 'Good' | 'Fair' | 'Weak' | 'Unknown';
  /** e.g. "12 min ago" / "never reported" */
  sinceLabel: string;
}

/**
 * Connection quality from how recently the device last reported. Sensors
 * deep-sleep between readings, so "online" spans a full reporting cycle before a
 * device is considered idle/offline (else a healthy sensor would look offline
 * right before its next report). Honest: derived from real last_seen, not a
 * fabricated RSSI (the firmware doesn't report Wi-Fi signal strength).
 *
 * The cycle length comes from the device's own `wake_seconds` — the interval the
 * server hands back to the firmware on every upload — rather than the 210/420
 * minute constants this used to hardcode. Those constants assumed every sensor
 * reports every three hours, so a device deliberately set to report once a day
 * would have been called offline every single day of its life, and one set to
 * report every ten minutes could go three hours dark without a word.
 */
export function connectionFrom(lastSeen: string | null, wakeSeconds?: number | null): DeviceConnection {
  if (!lastSeen) return { status: 'offline', quality: 'Unknown', sinceLabel: 'never reported' };
  const mins = (Date.now() - new Date(lastSeen).getTime()) / 60000;
  const sinceLabel = mins < 1 ? 'just now' : relTime(mins);
  // A cycle, with a floor so a fast-reporting sensor isn't called offline for
  // being a minute late, and a ceiling so a corrupt value can't hide an outage.
  const cycle = Math.min(1440, Math.max(15, (wakeSeconds && wakeSeconds > 0 ? wakeSeconds : 10800) / 60));
  if (mins < cycle * 1.17) return { status: 'online', quality: 'Good', sinceLabel }; // still inside its cycle
  if (mins < cycle * 2.33) return { status: 'idle', quality: 'Fair', sinceLabel };   // missed a report
  return { status: 'offline', quality: 'Weak', sinceLabel };
}

/** Parse a scanned QR / pasted code: greenr://pair?d=<id>&k=<key> (or "id:key"). */
export function parsePairing(raw: string): { id: string; key: string } | null {
  const s = raw.trim();
  const m = s.match(/[?&]d=([0-9a-fA-F-]{36})&k=([0-9a-fA-F]+)/);
  if (m) return { id: m[1], key: m[2] };
  const parts = s.split(/[:\s]+/);
  if (parts.length === 2 && parts[0].length === 36) return { id: parts[0], key: parts[1] };
  return null;
}

/** Claim a device for the current user (call after scanning its QR). */
export async function registerDevice(id: string, key: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Not configured.' };
  const { error } = await supabase.rpc('register_device', { p_device: id, p_secret: key });
  return { error: error?.message ?? null };
}

/** All sensors owned by the signed-in user. */
export async function getMyDevices(): Promise<Device[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from('devices')
    .select('id,label,plant_key,wake_seconds,battery_pct,last_seen')
    .order('created_at', { ascending: true });
  return (data as Device[]) ?? [];
}

/**
 * The firmware sends RAW ADC values for soil & light (it never converts or
 * decides a sensor is "disconnected" — it just reports what it read). The APP
 * owns the conversion to %/index here, so calibration can be tuned without
 * re-flashing. Temp/humidity already arrive as real units and pass through.
 *
 * Raw soil/light span ~0–4095; a converted %/index is 0–100. Applied at every
 * fetch, so the whole app sees clean 0–100 values and the existing per-sensor
 * calibration (offsets, reversed-light flip) still layers on top unchanged.
 */
/**
 * SOIL CALIBRATION — the endpoints that turn raw ADC into 0–100 %.
 *
 * DRY is the raw value with the probe held in OPEN AIR. It was set at 3150,
 * which made air read ~7–8 % instead of 0 — a small error, but it shifts every
 * reading and makes "bone dry" look like "nearly dry". Corrected to 3020 so
 * air lands on 0.
 *
 * IMPORTANT — INSERTION DEPTH. A capacitive probe senses along its whole blade,
 * so it reports the AVERAGE moisture over however much of it is buried. Pushed
 * in only an inch, most of the blade is measuring air and the pot reads far too
 * dry (which is why the same pot jumped from "needs water" to "fine" when the
 * probe went all the way in). These endpoints assume the probe is inserted to
 * the WHITE LINE — the depth the blade is designed for. Because water drains
 * downward, that depth also samples the upper root zone, which is exactly the
 * layer that dries first and should drive watering decisions.
 */
const SOIL_DRY_ADC = 3020; // raw in open air        → 0 %
const SOIL_WET_ADC = 1400; // raw sitting in water   → 100 %
/**
 * Above this raw value the probe is reading mostly air — either it's barely
 * inserted or it isn't in soil at all. Even bone-dry potting mix holds enough
 * moisture to read below this, so it's a reliable "not properly inserted" flag.
 */
export const SOIL_NOT_INSERTED_ADC = 3120;

/** True when the reading suggests the probe isn't buried to the white line. */
export function looksNotInserted(rawOrPct: number | null | undefined): boolean {
  if (rawOrPct == null) return false;
  return rawOrPct > 100 && rawOrPct >= SOIL_NOT_INSERTED_ADC;
}
// These LDR modules are REVERSED — they read HIGH in the dark and LOW in bright
// light — so the dark endpoint is the high raw value. (Keep the app's "Reversed
// light sensor" calibration toggle OFF; the reversal is already handled here.)
const LIGHT_DARK_ADC = 3200; // raw in the dark     → 0
const LIGHT_BRIGHT_ADC = 200; // raw in bright light → 100

function rawToPct(raw: number, lo: number, hi: number): number {
  const v = Math.round(((raw - lo) / (hi - lo)) * 100);
  return Math.max(0, Math.min(100, v));
}

/**
 * SOIL only: rows written by older firmware already hold a 0–100 percentage,
 * while current firmware sends the raw ADC. Converting a converted value again
 * produces nonsense, so values inside 0–100 are passed through. That test is
 * safe here because a capacitive probe never legitimately reads below ~800 raw.
 */
function maybeRawToPct(v: number, lo: number, hi: number): number {
  if (v <= 100) return v;
  return rawToPct(v, lo, hi);
}

/**
 * LIGHT is ALWAYS converted — the same "looks like a percentage" shortcut is a
 * bug here. These LDR modules read LOW in bright light (the bright endpoint is
 * ~200 raw), so strong sunlight legitimately produces raw values near or below
 * 100. Passing those through untouched reported brilliant light as almost dark:
 * raw 20 (dazzling) rendered as "20/100". Since the firmware always sends raw,
 * converting unconditionally is correct; any pre-raw rows age out of the reading
 * window within a day or so.
 */
export function normalizeReading(r: Reading): Reading {
  return {
    ...r,
    soil_pct: r.soil_pct == null ? r.soil_pct : maybeRawToPct(r.soil_pct, SOIL_DRY_ADC, SOIL_WET_ADC),
    light_lux: r.light_lux == null ? r.light_lux : rawToPct(r.light_lux, LIGHT_DARK_ADC, LIGHT_BRIGHT_ADC),
  };
}

/** Recent readings for a device, oldest→newest, for history charts. */
export async function getReadingHistory(deviceId: string, limit = 48): Promise<Reading[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from('readings')
    .select('device_id,light_lux,dli,soil_pct,temp_c,humidity_pct,battery_pct,created_at')
    .eq('device_id', deviceId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return ((data as Reading[]) ?? []).slice().reverse().map(normalizeReading);
}

/** All readings since a given time (for the analytics dashboard windows). */
export async function getReadingsSince(deviceId: string, sinceMs: number): Promise<Reading[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from('readings')
    .select('device_id,light_lux,dli,soil_pct,temp_c,humidity_pct,battery_pct,created_at')
    .eq('device_id', deviceId)
    .gte('created_at', new Date(sinceMs).toISOString())
    .order('created_at', { ascending: true })
    .limit(2000);
  return ((data as Reading[]) ?? []).map(normalizeReading);
}

/**
 * Has this device reported to the cloud since `sinceMs`? Used to CONFIRM Wi-Fi
 * setup independently of Bluetooth: the sensor uploads as soon as it joins, so
 * a fresh `last_seen` proves it is online even when the BLE link dropped before
 * it could send its "ok" (starting Wi-Fi often kills the BLE connection — they
 * share one radio).
 */
export async function deviceSeenSince(deviceId: string, sinceMs: number): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase
    .from('devices')
    .select('last_seen')
    .eq('id', deviceId)
    .maybeSingle();
  const seen = (data as { last_seen?: string } | null)?.last_seen;
  return !!seen && new Date(seen).getTime() >= sinceMs;
}

/** The device paired to a plant, if any — the most recently reporting one when
 *  several are assigned (an old sensor must never mask the live one). */
export async function getDeviceIdForPlant(plantKey: string): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from('devices')
    .select('id,last_seen')
    .eq('plant_key', plantKey)
    .order('last_seen', { ascending: false, nullsFirst: false })
    .limit(1);
  return (data?.[0]?.id as string) ?? null;
}

/** Newest reading for a device, or null if none yet. */
export async function getLatestReading(deviceId: string): Promise<Reading | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from('readings')
    .select('device_id,light_lux,dli,soil_pct,temp_c,humidity_pct,battery_pct,created_at')
    .eq('device_id', deviceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? normalizeReading(data as Reading) : null;
}

/** Map a paired device to one of the user's plants. Returns an error string on
 *  failure (e.g. RLS/network) so callers can surface it instead of silently
 *  leaving the sensor unlinked — which is why a plant showed no readings.
 *
 *  A plant has exactly ONE sensor: any other device pointing at this plant is
 *  unassigned first. Otherwise an old sensor lingers on the same plant and the
 *  screens disagree about which device to read (the live one vs the dead one). */
export async function assignDeviceToPlant(deviceId: string, plantKey: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Not configured.' };
  await supabase
    .from('devices')
    .update({ plant_key: null })
    .eq('plant_key', plantKey)
    .neq('id', deviceId);
  const { error } = await supabase.from('devices').update({ plant_key: plantKey }).eq('id', deviceId);
  return { error: error?.message ?? null };
}

/** Unassign a device from its plant (keeps it on the account). */
export async function unassignDevice(deviceId: string): Promise<void> {
  if (!supabase) return;
  await supabase.from('devices').update({ plant_key: null }).eq('id', deviceId);
}

/** Give a device a custom name. */
export async function renameDevice(deviceId: string, label: string): Promise<void> {
  if (!supabase) return;
  await supabase.from('devices').update({ label }).eq('id', deviceId);
}

/**
 * Remove a device from the account (release the claim). Needs the
 * `release_device` RPC (see supabase-device-manager.sql); if it isn't installed
 * we at least unassign the plant so the app state is consistent.
 */
export async function releaseDevice(deviceId: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Not configured.' };
  const { error } = await supabase.rpc('release_device', { p_device: deviceId });
  if (error) {
    await unassignDevice(deviceId);
    return { error: error.message };
  }
  return { error: null };
}

/** Idle cadence: the sensor wakes, reads, and deep-sleeps ~3 h between reports
 *  (battery-friendly). Server-controlled via devices.wake_seconds. */
export const IDLE_WAKE_SECONDS = 10800;

/** Nominal reporting interval in hours (the idle cadence). This is the DEFAULT —
 *  wake_seconds is server-controlled and can change, so anything analysing the
 *  reading series should prefer the interval OBSERVED in the data and use this
 *  only as a fallback. */
export const REPORT_INTERVAL_H = IDLE_WAKE_SECONDS / 3600;

/** A gap longer than this (hours) means the sensor missed reports — i.e. it was
 *  offline. Curve fitting must not bridge such gaps. Derived from the cadence
 *  (1.5× a reporting cycle), not a magic number. */
export const OFFLINE_GAP_H = REPORT_INTERVAL_H * 1.5;

/** Set how often the device wakes to read (server-controlled; no reflash). */
export async function setWakeInterval(deviceId: string, seconds: number): Promise<void> {
  if (!supabase) return;
  await supabase.from('devices').update({ wake_seconds: seconds }).eq('id', deviceId);
}
