/**
 * THE SOIL SIGNAL, STAGE BY STAGE.
 *
 * A capacitive probe does not measure water. It measures how much the material
 * around its blade loads an oscillator, and reports that as a voltage the
 * microcontroller digitises. Everything after that is interpretation, and the
 * stages are kept separate here so each one can be named, tested and replaced:
 *
 *   1. RAW          ADC counts, 0–4095. What the firmware sends. Never altered.
 *   2. VALIDATED    the same number plus a verdict on whether it can be used.
 *   3. INDEX        0–100 between this sensor's own "in air" and "in water"
 *                   counts. A RELATIVE MOISTURE INDEX — unit-free, comparable
 *                   over time for one probe in one pot, and nothing more.
 *   4. ESTIMATE     volumetric water content, ONLY if the owner has supplied
 *                   weighed reference points for this pot. Otherwise absent.
 *   5. SUBSTRATE    where the index sits between this pot's "full" and "needs
 *                   water" (lib/soilProfile.ts, lib/substrate).
 *   6. PLANT        what that means for this species (lib/waterAction.ts).
 *
 * WHY THE INDEX IS NOT A PERCENTAGE OF WATER. The probe's output is not linear in
 * water content — its oscillator's response flattens as the soil gets wetter —
 * and the relationship shifts with the substrate, its salt content, temperature
 * and how firmly the soil is packed against the blade. Published evaluations of
 * this class of sensor on a generic calibration report errors of several points
 * of volumetric water content. Stage 3 is therefore called an index, and the app
 * may only claim water content at stage 4.
 *
 * WHY ENDPOINTS ARE PER SENSOR. "In air" and "in water" counts differ between
 * individual probes, between supply voltages, and between microcontrollers (an
 * ESP32-C3's converter has a different input range from the original ESP32's).
 * One pair of constants for every unit puts a systematic offset on all of them.
 */

/** 12-bit converter. */
export const ADC_MAX = 4095;

export interface SoilEndpoints {
  /** counts with the blade in open air → index 0 */
  dryAdc: number;
  /** counts with the blade in water up to the line → index 100 */
  wetAdc: number;
}

/**
 * Starting values, measured on the original ESP32 dev-kit build. Used until a
 * sensor has its own. They are NOT known to be right for an ESP32-C3.
 */
export const FACTORY_SOIL_ENDPOINTS: SoilEndpoints = { dryAdc: 3020, wetAdc: 1400 };

/** The two ends must be this far apart to be believable as air vs water. */
export const MIN_ENDPOINT_SPAN = 400;

/**
 * Below this the probe is almost certainly unplugged or unpowered: a working
 * capacitive probe does not go this low even in water.
 */
const DISCONNECTED_BELOW = 200;
/** Counts above the dry endpoint at which the blade is clearly not in soil. */
const NOT_INSERTED_MARGIN = 100;
/** Counts past the wet endpoint that are still plausibly "very wet", not a fault. */
const WET_OVERSHOOT_OK = 250;

export type SoilQuality =
  | 'ok'
  /** an older row that already held a 0–100 value; passed through, cannot be re-derived */
  | 'legacy-index'
  /** reads as open air — not in the soil, or barely */
  | 'not-inserted'
  /** far beyond the water endpoint — standing water on the electronics, or a wiring fault */
  | 'beyond-wet'
  /** floating or unpowered input */
  | 'disconnected'
  /** not a number a 12-bit converter can produce */
  | 'invalid';

export function endpointsValid(e: Partial<SoilEndpoints> | null | undefined): e is SoilEndpoints {
  if (!e) return false;
  const { dryAdc, wetAdc } = e;
  return (
    typeof dryAdc === 'number' && typeof wetAdc === 'number'
    && Number.isFinite(dryAdc) && Number.isFinite(wetAdc)
    && dryAdc <= ADC_MAX && wetAdc >= 0
    // This probe reads HIGH when dry. A reversed pair is a mistake, not a variant.
    && dryAdc - wetAdc >= MIN_ENDPOINT_SPAN
  );
}

export interface ValidatedSoil {
  /** the count as sent, or null when it is not usable as a raw count */
  raw: number | null;
  quality: SoilQuality;
}

