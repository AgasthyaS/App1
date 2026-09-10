import { useCallback, useEffect, useRef, useState } from 'react';

import {
  connectionFrom,
  getLatestReading,
  getMyDevices,
  type Device,
  type DeviceConnection,
  type Reading,
} from './devices';
import { supabase } from './supabase';

/**
 * The real device manager's data source (§7): the user's actual Supabase
 * devices, each enriched with its latest reading and a derived connection
 * status. Refreshes on an interval and after any management action, so a device
 * never disappears after restart — it's read straight from the account.
 */
export interface EnrichedDevice {
  device: Device;
  latest: Reading | null;
  connection: DeviceConnection;
}

export function useMyDevices(): { devices: EnrichedDevice[]; loading: boolean; reload: () => void } {
  const [devices, setDevices] = useState<EnrichedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!supabase) {
      setDevices([]);
      setLoading(false);
      return;
    }
    const devs = await getMyDevices();
    const enriched = await Promise.all(
      devs.map(async (d) => ({
        device: d,
        latest: await getLatestReading(d.id),
        connection: connectionFrom(d.last_seen, d.wake_seconds),
      })),
    );
    if (alive.current) {
      setDevices(enriched);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    const iv = setInterval(load, 20000);
    return () => {
      alive.current = false;
      clearInterval(iv);
    };
  }, [load]);

  return { devices, loading, reload: load };
}
