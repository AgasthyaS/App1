/**
 * Turns raw sensor readings into plant-specific meaning, judged against each
 * species' ideal ranges (from lib/plants.ts) — never generic thresholds.
 * Before the first reading, every metric is N/A (no fake defaults).
 */
import { blendBand, empiricalBandFor } from './empirical';
import { getSpecies, type PlantSpecies } from './plants';

export type Tone = 'good' | 'warn' | 'bad' | 'unknown';
export interface Status {
  label: string;
  tone: Tone;
  /** the raw reading, for a secondary line if wanted */
  raw?: string;
}

const NA: Status = { label: 'N/A', tone: 'unknown' };

/** Resolve a plant's ideal ranges from the species DB, with safe fallbacks. */
export function idealsFor(speciesCommon: string, comfortBand?: [number, number]) {
  const s: PlantSpecies | undefined = getSpecies(speciesCommon);
  /*
   * MEASURED REALITY OUTRANKS THE BOOK, once there is enough of it.
   *
   * The soil band a care sheet prints is inherited opinion. `species_env_stats`
   * holds the range that plants of this species were ACTUALLY thriving in, and
   * `blendBand` weights the two by sample size — so the textbook leads at twenty
   * plants and reality leads at two hundred. An explicit per-plant `comfortBand`
   * still wins over both, because that is the owner overriding on purpose.
   */
  const book: [number, number] = s?.band ?? [30, 55];
  const measured = empiricalBandFor(speciesCommon);
  const blended = measured?.soil
    ? blendBand(book, measured.soil, measured.samplePlants).band
    : book;
  return {
    band: comfortBand ?? blended,
    dli: s?.dli ?? [2, 8],
    temp: s?.temp ?? [60, 82], // °F
    rhFloor: s?.rhFloor ?? 45,
  };
}

export function soilStatus(soilPct: number | null | undefined, band: [number, number]): Status {
  if (soilPct == null) return NA;
  const [lo, hi] = band;
  const span = Math.max(8, hi - lo);
  const raw = `${Math.round(soilPct)}%`;
  if (soilPct < lo - span * 0.5) return { label: 'Too dry', tone: 'bad', raw };
  if (soilPct < lo) return { label: 'Slightly dry', tone: 'warn', raw };
  if (soilPct <= hi) return { label: 'Ideal', tone: 'good', raw };
  if (soilPct <= hi + span * 0.5) return { label: 'Moist', tone: 'warn', raw };
  return { label: 'Too wet', tone: 'bad', raw };
}

export function tempStatus(tempC: number | null | undefined, tempF: [number, number]): Status {
  if (tempC == null) return NA;
  const f = (tempC * 9) / 5 + 32;
  const [lo, hi] = tempF;
  const raw = `${Math.round(tempC)}°C`;
  if (f < lo - 6) return { label: 'Too cold', tone: 'bad', raw };
  if (f < lo) return { label: 'A bit cold', tone: 'warn', raw };
  if (f <= hi) return { label: 'Ideal', tone: 'good', raw };
  if (f <= hi + 6) return { label: 'A bit warm', tone: 'warn', raw };
  return { label: 'Too warm', tone: 'bad', raw };
}

export function humidityStatus(rh: number | null | undefined, floor: number): Status {
  if (rh == null) return NA;
  const raw = `${Math.round(rh)}%`;
  if (rh < floor - 15) return { label: 'Too low', tone: 'bad', raw };
  if (rh < floor) return { label: 'Low', tone: 'warn', raw };
  if (rh <= 80) return { label: 'Ideal', tone: 'good', raw };
  return { label: 'High', tone: 'warn', raw };
}

/**
 * Light comes from the LDR as an uncalibrated 0–100 index, so this is
 * qualitative: a level from the index, toned by what the species wants (its
 * DLI band). A BH1750 later would make this exact.
 */
export function lightStatus(lightIdx: number | null | undefined, dliBand: [number, number]): Status {
  if (lightIdx == null) return NA;
  const raw = `${Math.round(lightIdx)}/100`;
  const wantsHigh = dliBand[1] >= 10; // sun-lovers
  const wantsLow = dliBand[1] <= 4; // low-light plants
  if (lightIdx < 10) return { label: 'Very dark', tone: 'bad', raw };
  if (lightIdx < 30) return { label: 'Low light', tone: wantsLow ? 'good' : 'warn', raw };
  if (lightIdx < 70) return { label: 'Bright indirect', tone: 'good', raw };
  if (lightIdx < 90) return { label: 'Direct sun', tone: wantsHigh ? 'good' : 'warn', raw };
  return { label: 'Very bright', tone: wantsHigh ? 'good' : 'bad', raw };
}