/**
 * Stage 2. Classifies a stored soil value without changing it.
 *
 * Values of 0–100 are rows from firmware that converted on the device. They
 * cannot be told apart from a genuine raw count that low except by the fact that
 * a connected probe never produces one, which is the same assumption the app
 * has always made here.
 */
export function validateSoil(value: number | null | undefined, endpoints: SoilEndpoints = FACTORY_SOIL_ENDPOINTS): ValidatedSoil {
  if (typeof value !== 'number' || !Number.isFinite(value)) return { raw: null, quality: 'invalid' };
  if (value < 0 || value > ADC_MAX) return { raw: null, quality: 'invalid' };
  if (value <= 100) return { raw: null, quality: 'legacy-index' };
  if (value < DISCONNECTED_BELOW) return { raw: value, quality: 'disconnected' };
  const e = endpointsValid(endpoints) ? endpoints : FACTORY_SOIL_ENDPOINTS;
  if (value >= e.dryAdc + NOT_INSERTED_MARGIN) return { raw: value, quality: 'not-inserted' };
  if (value < e.wetAdc - WET_OVERSHOOT_OK) return { raw: value, quality: 'beyond-wet' };
  return { raw: value, quality: 'ok' };
}

/**
 * Stage 3. Raw counts → relative moisture index, 0–100.
 *
 *     index = 100 · (dry − raw) / (dry − wet)
 *
 * Linear between the two endpoints, because two points define nothing more.
 * Clamped, since counts slightly past either end are noise, not information.
 */
export function soilIndex(raw: number, endpoints: SoilEndpoints = FACTORY_SOIL_ENDPOINTS): number {
  const e = endpointsValid(endpoints) ? endpoints : FACTORY_SOIL_ENDPOINTS;
  if (!Number.isFinite(raw)) return 0;
  const v = (100 * (e.dryAdc - raw)) / (e.dryAdc - e.wetAdc);
  return Math.max(0, Math.min(100, v));
}

/** The inverse, for showing what count an index corresponds to. */
export function rawFromIndex(index: number, endpoints: SoilEndpoints = FACTORY_SOIL_ENDPOINTS): number {
  const e = endpointsValid(endpoints) ? endpoints : FACTORY_SOIL_ENDPOINTS;
  return e.dryAdc - (Math.max(0, Math.min(100, index)) / 100) * (e.dryAdc - e.wetAdc);
}

/* ───────────────── STAGE 4: A WEIGHED CALIBRATION FOR ONE POT ─────────────────
 *
 * The only way to turn the index into water content is to measure water content
 * some other way at a few moisture levels and record what the probe said at
 * each. For a pot that means weighing it:
 *
 *     θ = (mass_now − mass_dry) / (ρ_water · V_substrate)
 *
 * with mass in grams, V in cm³, ρ_water = 1 g/cm³, θ in cm³/cm³. Three or more
 * such points, spread from nearly dry to just-drained, give a curve for THAT
 * probe in THAT substrate. It does not transfer to another pot.
 *
 * Between points the curve is interpolated with a monotone cubic (Fritsch &
 * Carlson 1980). A polynomial fit was rejected: with four or five points it
 * oscillates between them and can report water content FALLING as the soil gets
 * wetter. The monotone interpolant cannot — it passes through every point and
 * never reverses. Outside the measured range it holds the end values rather than
 * extrapolating a slope that was never observed.
 */

export interface MoisturePoint {
  /** relative moisture index the probe showed, 0–100 */
  index: number;
  /** water content measured by weighing, cm³/cm³ (0–1) */
  theta: number;
}

export const MIN_CURVE_POINTS = 3;

/** Usable points: finite, in range, sorted, strictly increasing in both axes. */
export function cleanCurve(points: MoisturePoint[] | null | undefined): MoisturePoint[] | null {
  const pts = (points ?? [])
    .filter((p) => p && Number.isFinite(p.index) && Number.isFinite(p.theta)
      && p.index >= 0 && p.index <= 100 && p.theta >= 0 && p.theta <= 1)
    .sort((a, b) => a.index - b.index);
  const kept: MoisturePoint[] = [];
  for (const p of pts) {
    const last = kept[kept.length - 1];
    // Need a real step in the index, and water content that rises with it.
    if (!last || (p.index - last.index >= 2 && p.theta > last.theta)) kept.push(p);
  }
  return kept.length >= MIN_CURVE_POINTS ? kept : null;
}

