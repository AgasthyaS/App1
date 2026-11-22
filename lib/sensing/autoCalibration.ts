/**
 * AUTOMATIC SOIL ENDPOINTS — a sensor's own "in air" and "in water" counts,
 * worked out from its readings instead of asked for.
 *
 * Every probe needs its own pair (lib/sensing/moisture, "WHY ENDPOINTS ARE PER
 * SENSOR"), and until now the only way to get one was the manual capture on the
 * calibrate screen. Most owners never do it, so most sensors ran on the factory
 * pair measured on a different board — which on an ESP32-C3 can put the index
 * twenty or more points off and turn "comfortably moist" into "water now".
 *
 * ─────────────────────────── THE AIR END: MEASURED ────────────────────────────
 *
 * Setup gives a clean, repeatable air reading for free. The firmware
 * (greenr_sensor_c3, "setup burst") takes its first reading at power-up, while
 * the owner is still joining Wi-Fi with the probe in their hand, then two more
 * about 90 s apart. The pairing screen asks for the probe to stay out of the soil
 * until those have arrived. That produces a SIGNATURE no other situation does:
 *
 *   1. a CLUSTER: two or more readings minutes apart (normal cadence is 1–3 h),
 *   2. that AGREE: spread within AIR_SPREAD counts — air is the most stable
 *      thing a capacitive probe ever sees,
 *   3. followed by a lasting DROP of at least INSERT_DROP counts when the blade
 *      goes into the soil, and
 *   4. sitting ABOVE everything the probe reads afterwards: soil, however dry,
 *      loads the blade more than air does.
 *
 * The air count is the MEDIAN of the cluster, never one reading. Test 4 is
 * re-checked every time, so a cluster that was really a dry pot pressed with RST
 * before a watering is demoted as soon as the soil dries back to that level.
 *
 * ─────────────────────────── THE WATER END: ESTIMATED ─────────────────────────
 *
 * Nobody's probe sits in a glass of water in normal use, so this end is inferred:
 *
 *     wet ≈ dry × WET_TO_DRY_RATIO        (1400 / 3020, the measured factory pair)
 *
 * The two boards differ mainly in converter GAIN (input range), and a gain change
 * scales both counts by the same factor, which is what keeps their ratio. It is
 * an approximation, and the uncertainty below says so. The data then bounds it:
 * soil after a watering never reads wetter than water, so the water count must
 * sit below the wettest readings actually seen (2nd percentile, minus a margin).
 *
 * A manual capture of either end always overrides the automatic one.
 *
 * ─────────────────────────────── UNCERTAINTY ──────────────────────────────────
 *
 * SOIL_SCALE_SD is the standard deviation, in index points, of a mid-range
 * reading under each kind of scale. These are judgement figures from the error
 * sources above, not measurements; they exist so the dose can be more cautious
 * when the scale is less certain (lib/watering, pourStep), and they are
 * documented in docs/FORMULAS.md §1.7.
 */

import { ADC_MAX, FACTORY_SOIL_ENDPOINTS, MIN_ENDPOINT_SPAN, endpointsValid, type SoilEndpoints } from './moisture';

/** wet/dry ratio of the measured factory pair */
export const WET_TO_DRY_RATIO = FACTORY_SOIL_ENDPOINTS.wetAdc / FACTORY_SOIL_ENDPOINTS.dryAdc;

/** readings this close together in time can only be a setup burst or RST presses */
const CLUSTER_GAP_MS = 15 * 60 * 1000;
/** counts: how tightly air readings agree */
const AIR_SPREAD = 80;
/** counts: the drop when the blade goes into soil */
const INSERT_DROP = 300;
/** the insertion has to show up within this long after the cluster */
const INSERT_WITHIN_MS = 72 * 3600 * 1000;
/** counts: air must sit at least this far above the probe's later in-soil readings */
const ABOVE_SOIL_MARGIN = 100;
/** a probe in air on either board reads well above this */
const AIR_MIN_RAW = 1500;
/** readings needed before the data may bound or set endpoints on its own */
const MIN_DATA_READINGS = 24;
/** counts kept between the wettest soil seen and the water endpoint */
const WET_MARGIN = 50;
/** counts kept between the driest soil seen and a data-derived air endpoint */
const DRY_MARGIN = 150;
/** smallest change worth storing, so the endpoints do not churn on noise */
export const AUTO_MIN_CHANGE = 25;

export type AutoMethod =
  /** air measured during setup; water estimated, bounded by data */
  | 'air'
  /** no air measurement; both ends bounded by the readings alone */
  | 'data';

export interface AutoSoilEndpoints extends SoilEndpoints {
  method: AutoMethod;
  /** readings the result rests on */
  n: number;
  /** the air cluster hit the top of the converter, so true air is at least dryAdc */
  clipped?: boolean;
  at: string;
}

