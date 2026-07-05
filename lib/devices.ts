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

/** Ask the device to take a fresh reading on its next wake (app open / pull). */
export async function requestReadNow(deviceId?: string): Promise<void> {
  if (!supabase) return;
  let q = supabase.from('devices').update({ read_now: true });
  q = deviceId ? q.eq('id', deviceId) : q.not('id', 'is', null);
  await q;
}