/**
 * Water content (cm³/cm³) for an index, from a weighed curve. Null when the
 * curve is absent or unusable — callers must then show the index and not a
 * water content.
 */
export function thetaFromCurve(index: number, points: MoisturePoint[] | null | undefined): number | null {
  const pts = cleanCurve(points);
  if (!pts || !Number.isFinite(index)) return null;
  const n = pts.length;
  if (index <= pts[0].index) return pts[0].theta;
  if (index >= pts[n - 1].index) return pts[n - 1].theta;

  const h: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(pts[i + 1].index - pts[i].index);
    d.push((pts[i + 1].theta - pts[i].theta) / h[i]);
  }
  // Fritsch–Carlson tangents: harmonic mean of neighbouring slopes, zero at a turn.
  const m: number[] = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]);
  }
  let k = 0;
  while (k < n - 2 && index > pts[k + 1].index) k++;
  const t = (index - pts[k].index) / h[k];
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * pts[k].theta
    + (t3 - 2 * t2 + t) * h[k] * m[k]
    + (-2 * t3 + 3 * t2) * pts[k + 1].theta
    + (t3 - t2) * h[k] * m[k + 1]
  );
}

/** Water content from two weighings, cm³/cm³. Null when the inputs are not physical. */
export function thetaFromWeights(massNowG: number, massDryG: number, substrateVolumeMl: number): number | null {
  if (![massNowG, massDryG, substrateVolumeMl].every(Number.isFinite)) return null;
  if (substrateVolumeMl <= 0 || massNowG < massDryG) return null;
  const theta = (massNowG - massDryG) / substrateVolumeMl;
  return theta <= 1 ? theta : null;
}

/* ───────────────────────── IS THE TRACE BELIEVABLE? ─────────────────────────
 *
 * A single reading cannot be judged alone, but a run of them can. Soil dries
 * smoothly and wets in a step; it does not zig-zag. So the test is how much the
 * trace wobbles around its own local median, measured robustly:
 *
 *     residual_i = x_i − median(x_{i−2..i+2})
 *     scale      = 1.4826 · median(|residual|)        (MAD → σ for normal noise)
 *
 * A point is an outlier when it sits more than 3.5 scales AND more than 4 index
 * points from its local median — both, so a perfectly quiet trace does not flag
 * its own least-significant-bit flicker. Rises are excluded before scoring,
 * because a watering is a real step, not noise.
 */

export interface TraceConsistency {
  /** readings examined */
  n: number;
  /** robust noise level, index points */
  noisePts: number;
  /** share of examined readings that are outliers, 0–1 */
  outlierShare: number;
  /** too erratic to base a watering decision on */
  inconsistent: boolean;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export const MIN_TRACE_FOR_CONSISTENCY = 8;

export function traceConsistency(values: (number | null | undefined)[], window = 24): TraceConsistency | null {
  const xs = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).slice(-window);
  if (xs.length < MIN_TRACE_FOR_CONSISTENCY) return null;
  const residuals: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const lo = Math.max(0, i - 2);
    const hi = Math.min(xs.length, i + 3);
    residuals.push(xs[i] - median(xs.slice(lo, hi)));
  }
  const scale = Math.max(0.5, 1.4826 * median(residuals.map(Math.abs)));
  let outliers = 0;
  for (let i = 0; i < xs.length; i++) {
    const r = Math.abs(residuals[i]);
    if (r > 3.5 * scale && r > 4) outliers++;
  }
  // Direction changes that are not waterings: a drying pot should not rise.
  let reversals = 0;
  for (let i = 2; i < xs.length; i++) {
    const a = xs[i - 1] - xs[i - 2];
    const b = xs[i] - xs[i - 1];
    if (a * b < 0 && Math.abs(a) > 4 && Math.abs(b) > 4) reversals++;
  }
  const outlierShare = outliers / xs.length;
  return {
    n: xs.length,
    noisePts: scale,
    outlierShare,
    inconsistent: outlierShare > 0.2 || reversals >= Math.max(3, xs.length * 0.25),
  };
}