export type SoilScaleSource = 'manual' | 'mixed' | 'auto-air' | 'auto-data' | 'factory';

/** SD of a mid-range index value, in points, by how the scale was obtained. */
export const SOIL_SCALE_SD: Record<SoilScaleSource, number> = {
  manual: 3,
  mixed: 5,
  'auto-air': 7,
  'auto-data': 12,
  factory: 15,
};

interface RawPoint { t: number; raw: number }

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const median = (xs: number[]) => quantile([...xs].sort((a, b) => a - b), 0.5);

function rawPoints(history: { soil_raw?: number | null; created_at: string }[]): RawPoint[] {
  return history
    .map((r) => ({ t: new Date(r.created_at).getTime(), raw: r.soil_raw as number }))
    .filter((p) => Number.isFinite(p.t) && typeof p.raw === 'number' && Number.isFinite(p.raw) && p.raw >= 200 && p.raw <= ADC_MAX)
    .sort((a, b) => a.t - b.t);
}

/**
 * The most recent setup-air cluster that passes all four tests, as its median
 * count and size; null when there is none.
 */
export function findAirCluster(history: { soil_raw?: number | null; created_at: string }[]): { raw: number; n: number; endIndex: number } | null {
  const pts = rawPoints(history);
  let best: { raw: number; n: number; endIndex: number } | null = null;
  let i = 0;
  while (i < pts.length) {
    let j = i;
    while (j + 1 < pts.length && pts[j + 1].t - pts[j].t <= CLUSTER_GAP_MS) j++;
    if (j > i) {
      const vals = pts.slice(i, j + 1).map((p) => p.raw);
      const spread = Math.max(...vals) - Math.min(...vals);
      const air = median(vals);
      const after = pts.slice(j + 1).filter((p) => p.t - pts[j].t <= INSERT_WITHIN_MS);
      // The drop must LAST: the first two readings after the cluster both below it.
      const dropped = after.length >= 2 && after[0].raw <= air - INSERT_DROP && after[1].raw <= air - INSERT_DROP;
      const later = pts.slice(j + 1).map((p) => p.raw).sort((a, b) => a - b);
      const aboveSoil = later.length >= 2 && air >= quantile(later, 0.98) + ABOVE_SOIL_MARGIN;
      if (spread <= AIR_SPREAD && air >= AIR_MIN_RAW && dropped && aboveSoil) {
        best = { raw: Math.round(air), n: vals.length, endIndex: j };
      }
    }
    i = j + 1;
  }
  return best;
}

/**
 * The run of closely spaced readings that ends at the newest one — the setup
 * burst while it is happening — for the pairing screen to show progress. Says
 * nothing about whether it was air; `findAirCluster` decides that later, once the
 * probe has gone into the soil.
 */
export function latestBurst(history: { soil_raw?: number | null; created_at: string }[]): { n: number; spread: number; raw: number } | null {
  const pts = rawPoints(history);
  if (!pts.length) return null;
  let i = pts.length - 1;
  while (i > 0 && pts[i].t - pts[i - 1].t <= CLUSTER_GAP_MS) i--;
  const vals = pts.slice(i).map((p) => p.raw);
  return { n: vals.length, spread: Math.max(...vals) - Math.min(...vals), raw: Math.round(median(vals)) };
}

/** The most an air burst may spread and still be called steady (counts). */
export const AIR_STEADY_SPREAD = AIR_SPREAD;

/**
 * This sensor's endpoints from its readings, merged with what was worked out
 * before (`prior`) so a setup cluster that has since scrolled out of the reading
 * window is not forgotten. Returns null when there is nothing better than the
 * factory pair.
 */
