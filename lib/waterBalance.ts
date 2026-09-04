import type { Reading } from './devices';
import { MAX_SINGLE_POUR_FRACTION, PROBE, containerThresholds, probeReads, waterFractionBetween } from './soilProfile';
import { retentionEstimate, withMeasuredRetention } from './soilRetention';
import type { Plant, PotShape } from './types';
import { getSpecies } from './plants';
import { potVolume, wettingFor } from './watering';

/**
 * HOW MUCH WATER MOVES THE READING — measured, not assumed.
 *
 * This module exists because of a real failure, found in real data. The app told
 * the owner of a 30 × 29 cm Peace lily to pour 975 ml and predicted the soil
 * would rise 6.6 points. They poured 400 ml. The soil rose 46 points, the pot ran
 * out into its saucer, and it landed comfortably inside the safe band.
 *
 * Reconstructed from that plant's own history, across three logged pours:
 *
 *     poured 1050 ml → predicted  +0.0 pts → actual +49 pts
 *     poured  975 ml → predicted  +6.6 pts → actual +47 pts     model 7×  too high
 *     poured  400 ml → predicted  +2.8 pts → actual +46 pts     model 16× too high
 *
 * Every one of those pours drove the probe to exactly 78%, which is that pot
 * telling us where its ceiling is. The old model was not slightly out. It was
 * asking for an order of magnitude more water than the pot can hold.
 *
 * ─────────────────────────────── WHY IT WAS WRONG ────────────────────────────────
 *
 * The chain was: (ml per point per litre) × (WHOLE POT volume) × leaching × depth
 * correction. For that pot: 5.18 × 16.6 L × 1.33 × 1.50 = 171 ml per point.
 *
 * Two of those terms are mistakes, and they compound:
 *
 *  1. THE VOLUME IS THE WRONG VOLUME. The probe senses a fixed top 6.5 cm — about
 *     22% of a 29 cm pot. Water poured onto the surface wets that layer first and
 *     the reading responds to it. Charging the pour for all 16.6 litres assumes
 *     the entire column must change water content in step with the probe, which is
 *     not what happens when you pour water into the top of a pot.
 *
 *  2. THE DEPTH CORRECTION THEN SCALES IT UP AGAIN, by 1.5× (clamped down from
 *     2.0×). It was built to answer a different question — "the roots below the
 *     probe hold water it cannot see, so a deficit measured at the probe
 *     understates the pot" — which is true for judging DRYNESS and wrong for
 *     sizing a POUR. Applied here it double-counts the very depth that made term 1
 *     too big.
 *
 * Substituting the probe-zone volume and dropping the depth correction predicts
 * 25.2 ml/point for the Peace lily (measured ~20.7) and 13.0 for the Areca palm
 * (measured 14.7) — both within about 20%, from geometry alone, on two pots that
 * the old chain missed by 7× and 17×.
 *
 * ──────────────────────── AND WHY MEASUREMENT STILL DECIDES ──────────────────────
 *
 * Geometry gets the prior close. It cannot know how root-bound the pot is, how
 * much of the "soil" is actually root, or how hydrophobic the compost has gone —
 * all of which move the answer by a factor of two. So the prior is only ever a
 * starting point, and any real pour outranks it.
 *
 * With one crucial correction, which is the subtle part: A POUR THAT SATURATES
 * THE POT IS NOT A MEASUREMENT. If 400 ml and 975 ml both end at 78%, the pot hit
 * its ceiling somewhere below 400 ml and the rest ran out of the base. Dividing
 * millilitres by the rise then gives a number that is too HIGH, and gets higher
 * the more you over-pour — which is exactly backwards, and is how three pours that
 * all proved the pot needs less water could be read as evidence that it needs
 * more. Saturating pours are therefore treated as UPPER BOUNDS, never as points.
 */

/**
 * How far below the probe tip the soil still moves in step with the probe zone.
 *
 * Capillary continuity means the layer immediately under the blade wets and dries
 * with it rather than independently. Kept deliberately small: the further below
 * the blade you claim, the closer this gets to the whole-pot assumption that
 * caused the original error.
 */
const TRANSITION_CM = 2.0;

/** The reading a pot that genuinely needs water sits at — the dry end of the ramp. */
const DRY_ANCHOR_PCT = 8;

/** Shape factors, mirrored from lib/watering so the two geometries cannot drift. */
const SHAPE_FACTOR: Record<PotShape, number> = { straight: 1.0, tapered: 0.81, 'very-tapered': 0.65 };

/**
 * Base radius as a fraction of top radius, implied by a pot's shape factor.
 *
 * For a frustum with radius r(u) = k·r + (1−k)·r·u at relative height u,
 *   V = π r² H · [k² + k(1−k) + (1−k)²/3]
 * and the bracket IS the shape factor, so k falls out of the quadratic. This
 * keeps the top-slice geometry exactly consistent with `potVolume` instead of
 * approximating a tapered pot as a cylinder.
 */
function baseRadiusRatio(shapeFactor: number): number {
  // f = k + (1 − 2k + k²)/3  ⇒  k² + k + 1 − 3f = 0  ⇒  k = (−1 + √(12f − 3)) / 2.
  // Checks: f = 1 (straight cylinder) ⇒ k = 1; f = 0.81 ⇒ k ≈ 0.80.
  const k = (-1 + Math.sqrt(Math.max(0, 12 * shapeFactor - 3))) / 2;
  return Math.max(0.2, Math.min(1, k));
}

