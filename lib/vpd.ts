/**
 * VAPOUR PRESSURE DEFICIT — how thirsty the air is.
 *
 * The app measured temperature and humidity and then treated them as two
 * independent knobs, each nudging the watering interval on its own. That is
 * physically wrong: a plant does not respond to either in isolation, it responds
 * to their combination. VPD is the difference between how much water vapour the
 * air COULD hold at its temperature and how much it actually holds, and it is
 * what actually drives evaporation from the soil and transpiration from leaves.
 *
 * The consequence of getting this wrong is not subtle. 22 °C at 60% RH and 28 °C
 * at 60% RH score identically on humidity and differ by one interval bucket on
 * temperature, yet the second pulls water roughly twice as fast:
 *
 *      22 °C / 60% RH  →  1.06 kPa
 *      28 °C / 60% RH  →  1.51 kPa
 *
 * ─────────────────────────── THE PHYSICS ───────────────────────────
 *
 * Saturation vapour pressure follows the Tetens (1930) equation, which is
 * accurate to better than 0.1% over the range any houseplant will ever see:
 *
 *      SVP(T) = 0.61078 · exp( 17.27·T / (T + 237.3) )        [kPa, T in °C]
 *
 * and the deficit is simply the part of that the air has NOT taken up:
 *
 *      VPD = SVP(T) · (1 − RH/100)
 *
 * WHY IT MATTERS FOR GROWTH, not just watering. Transpiration is the engine that
 * pulls water and dissolved nutrients up from the roots, so some VPD is
 * necessary. But above roughly 1.6 kPa most foliage plants close their stomata to
 * avoid desiccating — and closed stomata cannot take in CO₂, so photosynthesis
 * stops. A plant in bright light with damp soil can therefore sit and do nothing
 * for weeks, which is the real answer to "it has everything it needs, why isn't
 * it growing?". Below about 0.4 kPa the opposite problem appears: too little pull
 * to move calcium to new growth, and leaves that stay wet long enough for fungal
 * disease.
 *
 * Ranges below follow the standard glasshouse guidance (0.4–1.6 kPa working
 * range, 0.8–1.2 kPa optimal for actively growing foliage). Succulents and cacti
 * evolved in arid air and tolerate — indeed prefer — the dry end.
 */

/** Saturation vapour pressure in kPa at `tempC`, via Tetens. */
export function saturationVaporPressureKpa(tempC: number): number {
  if (!Number.isFinite(tempC)) return 0;
  const t = Math.max(-50, Math.min(60, tempC));
  return 0.61078 * Math.exp((17.27 * t) / (t + 237.3));
}

/** Vapour pressure deficit in kPa. Null when either input is missing. */
export function vpdKpa(tempC?: number | null, humidityPct?: number | null): number | null {
  if (tempC == null || humidityPct == null) return null;
  if (!Number.isFinite(tempC) || !Number.isFinite(humidityPct)) return null;
  const rh = Math.max(0, Math.min(100, humidityPct));
  return Math.max(0, saturationVaporPressureKpa(tempC) * (1 - rh / 100));
}

/**
 * The VPD a comfortable growing room sits at — the point the drying model is
 * calibrated against, so a plant in these conditions gets its baseline interval.
 * 22 °C at 55% RH.
 */
export const REFERENCE_VPD_KPA = 1.19;

export type VpdBand = 'stagnant' | 'low' | 'ideal' | 'high' | 'stressful';

export interface VpdVerdict {
  kpa: number;
  band: VpdBand;
  tone: 'good' | 'warn' | 'bad';
  /** true when the plant is likely to have stopped growing despite good care */
  growthLimiting: boolean;
  label: string;
  detail: string;
  /** what to actually do about it */
  fix: string | null;
}

/**
 * Judge the air. `aridTolerant` shifts the whole window up for desert species,
 * which are damaged by the humid end rather than the dry end.
 */
export function vpdVerdict(kpa: number, aridTolerant = false): VpdVerdict {
  const lo = aridTolerant ? 0.8 : 0.4;
  const idealLo = aridTolerant ? 1.0 : 0.8;
  const idealHi = aridTolerant ? 2.2 : 1.2;
  const hi = aridTolerant ? 2.8 : 1.6;

  if (kpa < lo) {
    return {
      kpa, band: 'stagnant', tone: 'warn', growthLimiting: true,
      label: 'Air is very still and damp',
      detail: `Vapour pressure deficit is ${kpa.toFixed(2)} kPa — the air is nearly saturated, so there is almost no pull moving water and calcium up from the roots. Leaves stay wet, which is how fungal spotting and botrytis start.`,
      fix: 'Improve airflow — crack a door, add a small fan on low, and stop misting.',
    };
  }
  if (kpa < idealLo) {
    return {
      kpa, band: 'low', tone: 'good', growthLimiting: false,
      label: 'Humid, growing well',
      detail: `Vapour pressure deficit is ${kpa.toFixed(2)} kPa — on the humid side of ideal, which most foliage plants enjoy.`,
      fix: null,
    };
  }
  if (kpa <= idealHi) {
    return {
      kpa, band: 'ideal', tone: 'good', growthLimiting: false,
      label: 'Ideal for growth',
      detail: `Vapour pressure deficit is ${kpa.toFixed(2)} kPa — right in the band where stomata stay open, so the plant is both drinking and photosynthesising.`,
      fix: null,
    };
  }
  if (kpa <= hi) {
    return {
      kpa, band: 'high', tone: 'warn', growthLimiting: false,
      label: 'Air is drying',
      detail: `Vapour pressure deficit is ${kpa.toFixed(2)} kPa — the air is pulling water faster than ideal. Soil will dry sooner and leaf edges can crisp.`,
      fix: 'Group plants together, add a pebble tray, or move it away from a radiator or vent.',
    };
  }
  return {
    kpa, band: 'stressful', tone: 'bad', growthLimiting: true,
    label: 'Air too dry to grow',
    detail: `Vapour pressure deficit is ${kpa.toFixed(2)} kPa. Above about ${hi} kPa most plants close their stomata to avoid drying out — and closed stomata cannot take in CO₂, so growth stops even with perfect light and watering. This is the usual reason a well-cared-for plant simply sits there.`,
    fix: 'Raise humidity or lower the temperature: a humidifier, grouping plants, or moving it off a heat source.',
  };
}

/**
 * Multiplier on the watering INTERVAL from evaporative demand.
 *
 * Evaporation scales close to linearly with VPD, so the interval scales with its
 * inverse. Clamped because the relationship stops being linear at the extremes
 * and because a single reading should never triple a schedule.
 */
export function vpdIntervalFactor(kpa: number | null): number {
  if (kpa == null || !Number.isFinite(kpa) || kpa <= 0) return 1;
  return Math.max(0.55, Math.min(1.7, REFERENCE_VPD_KPA / kpa));
}