export function autoSoilEndpoints(
  history: { soil_raw?: number | null; created_at: string }[],
  prior?: AutoSoilEndpoints | null,
  now = Date.now(),
): AutoSoilEndpoints | null {
  const pts = rawPoints(history);
  const cluster = findAirCluster(history);

  // In-soil readings: everything after the air cluster, or everything when none.
  const soil = (cluster ? pts.slice(cluster.endIndex + 1) : pts).map((p) => p.raw).sort((a, b) => a - b);
  const enoughData = soil.length >= MIN_DATA_READINGS;
  const pHigh = enoughData ? quantile(soil, 0.98) : null;
  const pLow = enoughData ? quantile(soil, 0.02) : null;

  // ── The air end ──
  let dry: number | null = null;
  let method: AutoMethod = 'data';
  let clipped = false;
  let n = soil.length;
  if (cluster) {
    dry = cluster.raw;
    method = 'air';
    clipped = cluster.raw >= ADC_MAX - 5;
    n += cluster.n;
  } else if (prior?.method === 'air') {
    // Keep a past measurement — unless the soil now reads as high as it, which
    // proves it was not air after all.
    const contradicted = pHigh != null && pHigh >= prior.dryAdc - 50;
    if (!contradicted) {
      dry = prior.dryAdc;
      method = 'air';
      clipped = !!prior.clipped;
      n = Math.max(n, prior.n);
    }
  }
  if (dry == null) {
    if (pHigh == null) return null;
    dry = Math.max(FACTORY_SOIL_ENDPOINTS.dryAdc, Math.round(pHigh + DRY_MARGIN));
  }
  dry = Math.min(ADC_MAX, dry);

  // ── The water end ──
  let wet = Math.round(dry * WET_TO_DRY_RATIO);
  if (pLow != null) wet = Math.min(wet, Math.round(pLow - WET_MARGIN));
  if (prior && prior.method === method && prior.dryAdc === dry) wet = Math.min(wet, prior.wetAdc);
  wet = Math.max(200, wet);

  const out: AutoSoilEndpoints = { dryAdc: dry, wetAdc: wet, method, n, at: new Date(now).toISOString(), ...(clipped ? { clipped } : {}) };
  if (!endpointsValid(out) || out.dryAdc - out.wetAdc < MIN_ENDPOINT_SPAN) return prior ?? null;
  // Data alone that lands on the factory pair adds nothing.
  if (method === 'data' && out.dryAdc === FACTORY_SOIL_ENDPOINTS.dryAdc && out.wetAdc === FACTORY_SOIL_ENDPOINTS.wetAdc) return null;
  return out;
}

/** True when `next` differs from `prev` enough to be worth storing. */
export function autoEndpointsChanged(prev: AutoSoilEndpoints | null | undefined, next: AutoSoilEndpoints | null): boolean {
  if (!next) return false;
  if (!prev) return true;
  return prev.method !== next.method
    || Math.abs(prev.dryAdc - next.dryAdc) >= AUTO_MIN_CHANGE
    || Math.abs(prev.wetAdc - next.wetAdc) >= AUTO_MIN_CHANGE;
}

export interface EffectiveScale {
  endpoints: SoilEndpoints;
  source: SoilScaleSource;
  /** SD of a mid-range index value, points */
  sd: number;
  /**
   * Whether this scale may judge "not in the soil". Only a MEASURED air end can:
   * judged against an estimate, a correctly buried probe could be flagged.
   */
  judgesInsertion: boolean;
}

/**
 * The endpoints a reading is actually converted with, and how trustworthy they
 * are. A manually captured end beats an automatic one; a manually captured air
 * end with no water end gets its water end from the same ratio.
 */
export function effectiveSoilEndpoints(
  manual: Partial<SoilEndpoints> | null | undefined,
  auto: AutoSoilEndpoints | null | undefined,
): EffectiveScale {
  if (endpointsValid(manual)) return { endpoints: manual, source: 'manual', sd: SOIL_SCALE_SD.manual, judgesInsertion: true };
  const mDry = typeof manual?.dryAdc === 'number' ? manual.dryAdc : null;
  const mWet = typeof manual?.wetAdc === 'number' ? manual.wetAdc : null;
  if (mDry != null || mWet != null) {
    const dry = mDry ?? auto?.dryAdc ?? null;
    let wet = mWet ?? (auto && mDry == null ? auto.wetAdc : null);
    if (dry != null && wet == null) {
      wet = Math.round(dry * WET_TO_DRY_RATIO);
      if (auto) wet = Math.min(wet, auto.wetAdc);
    }
    const e = { dryAdc: dry as number, wetAdc: wet as number };
    if (dry != null && wet != null && endpointsValid(e)) {
      // "Not in the soil" needs a MEASURED air end: captured by hand, or at setup.
      const airMeasured = mDry != null || auto?.method === 'air';
      return { endpoints: e, source: 'mixed', sd: SOIL_SCALE_SD.mixed, judgesInsertion: airMeasured };
    }
  }
  if (auto && endpointsValid(auto)) {
    const source: SoilScaleSource = auto.method === 'air' ? 'auto-air' : 'auto-data';
    // A clipped air reading is only a lower bound on the true air count.
    const sd = SOIL_SCALE_SD[source] + (auto.clipped ? 3 : 0);
    return { endpoints: { dryAdc: auto.dryAdc, wetAdc: auto.wetAdc }, source, sd, judgesInsertion: source === 'auto-air' };
  }
  return { endpoints: FACTORY_SOIL_ENDPOINTS, source: 'factory', sd: SOIL_SCALE_SD.factory, judgesInsertion: false };
}
