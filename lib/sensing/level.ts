/**
 * WHERE THE SOIL IS NOW — from the last few readings, not the last one.
 *
 * A capacitive probe's reading wobbles by a couple of points from one wake to
 * the next (oscillator noise, temperature, a bump to the pot). Every decision
 * used to be made on the single newest reading, so one high-noise reading could
 * flip "fine" to "water now" or add a hundred millilitres to a dose.
 *
 * Soil dries by a few points a DAY, so the readings of the last few hours all
 * describe the same state of the pot. Their MEDIAN is that state with the noise
 * taken out — and a median, unlike a mean, is not dragged by one bad reading.
 *
 * The one thing that moves the soil fast is a watering, and averaging across one
 * would blend "before" with "after". So only readings since the last sustained
 * rise of STEP_PTS or more are used.
 *
 * A plain median of the last few hours would still LAG: on a steady dry-down the
 * older readings are wetter, so the median sits behind the newest truth by half
 * the window's fall (0.3 points at a typical rate, over a point on a hot day).
 * Fitting a trend to those same three or four readings would be worse — with
 * ±2.5 points of noise, a slope from readings an hour apart is mostly noise, and
 * projecting along it multiplies the noise. So the RATE is measured over the
 * longer stretch since the last watering (up to TREND_WINDOW), where it is well
 * determined, with the Theil–Sen estimator (the median of all pairwise slopes,
 * which one bad reading cannot drag). Each recent reading is carried forward to
 * the newest reading's time along that rate, and the median is taken of those.
 *
 * Readings the validation stage has marked unusable (probe out of the soil,
 * unplugged, past the water reading) never enter the median.
 */

import type { Reading } from '../devices';

/** look back this far from the newest reading */
const WINDOW_MS = 6 * 3600 * 1000;
/** and use at most this many readings */
const MAX_READINGS = 4;
/** a rise this large between two readings is a watering, not drying or noise */
const STEP_PTS = 6;
/** the drying rate is measured over at most this much of the current dry-down */
const TREND_WINDOW_MS = 24 * 3600 * 1000;
/** and needs at least this many readings spanning at least TREND_MIN_SPAN_MS */
const TREND_MIN_POINTS = 4;
const TREND_MIN_SPAN_MS = 6 * 3600 * 1000;
/** physically plausible rates, index points per hour (drying is negative) */
const SLOPE_MIN_PER_H = -1.5;
const SLOPE_MAX_PER_H = 0.5;
/** cap on readings used for the pairwise slopes (keeps it O(40²)) */
const TREND_MAX_POINTS = 40;
/** reading-to-reading noise of a seated capacitive probe, index points */
export const READING_NOISE_PTS = 2.5;

const UNUSABLE = new Set(['not-inserted', 'disconnected', 'beyond-wet', 'invalid']);

export interface SoilLevel {
  /** the index the decision should use */
  pct: number;
  /** readings it rests on */
  n: number;
  /** SD from reading noise, after taking the median of n readings */
  noiseSd: number;
  /** SD from how the sensor's scale was obtained (lib/sensing/autoCalibration) */
  scaleSd: number;
  /** both together, points */
  sd: number;
  /** drying (−) or wetting (+) rate used to carry readings forward, points/hour; 0 when not measurable */
  slopePerHour: number;
}

/** Theil–Sen slope (median of pairwise slopes), points per hour. */
function theilSenPerHour(pts: { t: number; v: number }[]): number {
  const slopes: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dtH = (pts[j].t - pts[i].t) / 3600000;
      if (dtH > 0) slopes.push((pts[j].v - pts[i].v) / dtH);
    }
  }
  return slopes.length ? median(slopes) : 0;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * The soil level now. `latest` is the newest reading (normally also the last row
 * of `history`); both must already be calibration-corrected. Null only when
 * there is no usable reading at all.
 */
export function currentSoilLevel(latest: Reading | null | undefined, history: Reading[] = []): SoilLevel | null {
  const rows = [...history];
  if (latest && !rows.some((r) => r.created_at === latest.created_at)) rows.push(latest);
  const pts = rows
    .filter((r) => typeof r.soil_pct === 'number' && Number.isFinite(r.soil_pct) && !UNUSABLE.has(r.soil_quality ?? 'ok'))
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.soil_pct as number, sd: r.soil_sd }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);

  // The newest reading is unusable (e.g. probe pulled out): say what it says,
  // with no smoothing to hide the problem behind older good readings.
  if (!pts.length || (latest && UNUSABLE.has(latest.soil_quality ?? 'ok'))) {
    if (!latest || typeof latest.soil_pct !== 'number' || !Number.isFinite(latest.soil_pct)) return null;
    const scaleSd = latest.soil_sd ?? 15;
    return { pct: latest.soil_pct, n: 1, noiseSd: READING_NOISE_PTS, scaleSd, sd: Math.hypot(READING_NOISE_PTS, scaleSd), slopePerHour: 0 };
  }

  // The current dry-down: everything since the last watering. A watering is a
  // SUSTAINED rise — the median of up to three readings from here on sits STEP_PTS
  // above the median of the three before. Comparing single readings instead would
  // call ordinary noise a watering about once a day: two readings ±2.5 apart differ
  // by 6 or more roughly 4 % of the time.
  // Because both sides are medians, the test also passes one reading either side of
  // the true step; the watering itself is the biggest single jump among those.
  const sustainedRiseAt = (i: number): boolean =>
    median(pts.slice(i, i + 3).map((p) => p.v)) - median(pts.slice(Math.max(0, i - 3), i).map((p) => p.v)) >= STEP_PTS;
  let start = 0;
  for (let i = pts.length - 1; i > 0; i--) {
    if (!sustainedRiseAt(i)) continue;
    let best = i;
    for (let j = Math.max(1, i - 2); j <= i; j++) {
      if (sustainedRiseAt(j) && pts[j].v - pts[j - 1].v > pts[best].v - pts[best - 1].v) best = j;
    }
    start = best;
    break;
  }
  const segment = pts.slice(start);
  const newest = segment[segment.length - 1];

  // Its rate, where there is enough of it to measure.
  const trendPts = segment.filter((p) => newest.t - p.t <= TREND_WINDOW_MS).slice(-TREND_MAX_POINTS);
  const span = trendPts.length ? newest.t - trendPts[0].t : 0;
  const slopePerHour = trendPts.length >= TREND_MIN_POINTS && span >= TREND_MIN_SPAN_MS
    ? Math.max(SLOPE_MIN_PER_H, Math.min(SLOPE_MAX_PER_H, theilSenPerHour(trendPts)))
    : 0;

  // The last few readings, each carried forward to the newest reading's time.
  const win = segment.filter((p) => newest.t - p.t <= WINDOW_MS).slice(-MAX_READINGS);
  const carried = win.map((p) => p.v + slopePerHour * ((newest.t - p.t) / 3600000));
  const pct = Math.round(median(carried) * 10) / 10;
  const n = win.length;
  // The median of n is a little less efficient than the mean; 1.25 covers that.
  const noiseSd = n === 1 ? READING_NOISE_PTS : (READING_NOISE_PTS * 1.25) / Math.sqrt(n);
  const scaleSd = newest.sd ?? 15;
  return {
    pct,
    n,
    noiseSd: Math.round(noiseSd * 100) / 100,
    scaleSd,
    sd: Math.round(Math.hypot(noiseSd, scaleSd) * 100) / 100,
    slopePerHour: Math.round(slopePerHour * 1000) / 1000,
  };
}
