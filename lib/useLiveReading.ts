import { useEffect, useState } from 'react';

import {
  getLatestReading,
  getReadingHistory,
  type Reading,
} from './devices';
import { supabase } from './supabase';

/**
 * Recent reading history for every sensored plant, keyed by plant id. Powers the
 * Forecast tab, where projecting each plant's next-watering date needs the
 * drying trend (not just the latest value). Refreshes every 60s.
 */
export function useAllReadingHistories(): Map<string, Reading[]> {
  const [map, setMap] = useState<Map<string, Reading[]>>(new Map());

  useEffect(() => {
    if (!supabase) return;
    let alive = true;

    const load = async () => {
      const { data: devs } = await supabase!
        .from('devices')
        .select('id,plant_key')
        .not('plant_key', 'is', null);
      if (!devs || !alive) return;
      const next = new Map<string, Reading[]>();
      await Promise.all(
        devs.map(async (d: any) => {
          if (!d.plant_key) return;
          const h = await getReadingHistory(d.id, 48);
          if (h.length) next.set(d.plant_key, h);
        }),
      );
      if (alive) setMap(next);
    };

    load();
    const iv = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  return map;
}

/**
 * Sensor data for a given plant. Finds the device paired to that plant
 * (devices.plant_key) and pulls its newest reading + recent history. The sensor
 * reports on its own (~every 3 h, deep-sleeping in between); this just displays
 * whatever has landed — no live streaming.
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
    // Refresh the view periodically so a new 3-hourly report shows up on its own.
    const iv = setInterval(load, 30000);
    return () => { alive = false; clearInterval(iv); };
  }, [plantKey]);

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
      // Home just DISPLAYS the latest reading the sensor has reported.
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
