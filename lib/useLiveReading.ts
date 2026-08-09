import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { getReadingsSince, type Reading } from './devices';
import { supabase } from './supabase';

/**
 * SENSOR DATA FOR THE WHOLE GARDEN — fetched ONCE, shared by every screen.
 *
 * This used to be three independent hooks. Forecast, Garden and Home each called
 * `useAllLiveReadings()`, and each call created its own React state and its own
 * ten-minute timer. Nothing was shared. So the tabs drifted apart by however long
 * separated their mount times, and a reported symptom of "Home isn't updating the
 * readings" was exactly that: Home's copy had been fetched at a different moment
 * from Forecast's and nothing ever reconciled them. It also meant three times the
 * network traffic for one set of numbers, in an app whose central rule is that a
 * quantity shown in two places must be the same quantity.
 *
 * Now there is ONE snapshot in module scope, one timer, and every hook is a view
 * onto it. Screens cannot disagree, because there is only one thing to read.
 *
 * It also refreshes when the app comes back to the foreground. A timer alone is
 * not enough: phones suspend background JS, so after a night asleep the interval
 * has not fired and the first thing the owner sees is yesterday's soil.
 */

/** How often to poll while the app is open. The sensor reports every ~3 h. */
const REFRESH_MS = 10 * 60 * 1000;

/**
 * How much history to hold, as a TIME window rather than a row count.
 *
 * A month, because that is what the watering model needs: `wateringSchedule`
 * measures how long a pot takes to work through its easily-available water, and
 * a retentive pot in a cool room can take over a week to do it once. Two cycles
 * is the minimum for a rate to mean anything, and a fortnight cannot reliably
 * contain two.
 *
 * A time window rather than `limit: N` on purpose — a row count silently shrinks
 * the window whenever the sensor reports more often (watch mode), which is
 * exactly when someone is paying attention.
 */
const HISTORY_DAYS = 30;

export interface PlantReadings {
  deviceId: string;
  reading: Reading | null;
  history: Reading[];
}

interface Snapshot {
  byPlant: Map<string, PlantReadings>;
  fetchedAt: number;
  loading: boolean;
}

let snapshot: Snapshot = { byPlant: new Map(), fetchedAt: 0, loading: false };
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let subscribers = 0;

function publish(next: Snapshot) {
  snapshot = next;
  listeners.forEach((l) => l());
}

async function fetchAll(): Promise<void> {
  if (!supabase) return;
  const { data: devs } = await supabase
    .from('devices')
    .select('id,plant_key,last_seen')
    .not('plant_key', 'is', null)
    .order('last_seen', { ascending: false, nullsFirst: false });
  if (!devs) return;

  // A plant can have more than one device attached — a sensor swapped out, or an
  // old one paired long ago and forgotten. Ordered newest-seen first, so the
  // first device we meet for a plant is the live one and later (dead) ones are
  // skipped. Without this a screen can latch onto a silent device and report
  // "awaiting first reading" for a plant that is reporting perfectly well.
  const claimed = new Set<string>();
  const since = Date.now() - HISTORY_DAYS * 86400000;
  const next = new Map<string, PlantReadings>();

  await Promise.all(
    (devs as { id: string; plant_key: string | null }[]).map(async (d) => {
      if (!d.plant_key || claimed.has(d.plant_key)) return;
      claimed.add(d.plant_key);
      const history = await getReadingsSince(d.id, since);
      next.set(d.plant_key, {
        deviceId: d.id,
        history,
        // The latest reading IS the last row of the history — deriving it rather
        // than fetching it separately removes a whole class of bug where the two
        // came from different moments and disagreed.
        reading: history.length ? history[history.length - 1] : null,
      });
    }),
  );

  publish({ byPlant: next, fetchedAt: Date.now(), loading: false });
}

/** Refresh now, coalescing concurrent callers onto one request. */
export function refreshReadings(): Promise<void> {
  if (inflight) return inflight;
  publish({ ...snapshot, loading: true });
  inflight = fetchAll()
    .catch(() => { publish({ ...snapshot, loading: false }); })
    .finally(() => { inflight = null; });
  return inflight;
}

/** Subscribe to the shared snapshot; starts the timer for the first subscriber. */
function useSnapshot(): Snapshot {
  const [, force] = useState(0);

  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    subscribers += 1;

    if (subscribers === 1) {
      // Anything older than one poll interval is worth replacing immediately.
      if (Date.now() - snapshot.fetchedAt > REFRESH_MS) void refreshReadings();
      timer = setInterval(() => { void refreshReadings(); }, REFRESH_MS);
    } else if (Date.now() - snapshot.fetchedAt > REFRESH_MS) {
      void refreshReadings();
    }

    return () => {
      listeners.delete(listener);
      subscribers -= 1;
      if (subscribers === 0 && timer) { clearInterval(timer); timer = null; }
    };
  }, []);

  // Background JS is suspended on a phone, so the interval does not fire while
  // the app is away. Coming back is the moment stale data is most visible.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && Date.now() - snapshot.fetchedAt > 60000) void refreshReadings();
    });
    return () => sub.remove();
  }, []);

  return snapshot;
}

/** Latest reading per sensored plant. Null when paired but not yet reporting. */
export function useAllLiveReadings(): Map<string, Reading | null> {
  const snap = useSnapshot();
  const out = new Map<string, Reading | null>();
  snap.byPlant.forEach((v, k) => out.set(k, v.reading));
  return out;
}

/** Recent history per sensored plant — the drying curve every model reads. */
export function useAllReadingHistories(): Map<string, Reading[]> {
  const snap = useSnapshot();
  const out = new Map<string, Reading[]>();
  snap.byPlant.forEach((v, k) => { if (v.history.length) out.set(k, v.history); });
  return out;
}

/** True while a refresh is in flight — for pull-to-refresh spinners. */
export function useReadingsRefreshing(): boolean {
  return useSnapshot().loading;
}

/**
 * Sensor data for ONE plant, read from the same shared snapshot as every other
 * screen — so the plant page and the tab that linked to it cannot disagree.
 */
export function useLiveReading(plantKey?: string): {
  reading: Reading | null;
  history: Reading[];
  deviceId: string | null;
} {
  const snap = useSnapshot();
  const entry = plantKey ? snap.byPlant.get(plantKey) : undefined;
  return {
    reading: entry?.reading ?? null,
    history: entry?.history ?? [],
    deviceId: entry?.deviceId ?? null,
  };
}
