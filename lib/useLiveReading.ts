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

/**
 * Latest reading for every sensored plant, keyed by plant id. Value is null
 * when a sensor is paired but hasn't reported yet (→ show N/A). Refreshes every
 * 20s so the Home dashboard updates when new readings land. Does NOT change the
 * device cadence (Home just displays what's there).
 */
export function useAllLiveReadings(): Map<string, Reading | null> {
  const [map, setMap] = useState<Map<string, Reading | null>>(new Map());

  useEffect(() => {
    if (!supabase) return;
    let alive = true;

    const load = async () => {
      const { data: devs } = await supabase!
        .from('devices')
        .select('id,plant_key')
        .not('plant_key', 'is', null);
      if (!devs || !alive) return;
      const next = new Map<string, Reading | null>();
      devs.forEach((d: any) => { if (d.plant_key) next.set(d.plant_key, null); });
      await Promise.all(
        devs.map(async (d: any) => {
          if (!d.plant_key) return;
          const r = await getLatestReading(d.id);
          if (r) next.set(d.plant_key, r);
        }),
      );
      if (alive) setMap(next);
    };

    load();
    const iv = setInterval(load, 20000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  return map;
}
