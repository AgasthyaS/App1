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
 * deep-sleep (~3 h idle), so "online" spans a full reporting cycle before a
 * device is considered idle/offline (else a healthy sensor would look offline
 * right before its next report). Honest: derived from real last_seen, not a
 * fabricated RSSI (the firmware doesn't report Wi-Fi signal strength).
 */
export function connectionFrom(lastSeen: string | null): DeviceConnection {
  if (!lastSeen) return { status: 'offline', quality: 'Unknown', sinceLabel: 'never reported' };
  const mins = (Date.now() - new Date(lastSeen).getTime()) / 60000;
  const sinceLabel = mins < 1 ? 'just now' : relTime(mins);
  if (mins < 210) return { status: 'online', quality: 'Good', sinceLabel }; // within one ~3 h cycle
  if (mins < 420) return { status: 'idle', quality: 'Fair', sinceLabel }; // missed a report
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

/** Recent readings for a device, oldest→newest, for history charts. */
export async function getReadingHistory(deviceId: string, limit = 48): Promise<Reading[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from('readings')
    .select('device_id,light_lux,dli,soil_pct,temp_c,humidity_pct,battery_pct,created_at')
    .eq('device_id', deviceId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return ((data as Reading[]) ?? []).slice().reverse();
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
  return (data as Reading[]) ?? [];
}

/** The device paired to a plant, if any. */
export async function getDeviceIdForPlant(plantKey: string): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.from('devices').select('id').eq('plant_key', plantKey).limit(1);
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
  return (data as Reading) ?? null;
}

/** Map a paired device to one of the user's plants. */
export async function assignDeviceToPlant(deviceId: string, plantKey: string): Promise<void> {
  if (!supabase) return;
  await supabase.from('devices').update({ plant_key: plantKey }).eq('id', deviceId);
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
