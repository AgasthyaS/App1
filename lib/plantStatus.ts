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
  /*
   * A STORED BAND CAN BE MALFORMED, and `?? blended` only catches null.
   *
   * `comfortBand` is persisted per plant and editable, so it reaches here as
   * `[NaN, NaN]`, `[]`, or the pair the wrong way round. Any of those flowed
   * through untouched, and randomised testing traced a NaN vitality score — the
   * biggest number on the garden card — straight back to it. Reversed bounds are
   * repaired rather than discarded, since the intent is obvious; anything that
   * is not two real numbers falls back to what the species says, which is what
   * `null` already did.
   */
  const usable: [number, number] | null =
    Array.isArray(comfortBand)
      && comfortBand.length === 2
      && Number.isFinite(comfortBand[0])
      && Number.isFinite(comfortBand[1])
      ? [Math.min(comfortBand[0], comfortBand[1]), Math.max(comfortBand[0], comfortBand[1])]
      : null;

  return {
    band: usable ?? blended,
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
  // The WORD describes the light; the TONE says whether it suits this species —
  // and the tone comes from the one definition the spot verdict also uses.
  const tone = lightTone(lightIdx, dliBand);
  const label =
    lightIdx < 10 ? 'Very dark'
      : lightIdx < 30 ? 'Low light'
        : lightIdx < 70 ? 'Bright indirect'
          : lightIdx < 90 ? 'Direct sun'
            : 'Very bright';
  return { label, tone, raw };
}

/**
 * Does this much light suit a species with this daily-light band? ONE definition,
 * shared by the per-reading status above and the multi-day spot verdict in
 * lib/insights — they used to carry separate cut-offs and could disagree about
 * the same number on the same screen.
 *
 * The cut-offs are on the 0–100 light index and are horticultural judgement, not
 * measurement: the index is an uncalibrated estimate, so these separate "clearly
 * wrong" from "plausibly fine" and nothing finer.
 */
export function lightTone(lightIdx: number, dliBand: [number, number]): 'good' | 'warn' | 'bad' {
  const wantsHigh = dliBand[1] >= 10; // sun-lovers
  const wantsLow = dliBand[1] <= 4; // low-light plants
  if (wantsHigh) return lightIdx >= 55 ? 'good' : lightIdx >= 30 ? 'warn' : 'bad';
  if (wantsLow) return lightIdx < 8 ? 'bad' : lightIdx <= 60 ? 'good' : 'warn';
  return lightIdx < 15 ? 'bad' : lightIdx < 28 ? 'warn' : lightIdx <= 75 ? 'good' : 'warn';
}
