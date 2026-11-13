import type { Reading } from '@/lib/devices';
import { getSpecies } from '@/lib/plants';
import { soilIndex, FACTORY_SOIL_ENDPOINTS, rawFromIndex } from '@/lib/sensing/moisture';
import type { Plant } from '@/lib/types';

/** A fixed "now" so every test is reproducible: 2026-06-15 12:00 local. */
export const NOW = new Date(2026, 5, 15, 12, 0, 0).getTime();
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export function makePlant(species: string, over: Partial<Plant> = {}): Plant {
  const s = getSpecies(species);
  return {
    id: `pl-${species.toLowerCase().replace(/\W+/g, '-')}`,
    name: species,
    species,
    latin: s?.latin ?? '',
    emoji: s?.emoji ?? '🌿',
    spotId: 'sp-test',
    potSize: 'M',
    potMaterial: 'Plastic',
    potCm: 16,
    potHeightCm: 16,
    potShape: 'tapered',
    hasDrainage: true,
    soilMix: 'Standard mix',
    score: 0,
    estimate: false,
    estimateBand: 0,
    sensorId: null,
    components: { hydration: 0, light: 0, climate: 0, consistency: 0, trend: 0 },
    comfortBand: s?.band ?? [30, 55],
    moistureHistory: [],
    scoreTrend14: [],
    forecast: { warnInDays: null, criticalInDays: null, confidenceDays: 1, action: '' },
    timeline: [],
    timeInRangePct: 0,
    addedDaysAgo: 60,
    addedAt: new Date(NOW - 60 * DAY).toISOString(),
    ...over,
  };
}

export function reading(atMs: number, soilIdx: number | null, over: Partial<Reading> = {}): Reading {
  const raw = soilIdx == null ? null : Math.round(rawFromIndex(soilIdx, FACTORY_SOIL_ENDPOINTS));
  return {
    device_id: 'dev-test',
    soil_pct: raw == null ? null : soilIndex(raw),
    soil_raw: raw,
    soil_quality: raw == null ? undefined : 'ok',
    light_lux: 40,
    dli: null,
    temp_c: 22,
    humidity_pct: 55,
    battery_pct: null,
    created_at: new Date(atMs).toISOString(),
    ...over,
  };
}

/**
 * SIMULATED soil trace — not measured data. Exponential dry-down from `full`
 * toward `floor` with time constant `tauDays`, re-watered to `full` whenever it
 * falls to `waterAt` (if given). One reading every `everyH` hours, ending at
 * `endIndex` if supplied (the last cycle is cut where the trace reaches it).
 */
export function simulateTrace(opts: {
  days: number;
  full: number;
  floor: number;
  tauDays: number;
  waterAt?: number;
  everyH?: number;
  noise?: number;
  now?: number;
  /** stop adding waterings this many days before the end, so the trace finishes mid-dry-down */
  lastWaterDaysAgo?: number;
}): Reading[] {
  const { days, full, floor, tauDays, waterAt, everyH = 3, noise = 0, now = NOW, lastWaterDaysAgo } = opts;
  const out: Reading[] = [];
  const steps = Math.round((days * 24) / everyH);
  let v = full;
  // Deterministic pseudo-noise: a fixed sequence, so failures reproduce.
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5) * 2;
  for (let i = 0; i <= steps; i++) {
    const t = now - (steps - i) * everyH * HOUR;
    const daysFromEnd = (now - t) / DAY;
    if (i > 0) {
      v = floor + (v - floor) * Math.exp(-(everyH / 24) / tauDays);
      const mayWater = lastWaterDaysAgo == null || daysFromEnd > lastWaterDaysAgo;
      if (waterAt != null && v <= waterAt && mayWater) v = full;
    }
    out.push(reading(t, Math.max(0, Math.min(100, v + noise * rand()))));
  }
  return out;
}