/** Share of a frustum's volume held in its top `d` cm. */
function topSliceFraction(depthCm: number, potHeightCm: number, shape: PotShape): number {
  if (!(potHeightCm > 0) || !(depthCm > 0)) return 1;
  if (depthCm >= potHeightCm) return 1;
  const k = baseRadiusRatio(SHAPE_FACTOR[shape] ?? SHAPE_FACTOR.tapered);
  // ∫ (k + (1−k)u)² du from u0 to 1, over the same integral from 0 to 1.
  const F = (u: number) => {
    const a = k;
    const b = 1 - k;
    return a * a * u + a * b * u * u + (b * b * u * u * u) / 3;
  };
  const u0 = 1 - depthCm / potHeightCm;
  const whole = F(1) - F(0);
  return whole > 0 ? (F(1) - F(u0)) / whole : 1;
}

export interface ResponsiveVolume {
  /** the soil volume whose water content the READING actually tracks, litres */
  liters: number;
  /** the whole pot, for comparison */
  wholePotLiters: number;
  /** how much of the pot that is, 0–1 */
  fractionOfPot: number;
  /** the depth of soil it corresponds to, cm */
  depthCm: number;
  /** true when the pot is shallow enough that the probe sees essentially all of it */
  probeSeesWholePot: boolean;
  note: string;
}

/**
 * The volume that a pour has to fill in order to move the READING — the top slice
 * the probe senses, plus the thin transition below it, never more than the pot.
 *
 * In a shallow pot this is the whole pot and the old whole-pot behaviour is
 * recovered exactly; it is only in deep pots that the two diverge, which is
 * precisely where the old model failed.
 */
export function responsiveVolume(
  plant: Pick<Plant, 'potSize' | 'potCm' | 'potHeightCm' | 'potShape' | 'probeDepthCm' | 'soilMix' | 'soilRetention'>,
  /**
   * The current reading. Supplying it matters: how deep the pot is dry decides
   * how much of it a pour has to re-wet.
   *
   * A pot that was watered yesterday is still near capacity below the probe, so
   * a top-up only has to fill the top slice — that is the case that was being got
   * badly wrong. A pot that has been dry for a fortnight is dry all the way down,
   * and filling only the top slice would leave the root ball parched while the
   * probe cheerfully reported "back in range". Both are real, and which one you
   * are in is readable from the reading itself: the retention curve converts it
   * into how far the water table has fallen below the pot, which IS the depth of
   * the dry zone. So the responsive volume grows with dryness rather than being
   * fixed, and the two failure modes cannot both be live at once.
   */
  atPct?: number | null,
): ResponsiveVolume {
  const whole = potVolume(plant);
  const potH = typeof plant.potHeightCm === 'number' && Number.isFinite(plant.potHeightCm) && plant.potHeightCm > 0
    ? plant.potHeightCm
    : null;
  const probeCm = Math.min(plant.probeDepthCm ?? PROBE.insertCm, PROBE.insertCm);
  const sensed = probeCm + TRANSITION_CM;

  if (potH == null) {
    // Depth unknown: the top-slice fraction is unknowable, so don't pretend. The
    // whole pot is the honest fallback, and it is what the app did before.
    return {
      liters: whole.liters,
      wholePotLiters: whole.liters,
      fractionOfPot: 1,
      depthCm: 0,
      probeSeesWholePot: false,
      note: 'Pot depth unknown, so the amount is still based on the whole pot — set the depth and this gets far more accurate for deep pots.',
    };
  }

  /*
   * How far the dryness reaches, as a SMOOTH function of the reading.
   *
   * The obvious implementation — take `inferWaterTableDepth` and use it directly
   * as the depth to wet — was tried and is unusable. The van Genuchten inversion
   * is near-vertical at the dry end, so the depth jumps from "the top slice" to
   * "the entire pot" between two adjacent readings: a 30 × 29 cm pot went from
   * 47 ml/point at 20% soil to 198 at 10%, quadrupling the recommended dose over
   * a change the sensor can barely resolve. Advice that lurches like that is
   * worse than advice that is slightly wrong, because nobody can trust it.
   *
   * So the ramp runs on the READING, which is smooth, between the pot's own
   * just-drained value and the dry anchor. Squaring it keeps the extra volume
   * shut off through the normal range and opens it only when the pot really is
   * drying out throughout, which is the case it exists for.
   */
  const capacityRead = probeReads(
    { potHeightCm: potH, soilMix: plant.soilMix ?? null, soilRetention: plant.soilRetention ?? null, probeDepthCm: plant.probeDepthCm ?? null },
    0,
  );
  const dryness =
    atPct != null && Number.isFinite(atPct) && capacityRead > DRY_ANCHOR_PCT
      ? Math.max(0, Math.min(1, (capacityRead - atPct) / (capacityRead - DRY_ANCHOR_PCT)))
      : 0;
  const depthCm = Math.min(potH, sensed + (potH - sensed) * dryness * dryness);
  const fraction = topSliceFraction(depthCm, potH, plant.potShape ?? 'tapered');
  const liters = whole.liters * fraction;
  const probeSeesWholePot = potH <= sensed + 0.01;

  return {
    liters,
    wholePotLiters: whole.liters,
    fractionOfPot: fraction,
    depthCm,
    probeSeesWholePot,
    note: probeSeesWholePot
      ? 'This pot is shallow enough that the probe reads essentially all of it, so the amount is based on the whole pot.'
      : `The probe reads the top ${depthCm.toFixed(1)} cm — about ${Math.round(fraction * 100)}% of this ${whole.liters.toFixed(1)} L pot (${liters.toFixed(1)} L). Water poured on top wets that layer first, so that is the volume a pour has to fill to move the reading.`,
  };
}

/* ───────────────────────────── THE POT'S OWN CEILING ───────────────────────────── */

