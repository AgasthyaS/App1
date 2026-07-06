import { useEffect, useState } from 'react';

import {
  getLatestReading,
  getReadingHistory,
  IDLE_WAKE_SECONDS,
  LIVE_WAKE_SECONDS,
  requestReadNow,
  setWakeInterval,
  type Reading,
} from './devices';
import { supabase } from './supabase';

/**
 * Live sensor data for a given plant. Finds the device paired to that plant
 * (devices.plant_key), pulls its newest reading plus recent history, and
 * refreshes every 30s. Also nudges the device to report soon (read_now).
 */
export function useLiveReading(plantKey?: string): {
  reading: Reading | null;
  history: Reading[];
  deviceId: string | null;
} {
  const [reading, setReading] = useState<Reading | null>(null);
  const [history, setHistory] = useState<Reading[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  useEffect(() => {
    if (!plantKey || !supabase) { setReading(null); setHistory([]); setDeviceId(null); return; }
    let alive = true;

    const load = async () => {
      const { data } = await supabase!
        .from('devices')
        .select('id')
        .eq('plant_key', plantKey)
        .limit(1);
      const id = (data?.[0]?.id as string) ?? null;
      if (!alive) return;
      setDeviceId(id);
      if (id) {
        const [r, h] = await Promise.all([getLatestReading(id), getReadingHistory(id)]);
        if (alive) { setReading(r); setHistory(h); }
      } else {
        setReading(null);
        setHistory([]);
      }
    };

    load();
    const iv = setInterval(load, 10000); // poll fast while the screen is open
    return () => { alive = false; clearInterval(iv); };
  }, [plantKey]);

  // While this plant is open, put the sensor in live mode (fast reads); when the
  // user leaves, drop it back to the slow, deep-sleeping idle cadence.
  useEffect(() => {
    if (!deviceId) return;
    requestReadNow(deviceId);
    setWakeInterval(deviceId, LIVE_WAKE_SECONDS);
    return () => { setWakeInterval(deviceId, IDLE_WAKE_SECONDS); };
  }, [deviceId]);

  return { reading, history, deviceId };
}