/** A peak within this many points of the highest ever seen counts as "saturated". */
const CEILING_TOLERANCE_PTS = 4;
/** Below this the reading is noise rather than a response. */
const MIN_MEASURABLE_RISE = 4;

/** Two pours must differ by at least this factor before agreeing proves a ceiling. */
const CEILING_VOLUME_SPREAD = 1.3;

/**
 * How far above the comfort band a ceiling has to sit before it means flooding.
 *
 * Not zero, and that matters: a GOOD watering lands right at the top of the band
 * by design, so "max ≥ band ceiling" brands correct advice as over-watering — it
 * did, turning "these amounts are right" into "they are too big". A ceiling only
 * means the pot is being flooded when it is being driven clearly PAST where the
 * plant should sit. The real Peace lily topped out 23 points above its ceiling.
 */
const CEILING_ABOVE_BAND_PTS = 8;

export interface Ceiling {
  /** the highest reading this pot has ever reached */
  pct: number;
  /** how many separate WATERINGS topped out within tolerance of it */
  hits: number;
  /** true once two separate waterings agree on the same ceiling */
  confirmed: boolean;
  /** …and their volumes differed too, which is the strongest form of the evidence */
  strong: boolean;
}

/**
 * Where this pot tops out.
 *
 * Container capacity is observed, not modelled: pour enough and the reading stops
 * rising, because the pot cannot hold more and the rest leaves through the base.
 *
 * THE TEST HAS TO BE MORE THAN "THIS IS THE HIGHEST READING", which is what an
 * earlier version of this function checked and is circular — the highest reading
 * is always the highest reading, so a single generous watering looked like proof
 * of a ceiling and every later dose was capped by it. On the Areca palm that
 * wrongly branded its one and only pour as saturating and threw away the only
 * clean measurement available.
 *
 * The real signature of a ceiling is DIFFERENT VOLUMES REACHING THE SAME PLACE:
 * 1050 ml, 975 ml and 400 ml all ending at 78% is the pot stating its limit,
 * because the extra 650 ml demonstrably went somewhere other than the soil.
 */
export function ceilingFor(
  history: Reading[],
  pours?: { ml: number; peakPct: number }[],
  /**
   * The species' comfort band. Supplied because it is what separates a real
   * ceiling from a coincidence — see below.
   */
  band?: [number, number] | null,
): Ceiling | null {
  const pts = history
    .filter((r) => r.soil_pct != null && Number.isFinite(r.soil_pct))
    .map((r) => r.soil_pct as number);
  if (pts.length < 3) return null;
  const max = Math.max(...pts);

  const topped = (pours ?? []).filter((p) => p.peakPct >= max - CEILING_TOLERANCE_PTS);
  const volumes = topped.map((p) => p.ml);
  const spread = volumes.length >= 2 ? Math.max(...volumes) / Math.min(...volumes) : 1;
  return {
    pct: max,
    hits: topped.length,
    /*
     * TWO SEPARATE WATERINGS ENDING AT THE SAME READING IS THE PROOF. Differing
     * volumes make it stronger, but requiring them was a hole big enough to drive
     * the worst case through: someone who pours the same excessive amount every
     * time produces no spread at all, so the ceiling was never confirmed, every
     * flooding pour was banked as a clean measurement, and the pot's ml-per-point
     * came out 2.5× too high — which made the app recommend MORE water to the one
     * user already drowning their plant. Seven identical 1000 ml pours all ending
     * at exactly 78% read as "measured, 20.9 ml per point" against a true 8.2.
     *
     * The residual risk is real and it bit: two pours of the same size from the
     * same starting point land on the same reading for ordinary reasons, and
     * branding that a ceiling turned a suggestion that was too SMALL into "you
     * are over-pouring" — the opposite diagnosis.
     *
     * What separates the two is WHERE the pot tops out. A ceiling only means
     * flooding if the pot is being driven above the range the plant wants to sit
     * in; a maximum below the comfort ceiling just means it has never been filled.
     * The real Peace lily topped out at 78% against a 55% ceiling, which is the
     * signature. Without a band to compare against, fall back to demanding that
     * the volumes differ, which is weaker evidence but cannot be coincidence.
     */
    confirmed: topped.length >= 2 && (band ? max >= band[1] + CEILING_ABOVE_BAND_PTS : spread >= CEILING_VOLUME_SPREAD),
    /** volumes that differ as well — the strongest form of the evidence */
    strong: topped.length >= 2 && spread >= CEILING_VOLUME_SPREAD,
  };
}

/** Water is still draining and redistributing for a few hours after a pour. */
const SETTLE_MIN_H = 4;
/** How far back to look for the pre-pour low, covering a late log or clock skew. */
const BASELINE_LOOKBACK_H = 6;
const SETTLE_MAX_H = 26;

export interface ObservedPour {
  at: number;
  ml: number;
  fromPct: number;
  /** the highest the reading got — the wetting front passing the probe */
  peakPct: number;
  /** where it sat once the pot had drained, 4–26 h later; null if not seen yet */
  settledPct: number | null;
  /** the rise that MATTERS: settled where known, peak otherwise */
  risePts: number;
  /** how much of the peak drained away again */
  fallbackPts: number | null;
  /** the pot hit its ceiling, so this pour proves only an UPPER bound on ml/point */
  saturated: boolean;
  /** ml per point implied — a measurement when not saturated, a ceiling when it is */
  mlPerPoint: number;
}

/**
 * Every logged pour matched to what the soil actually did afterwards.
 *
 * Duplicate log entries are collapsed: the app has been seen to record the same
 * pour several times within a second when a button is double-tapped, and counting
 * those as independent evidence would fake confidence out of one observation.
 */
/**
 * `ceiling` is optional and, when omitted, saturation is simply not flagged —
 * which is what `ceilingFor` needs, since it has to see the pours before it can
 * decide where the ceiling is. Callers wanting both use `poursAndCeiling`.
 */
export function observedPours(
  plant: Pick<Plant, 'waterLog'>,
  history: Reading[],
  ceiling: Ceiling | null,
  now = Date.now(),
): ObservedPour[] {
  const pts = history
    .filter((r) => r.soil_pct != null && Number.isFinite(r.soil_pct))
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.soil_pct as number }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return [];

  const seen = new Set<string>();
  const out: ObservedPour[] = [];
  for (const w of plant.waterLog ?? []) {
    if (w.ml == null || !(w.ml > 0)) continue;
    /*
     * AN ASSUMED AMOUNT IS NOT EVIDENCE. Two screens log the app's own
     * recommendation when the owner taps "done" without stating a volume. Reading
     * those back as measurements is circular in the worst way: the suggestion that
     * produced the number becomes the proof the number was right, the pot's
     * ml-per-point locks onto whatever the model already believed, and no amount
     * of real watering can shift it. Recorded, shown in the timeline, never
     * learned from.
     */
    if (w.source === 'assumed') continue;
    const t = new Date(w.at).getTime();
    if (!Number.isFinite(t) || now - t > 60 * 86400000) continue;
    // One pour per minute per volume — collapses double-tapped log entries.
    const key = `${Math.round(t / 60000)}|${w.ml}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const before = pts.filter((p) => p.t <= t);
    const after = pts.filter((p) => p.t > t && p.t - t <= 30 * 3600000);
    if (!before.length || !after.length) continue;

    /*
     * THE BASELINE IS THE LOW POINT BEFORE THE POUR, not simply the last reading
     * before the logged time.
     *
     * Those are the same thing only when the log lands before the first reading
     * that shows the rise — and that ordering is not guaranteed. Someone who
     * waters and taps "log" an hour later, or a device whose clock is a few
     * minutes off, puts the log AFTER a reading that has already jumped. The
     * previous reading is then the risen one, the computed rise comes out at or
     * below zero, and the pour is dropped. Silently: three logged pours produced
     * zero usable measurements and the pot simply never calibrated, with nothing
     * on screen to say why.
     *
     * Taking the minimum across the few hours around the log is robust either
     * way, and it is what "where the soil was before this watering" means.
     */
    const baselineWindow = before.filter((p) => t - p.t <= BASELINE_LOOKBACK_H * 3600000);
    const fromPct = baselineWindow.length
      ? Math.min(...baselineWindow.map((p) => p.v))
      : before[before.length - 1].v;
    const peakPct = Math.max(...after.map((p) => p.v));

    /*
     * PEAK IS NOT THE ANSWER. A pour sends a wetting front down through the pot,
     * and the probe sits in the top 6.5 cm where that front arrives first and
     * strongest. The reading spikes, then falls back over the next few hours as
     * the water drains on down and the profile re-equilibrates.
     *
     * Dosing off the spike would size every future watering by a number that had
     * already half-disappeared by the next morning — the pot would read "watered"
     * and be dry again by lunchtime. So where a settled reading exists it is the
     * one used, and the spike is kept only to recognise saturation.
     */
    const settleWindow = after.filter(
      (p) => p.t - t >= SETTLE_MIN_H * 3600000 && p.t - t <= SETTLE_MAX_H * 3600000,
    );
    const settledPct = settleWindow.length ? settleWindow[0].v : null;
    const effectivePct = settledPct ?? peakPct;
    const risePts = effectivePct - fromPct;
    if (risePts < MIN_MEASURABLE_RISE) continue;

    out.push({
      at: t,
      ml: w.ml,
      fromPct,
      peakPct,
      settledPct,
      risePts,
      fallbackPts: settledPct != null ? Math.round((peakPct - settledPct) * 10) / 10 : null,
      saturated: ceiling != null && peakPct >= ceiling.pct - CEILING_TOLERANCE_PTS,
      mlPerPoint: w.ml / risePts,
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * Pours and the ceiling together, resolving the chicken-and-egg between them:
 * the ceiling is defined by which pours topped out, and which pours count as
 * topped out is defined by the ceiling. Two passes settles it.
 */
export function poursAndCeiling(
  plant: Pick<Plant, 'waterLog'> & { species?: string; comfortBand?: [number, number] | null },
  history: Reading[],
  now = Date.now(),
): { pours: ObservedPour[]; ceiling: Ceiling | null } {
  // The band comes from the plant itself so every caller gets the stronger test
  // without having to remember to pass it.
  const band = plant.comfortBand ?? (plant.species ? getSpecies(plant.species)?.band ?? null : null);
  const first = observedPours(plant, history, null, now);
  const ceiling = ceilingFor(history, first.map((p) => ({ ml: p.ml, peakPct: p.peakPct })), band);
  // Only a CONFIRMED ceiling may brand a pour as saturating; an unconfirmed one
  // is just the highest reading so far, which proves nothing.
  const pours = observedPours(plant, history, ceiling?.confirmed ? ceiling : null, now);
  return { pours, ceiling };
}

/* ──────────────────────────── RECONCILING THE ESTIMATES ─────────────────────────── */

/**
 * Uncertainty of each source, as a standard deviation in LOG space — because
 * these quantities are uncertain by FACTORS, not by millilitres. Combining them
 * by inverse variance then does the obvious right thing: a tight measurement
 * dominates a loose prior, two loose sources still sharpen each other, and
 * nothing has to be hand-tuned.
 */
/** The geometric prior is good to roughly a factor of two — root volume, packing
 *  and compost condition are all invisible to it. ln(2) ≈ 0.69. */
const SD_MODEL = 0.69;
/** A clean, non-saturating pour with a large rise. Sensor noise is ±2–3 points, so
 *  the relative error is set by how big the rise was. */
const SD_POUR_FLOOR = 0.15;
const SENSOR_NOISE_PTS = 2.5;
/** The water-balance cross-check inherits the spread of the daily-use band. */
const SD_BALANCE = 0.8;

export type PerPointBasis = 'measured' | 'blended' | 'bounded' | 'modelled';

export interface PerPointEstimate {
  /** millilitres that move this pot's reading by one point */
  mlPerPoint: number;
  basis: PerPointBasis;
  /** 0–1 */
  confidence: number;
  /** the geometric prior on its own */
  fromModel: number;
  /** the measured value from clean pours, when there are any */
  fromPours: number | null;
  /** the tightest upper bound proved by a pour that saturated the pot */
  upperBound: number | null;
  /** independent cross-check from the drying curve, when there is enough history */
  fromBalance: number | null;
  cleanPours: number;
  saturatedPours: number;
  note: string;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * The pot's millilitres-per-point, from every source that has something to say.
 *
 * `atPct` is where the soil sits now: a display point is worth far more water when
 * the soil is dry than when it is wet, so the prior is read off the Topp curve's
 * local slope rather than a single constant.
 */
export function perPointFor(
  plant: Pick<Plant, 'potSize' | 'potCm' | 'potHeightCm' | 'potShape' | 'probeDepthCm' | 'potMaterial' | 'soilMix' | 'soilRetention' | 'hasDrainage' | 'waterLog'>
    & Pick<Plant, 'measurementMemory'>
    & { id?: string; species?: string; comfortBand?: [number, number] | null },
  history: Reading[],
  atPct: number,
  now = Date.now(),
): PerPointEstimate {
  /*
   * The MEASURED retention is applied here, not left to the caller.
   *
   * It used to be `waterAction`'s job — it substituted the measured value and
   * then asked for a dose. Every other entry point forgot, so `waterAction` said
   * 425 ml and `doseFor` said 350 ml for the identical question: retention feeds
   * the leaching fraction and the wetted depth, and one path had it while the
   * other did not. Doing it at the bottom of the stack makes the two impossible
   * to separate. It is idempotent — substituting an already-substituted value
   * changes nothing — so callers that still do it themselves stay correct.
   */
  const measured = withMeasuredRetention(plant, history);
  const rv = responsiveVolume(measured, atPct);
  const wetting = wettingFor({
    potMaterial: measured.potMaterial,
    soilMix: measured.soilMix,
    soilRetention: measured.soilRetention,
    hasDrainage: measured.hasDrainage,
  });
  // NOTE: no `profileCorrection` here, deliberately. It converts a probe-measured
  // deficit into a whole-column one, and the whole point of `responsiveVolume` is
  // that we are no longer pretending the whole column moves with the probe.
  // Applying both was the 1.5× that turned a 7× error into a 17× one.
  const fromModel = Math.max(
    0.5,
    waterFractionBetween(atPct, atPct + 1) * rv.liters * 1000 * wetting.mult,
  );

  const { pours } = poursAndCeiling(plant, history, now);
  const clean = pours.filter((p) => !p.saturated);

  /*
   * MEMORY. Everything above is computed from the last 30 days of readings, so a
   * pot calibrated by four careful pours in spring silently reverts to a
   * geometric guess in summer once those pours scroll out of the window. The
   * conclusion is still valid — the pot has not changed — so it is carried
   * forward when the evidence behind it ages out.
   *
   * Deliberately subordinate to live evidence: a remembered figure is used only
   * when the window holds NO clean pours of its own. Anything measurable today
   * beats anything remembered, because pots genuinely do change as roots fill
   * them, and `rootBoundSignal` exists precisely because that drift is real.
   */
  const remembered = plant.measurementMemory;
  const rememberedPerPoint =
    !clean.length && remembered?.mlPerPoint != null && remembered.mlPerPoint > 0
      ? remembered.mlPerPoint
      : null;
  const saturated = pours.filter((p) => p.saturated);
  const fromPours = clean.length ? median(clean.map((p) => p.mlPerPoint)) : null;
  // The smallest saturating pour proves the most: the pot topped out at or below
  // that many millilitres, so it cannot possibly need more per point than this.
  const upperBound = saturated.length ? Math.min(...saturated.map((p) => p.mlPerPoint)) : null;

  // Independent cross-check: ml/point = daily water use ÷ points lost per day.
  // Requires a measured drying rate AND a measured daily use, so it is only
  // available once a pour has been logged and the pot has been watched drying.
  const fromBalance = (() => {
    const ret = retentionEstimate(plant as Parameters<typeof retentionEstimate>[0], history);
    if (!ret || !(ret.ptsPerDay > 0)) return null;
    const use = dailyUseMl(plant, history, now);
    if (!use || !(use.mlPerDay > 0) || use.basis !== 'measured') return null;
    return use.mlPerDay / ret.ptsPerDay;
  })();

  // ── Combine, by inverse variance in log space ──
  const terms: { value: number; sd: number }[] = [{ value: fromModel, sd: SD_MODEL }];
  if (rememberedPerPoint != null) {
    // Held at the confidence it had when measured, minus a step for age.
    terms.push({ value: rememberedPerPoint, sd: SD_POUR_FLOOR * 2.5 });
  }
  if (fromPours != null) {
    // Bigger rises are measured more precisely; sensor noise sets the floor.
    const rises = clean.map((p) => p.risePts);
    const typicalRise = median(rises);
    const sdOne = Math.max(SD_POUR_FLOOR, SENSOR_NOISE_PTS / Math.max(1, typicalRise));
    terms.push({ value: fromPours, sd: sdOne / Math.sqrt(clean.length) });
  }
  if (fromBalance != null) terms.push({ value: fromBalance, sd: SD_BALANCE });

  let wsum = 0;
  let vsum = 0;
  for (const t of terms) {
    const w = 1 / (t.sd * t.sd);
    wsum += w;
    vsum += w * Math.log(Math.max(0.5, t.value));
  }
  let combined = Math.exp(vsum / wsum);

  // A proven ceiling outranks everything. If the pot demonstrably topped out on
  // 400 ml, no combination of priors gets to ask for more per point than that —
  // and the true value is somewhere BELOW the bound, so it is nudged under it.
  let bounded = false;
  if (upperBound != null && combined > upperBound * 0.9) {
    combined = upperBound * 0.9;
    bounded = true;
  }

  const basis: PerPointBasis =
    clean.length >= 2 ? 'measured'
      : rememberedPerPoint != null ? 'measured'
      : bounded ? 'bounded'
        : clean.length === 1 || fromBalance != null ? 'blended'
          : 'modelled';

  const confidence = Math.max(0, Math.min(1,
    (clean.length ? 0.45 + 0.2 * Math.min(clean.length, 3) : 0.2) +
    (fromBalance != null ? 0.1 : 0) +
    (bounded ? 0.1 : 0) +
    (rv.depthCm > 0 ? 0.1 : 0),
  ));

  const note = (() => {
    if (clean.length >= 2) return `Measured on this pot: about ${Math.round(combined)} ml moves it one point, from ${clean.length} waterings that did not overflow it.`;
    if (bounded) return `This pot topped out on a ${Math.round(Math.min(...saturated.map((p) => p.ml)))} ml watering, so it needs at most about ${Math.round(combined)} ml per point — the amounts below are capped by what it actually holds, not by the estimate.`;
    if (clean.length === 1) return `One measured watering says about ${Math.round(combined)} ml per point. One more and this becomes exact.`;
    return `Estimated from the pot: ${rv.note}`;
  })();

  return {
    mlPerPoint: Math.round(combined * 10) / 10,
    basis,
    confidence: Math.round(confidence * 100) / 100,
    fromModel: Math.round(fromModel * 10) / 10,
    fromPours: fromPours != null ? Math.round(fromPours * 10) / 10 : null,
    upperBound: upperBound != null ? Math.round(upperBound * 10) / 10 : null,
    fromBalance: fromBalance != null ? Math.round(fromBalance * 10) / 10 : null,
    cleanPours: clean.length,
    saturatedPours: saturated.length,
    note,
  };
}

/* ─────────────────────────── DAILY USE AND THE INTERVAL ────────────────────────── */

export interface DailyUse {
  mlPerDay: number;
  basis: 'measured' | 'modelled';
  /** how many days a full pot of available water lasts at this rate */
  daysOfCover: number | null;
  note: string;
}

/**
 * How much water this plant actually gets through in a day.
 *
 * The measured route is a water balance over one cycle, and it is the reason the
 * drying curve matters to the AMOUNT and not just the timing: a pour of V ml that
 * lasted T days means the plant used V/T ml a day. Combine that with how fast the
 * reading falls and you have the pot's millilitres-per-point from a completely
 * different direction than the geometry — which is what makes the two a real
 * cross-check rather than two dressings of the same assumption.
 */
export function dailyUseMl(
  plant: Pick<Plant, 'potSize' | 'potCm' | 'potHeightCm' | 'potShape' | 'probeDepthCm' | 'waterLog' | 'soilMix' | 'soilRetention'>
    & { id?: string; species?: string; comfortBand?: [number, number] | null },
  history: Reading[],
  now = Date.now(),
): DailyUse | null {
  const pts = history
    .filter((r) => r.soil_pct != null && Number.isFinite(r.soil_pct))
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.soil_pct as number }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);

  const { pours } = poursAndCeiling(plant, history, now);

  // MEASURED: a pour, then the time until the soil is back where it started.
  const rates: number[] = [];
  for (const p of pours) {
    const after = pts.filter((q) => q.t > p.at);
    const back = after.find((q) => q.v <= p.fromPct);
    if (!back) continue;
    const days = (back.t - p.at) / 86400000;
    // Under a few hours is a pour that ran straight through, not a cycle.
    if (days >= 0.25) rates.push(p.ml / days);
  }
  if (rates.length) {
    const mlPerDay = median(rates);
    return {
      mlPerDay: Math.round(mlPerDay),
      basis: 'measured',
      daysOfCover: null,
      note: `Measured: this plant gets through about ${Math.round(mlPerDay)} ml a day, from ${rates.length} watering${rates.length === 1 ? '' : 's'} timed until the soil returned to where it started.`,
    };
  }

  // MODELLED: a container plant in active growth uses a few per cent of its pot
  // volume per day. A wide band, deliberately — it is a sanity bound, not a
  // measurement, and it is labelled as such.
  const whole = potVolume(plant);
  const mlPerDay = whole.liters * 1000 * 0.04;
  return {
    mlPerDay: Math.round(mlPerDay),
    basis: 'modelled',
    daysOfCover: null,
    note: `Estimated at about ${Math.round(mlPerDay)} ml a day for a pot this size. Log a watering and Greenr measures the real figure instead.`,
  };
}

/**
 * The dose, end to end: how many millilitres to pour to move the soil from where
 * it is to where it should be, and what that is expected to do.
 *
 * Hard-capped by the pot's own observed ceiling. That cap is the difference
 * between the old behaviour and this one: a pot that has demonstrated it tops out
 * at 78% is never again asked to absorb the water it would take to reach 100%.
 */
export interface Dose {
  ml: number;
  predictedRisePts: number;
  /** where the soil is expected to land */
  predictedPct: number;
  perPoint: PerPointEstimate;
  ceiling: Ceiling | null;
  /** true when the amount was trimmed to what the pot can physically hold */
  cappedByCeiling: boolean;
  note: string;
}

export function doseFor(
  plant: Pick<Plant, 'potSize' | 'potCm' | 'potHeightCm' | 'potShape' | 'probeDepthCm' | 'potMaterial' | 'soilMix' | 'soilRetention' | 'hasDrainage' | 'waterLog'>
    & { id?: string; species?: string; comfortBand?: [number, number] | null },
  history: Reading[],
  soilPct: number,
  targetPct: number,
  now = Date.now(),
): Dose | null {
  if (!Number.isFinite(soilPct) || !Number.isFinite(targetPct)) return null;
  const perPoint = perPointFor(plant, history, soilPct, now);
  const { ceiling } = poursAndCeiling(plant, history, now);

  // Never aim past what this pot has shown it can hold. Water beyond that point
  // does not enter the soil — it goes through it and stands in the saucer, which
  // is the condition that actually rots roots.
  const reachable = ceiling?.confirmed ? Math.min(targetPct, ceiling.pct) : targetPct;
  const deficit = Math.max(0, reachable - soilPct);
  const cappedByCeiling = ceiling?.confirmed === true && targetPct > ceiling.pct;

  const rawMl = deficit * perPoint.mlPerPoint;
  // Same physical ceiling every other path respects: past a quarter of the pot in
  // one go the water runs straight through instead of soaking in.
  const capMl = MAX_SINGLE_POUR_FRACTION * potVolume(plant).liters * 1000;
  const ml = deficit <= 0 ? 0 : Math.round(Math.min(Math.max(25, Math.round(rawMl / 25) * 25), capMl));

  return {
    ml,
    predictedRisePts: Math.round((ml / perPoint.mlPerPoint) * 10) / 10,
    predictedPct: Math.round(Math.min(100, soilPct + ml / perPoint.mlPerPoint)),
    perPoint,
    ceiling,
    cappedByCeiling,
    note: cappedByCeiling
      ? `Aiming for ${Math.round(reachable)}% rather than ${Math.round(targetPct)}%: this pot has never gone above ${Math.round(ceiling!.pct)}%, so the rest would run straight out of the base.`
      : perPoint.note,
  };
}

/* ─────────────────────────────── THE SCHEDULE ─────────────────────────────── */

export interface WateringSchedule {
  /** how much to pour when it IS due */
  ml: number;
  /** how often, in days */
  everyDays: number | null;
  /** the reading at which it becomes due */
  refillAt: number;
  /** the reading a full watering takes it back to */
  capacityAt: number;
  /** measured, demand-normalised drying rate in points per day */
  ptsPerDay: number | null;
  /** days until the next watering is due, from where the soil is right now */
  daysUntilDue: number | null;
  /** how many days of readings the interval is based on */
  observedDays: number;
  basis: 'measured' | 'partly-measured' | 'modelled';
  headline: string;
  detail: string;
}

/**
 * WATER THIS MUCH, THIS OFTEN — both numbers from this pot's own month of data.
 *
 * The two halves come from different places, and that is the point:
 *
 *   HOW MUCH is a volume question. It is the water needed to take the root zone
 *   from where it is back to container capacity, through `perPointFor`, which
 *   reconciles pot geometry with every pour actually logged.
 *
 *   HOW OFTEN is a rate question, and rates cannot be modelled — a Peace lily in
 *   a bright warm room and the same plant in a cool hallway differ by a factor of
 *   three, and no species table knows which one you have. So the interval is
 *   MEASURED: the working range (container capacity down to the point the easily
 *   available water runs out, per De Boodt) divided by how fast this pot actually
 *   loses points per day, normalised for how thirsty the air was at the time.
 *
 * Both are refusable. If the pot has not been watched drying, `everyDays` is null
 * and the app says so instead of inventing a week.
 */
export function wateringSchedule(
  plant: Pick<Plant, 'potSize' | 'potCm' | 'potHeightCm' | 'potShape' | 'probeDepthCm' | 'potMaterial' | 'soilMix' | 'soilRetention' | 'hasDrainage' | 'waterLog' | 'species'> & { id?: string },
  history: Reading[],
  band: [number, number],
  now = Date.now(),
): WateringSchedule | null {
  // Same substitution as `perPointFor`, for the same reason: the thresholds and
  // the amount must be built on one view of the soil, not two.
  const measured = withMeasuredRetention(plant, history);
  const potH = typeof measured.potHeightCm === 'number' && measured.potHeightCm > 0 ? measured.potHeightCm : 16;
  const geo = {
    potHeightCm: potH,
    soilMix: measured.soilMix ?? null,
    soilRetention: measured.soilRetention ?? null,
    probeDepthCm: measured.probeDepthCm ?? null,
  };
  const th = containerThresholds(geo);

  /*
   * WHERE THE "WATER ME" LINE GOES.
   *
   * Two sources have a claim on it and they answer different questions. The
   * substrate says when the water stops being easily available — physics, true of
   * any plant in that mix. The species band says how wet this particular plant
   * likes to be kept — biology, true of the plant in any mix. Taking the higher
   * of the two respects both: a fern is never left to the physical limit just
   * because its compost could go further, and a succulent in dense compost is not
   * watered at the fern's threshold just because the mix holds water.
   */
  let refillAt = Math.max(band[0], th.refillReading);

  /*
   * WHERE "FULL" IS. Three sources, and getting the precedence wrong breaks it.
   *
   * The modelled container capacity is `probeReads(geo, 0)`, and in a DEEP pot
   * that number is small — 23.5% for a 29 cm standard mix — because at
   * hydrostatic equilibrium the top 6.5 cm the probe occupies sits at 22–29 cm of
   * tension and is genuinely the driest part of the pot. Used naively that put
   * "full" BELOW a Peace lily's 30% floor, so the working range came out negative
   * and every watering collapsed to the 25 ml minimum.
   *
   * The pot itself knows better. This one has been observed at 78% repeatedly,
   * because a real watering does not leave a pot at hydrostatic equilibrium — it
   * leaves it draining, which is where the reading actually sits when someone
   * looks. So an OBSERVED ceiling outranks the modelled one whenever there is a
   * confirmed one, and the species ceiling caps both, because for a plant that
   * resents wet feet "full" means the top of its band and not the top of the pot.
   */
  const { ceiling } = poursAndCeiling(plant, history, now);
  const modelledFull = th.capacityReading;
  // The HIGHEST reading ever recorded is a hard lower bound on what this pot
  // shows when full — it did show it. No `confirmed` gate here: confirmation
  // decides whether a POUR was saturating, which is a different question, and
  // requiring it left these two pots on a modelled 23.5% while they were sitting
  // at 69% and 53% in front of us.
  const capacityAt = Math.min(Math.max(ceiling?.pct ?? 0, modelledFull), band[1]);

  /*
   * SQUEEZED RANGE. A very retentive mix can put the substrate's refill threshold
   * ABOVE the plant's band ceiling — dense compost holding water at 52% under a
   * Monstera's 55% ceiling. Left alone that produced two wrong things at once:
   * `capacityAt` came out at 56, above the ceiling it was supposed to respect,
   * and the working range collapsed onto a magic 4-point floor, which divided by
   * the drying rate to give "water every 1 day" for the most water-retentive mix
   * in the app — exactly backwards.
   *
   * So the ceiling is hard, and the refill line is pushed DOWN to leave a real
   * working range beneath it. When that clamp bites it is worth saying out loud:
   * it means the mix holds more water than this species wants, which is a soil
   * problem rather than a watering one.
   */
  const MIN_WORKING_RANGE = 6;
  const rangeSqueezed = refillAt > capacityAt - MIN_WORKING_RANGE;
  if (rangeSqueezed) refillAt = Math.max(1, capacityAt - MIN_WORKING_RANGE);

  const soils = history
    .filter((r) => r.soil_pct != null && Number.isFinite(r.soil_pct))
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.soil_pct as number }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  const observedDays = soils.length >= 2 ? (soils[soils.length - 1].t - soils[0].t) / 86400000 : 0;

  const ret = retentionEstimate(plant, history);
  const ptsPerDay = ret && ret.ptsPerDay > 0 ? ret.ptsPerDay : null;

  const perPoint = perPointFor(plant, history, Math.max(refillAt, 1), now);
  const rawMl = Math.max(0, capacityAt - refillAt) * perPoint.mlPerPoint;
  const ml = Math.round(Math.min(
    Math.max(25, Math.round(rawMl / 25) * 25),
    MAX_SINGLE_POUR_FRACTION * potVolume(plant).liters * 1000,
  ));

  const everyDays = ptsPerDay ? Math.max(0.5, (capacityAt - refillAt) / ptsPerDay) : null;
  const latest = soils.length ? soils[soils.length - 1].v : null;
  const daysUntilDue = ptsPerDay != null && latest != null ? Math.max(0, (latest - refillAt) / ptsPerDay) : null;

  const basis: WateringSchedule['basis'] =
    ret?.confident && perPoint.cleanPours >= 1 ? 'measured'
      : ret || perPoint.cleanPours >= 1 ? 'partly-measured'
        : 'modelled';

  const dayWord = (d: number) => (d < 1.5 ? 'day' : `${Math.round(d)} days`);
  const headline = everyDays
    ? `About ${ml} ml every ${everyDays < 1.5 ? 'day' : `${Math.round(everyDays)} days`}`
    : `About ${ml} ml — still learning how often`;

  const detail = [
    `Full is ${Math.round(capacityAt)}% and this pot wants water again at ${Math.round(refillAt)}%, so a watering has ${Math.round(capacityAt - refillAt)} points of range to fill.`,
    ptsPerDay
      ? `Measured over ${Math.round(observedDays)} days of readings, it loses about ${ptsPerDay.toFixed(1)} points a day, which works out at roughly every ${dayWord(everyDays!)}.`
      : `Greenr has ${observedDays < 1 ? 'not yet watched' : `only ${Math.round(observedDays)} days of`} this pot drying, so it cannot give an honest interval yet.`,
    th.unreliable
      ? 'Note: in this pot and mix the probe barely moves between wet and dry, so treat these figures as rough.'
      : '',
    rangeSqueezed
      ? 'This mix holds water above the level this plant likes to sit at, so there is very little room between "full" and "needs water" — worth looking at the soil rather than the watering.'
      : '',
    perPoint.basis === 'modelled'
      ? 'The amount is estimated from the pot for now — log a watering with its amount and it becomes measured.'
      : '',
  ].filter(Boolean).join(' ');

  return { ml, everyDays, refillAt, capacityAt, ptsPerDay, daysUntilDue, observedDays, basis, headline, detail };
}
