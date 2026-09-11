import type { Reading } from './devices';
import { PROBE, mlPerPointPerLiter } from './soilProfile';
import type { Plant } from './types';
import { plateauAfterPour } from './substrateCalibration';
import { observedPours, poursAndCeiling } from './waterBalance';
import { potVolume } from './watering';

/**
 * IS THE PROBE ACTUALLY IN THE SOIL?
 *
 * Prof. Scott Jones set aside the hard version of this problem — modelling the
 * air gaps around a probe properly means getting into the electronegativity of
 * the soil–water–air system, and he is right that it belongs to a later and much
 * more complex piece of work. But he pointed at the tractable half, and it is
 * the half that actually bites people: a probe that is simply not pushed in far
 * enough.
 *
 * The physical situation is unforgiving. A capacitive blade senses along its
 * WHOLE buried length and averages what it finds. Air has a relative
 * permittivity of about 1 and water about 80, so a blade half out of the soil
 * does not read "half" — it is dominated by the air gap and reads close to
 * bone-dry regardless of how wet the soil is. The plant can be sitting in mud
 * and the app will say 6%.
 *
 * That failure is invisible from a single reading, because 6% is a perfectly
 * legitimate reading for a dry pot. It becomes visible from BEHAVIOUR, and this
 * module is a set of four behavioural tests, none of which is conclusive alone.
 *
 * ─────────────────────────────── THE FOUR TESTS ──────────────────────────────
 *
 * 1. IT BARELY RESPONDS TO WATER. The decisive one. A known volume of water into
 *    a known pot must move the reading by roughly a predictable amount. If a
 *    litre goes into a 5 litre pot and the reading lifts two points, the water
 *    went somewhere the blade cannot see. This is the test that separates "dry"
 *    from "not in the soil", because a genuinely dry pot responds dramatically —
 *    the retention curve is steepest at the dry end, so a dry pot moves MORE per
 *    millilitre, not less.
 *
 * 2. IT IS PINNED AT THE BOTTOM OF THE SCALE. A blade mostly in air sits near the
 *    air reading and stays there. Weak on its own — gritty mixes legitimately
 *    live in single figures — which is why it never fires alone here.
 *
 * 3. IT IS NOISY. Soil damps a capacitive reading; air does not. A blade with a
 *    length exposed picks up far more sample-to-sample scatter, and unlike
 *    everything else on this list, noise is hard to fake by being dry.
 *
 * 4. IT DRIES IMPLAUSIBLY FAST. The top centimetre of any pot dries within hours
 *    of a watering while the root zone stays damp for days. A probe reading the
 *    surface reports the surface's drying rate, which is far too fast for the
 *    pot it is supposedly measuring.
 *
 * Any one of these has an innocent explanation. Together they do not.
 */

/** Below this buried depth the manufacturer's own reading is not meaningful. */
const SHALLOW_CM = PROBE.minUsefulCm;
/** A pour should lift the reading at least this share of what geometry predicts. */
const RESPONSE_FLOOR = 0.5;
/** Median absolute step, in points, above which a reading is unusually scattered. */
const NOISY_STEP_PTS = 2.2;
/** A pot that loses this many points a day is drying at surface speed, not pot speed. */
const SURFACE_DRYING_PTS_PER_DAY = 9;
/** Half the rise gone inside this many hours means the water was never in the pot. */
const VANISHING_RISE_H = 14;
/** Readings this low, sustained, are close to the air reading. */
const PINNED_PCT = 8;
/** Enough readings before any of this means anything. */
const MIN_SAMPLES = 20;

export type InsertionVerdict = 'unknown' | 'seated' | 'suspect' | 'likely-shallow';

export interface ProbeInsertion {
  verdict: InsertionVerdict;
  /** which of the four tests fired */
  signals: {
    weakResponse: boolean;
    pinnedLow: boolean;
    noisy: boolean;
    driesLikeSurface: boolean;
    /** the rise from a watering is gone within hours — a surface, not a pot */
    risesVanish: boolean;
    statedShallow: boolean;
  };
  /** observed rise ÷ predicted rise for logged pours, when there are any */
  responseRatio: number | null;
  /** measured sample-to-sample scatter, display points */
  noisePts: number | null;
  /** observed decline, display points per day */
  ptsPerDay: number | null;
  /** hours for a watering's rise to halve — days in a real pot, hours on a surface */
  riseHalfLifeH: number | null;
  /** 0–100 */
  severity: number;
  headline: string;
  detail: string;
  action: string | null;
}

type InsertPlant = Pick<Plant,
  'potSize' | 'potCm' | 'potHeightCm' | 'potShape' | 'potMaterial'
  | 'soilMix' | 'soilRetention' | 'hasDrainage' | 'probeDepthCm' | 'waterLog'
> & { id?: string; species?: string; comfortBand?: [number, number] | null };

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function probeInsertion(
  plant: InsertPlant,
  history: Reading[],
  now = Date.now(),
): ProbeInsertion {
  const none: ProbeInsertion = {
    verdict: 'unknown',
    signals: { weakResponse: false, pinnedLow: false, noisy: false, driesLikeSurface: false, risesVanish: false, statedShallow: false },
    responseRatio: null,
    noisePts: null,
    ptsPerDay: null,
    riseHalfLifeH: null,
    severity: 0,
    headline: 'Not enough readings to tell how deep the probe is',
    detail: 'Greenr works this out from how the pot behaves rather than from anything it can see, so it needs a couple of weeks of readings and at least one logged watering.',
    action: null,
  };

  const pts = history
    .filter((r) => r.soil_pct != null && Number.isFinite(r.soil_pct))
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.soil_pct as number }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  if (pts.length < MIN_SAMPLES) return none;

  /* ── 1. RESPONSE TO A KNOWN POUR ─────────────────────────────────────────── */
  /*
   * `saturated` is the wrong filter here for the same reason it was wrong in the
   * substrate calibration: it marks every pour whose peak lands near the pot's
   * highest-ever reading, which for anyone who waters consistently is all of
   * them. Filtered that way this test had nothing to work with and reported
   * every probe as seated, including one deliberately simulated as sitting in
   * air. The plateau test asks the physical question instead — did this pour
   * deliver the rise it bought.
   */
  const { ceiling } = poursAndCeiling(plant, history, now);
  const allPours = observedPours(plant, history, ceiling, now).filter((p) => p.ml > 0);
  const pours = allPours.filter((p) => !plateauAfterPour(p, history, plant).plateaued);
  const liters = potVolume(plant).liters;
  const ratios = pours
    .map((p) => {
      // What geometry says the rise should have been, at the level it started from.
      const perPoint = Math.max(1, mlPerPointPerLiter(p.fromPct) * liters);
      const predicted = p.ml / perPoint;
      return predicted > 0.5 ? p.risePts / predicted : null;
    })
    .filter((r): r is number => r != null && Number.isFinite(r));
  const responseRatio = median(ratios);
  const weakResponse = responseRatio != null && ratios.length >= 1 && responseRatio < RESPONSE_FLOOR;

  /* ── 2. PINNED NEAR THE AIR READING ──────────────────────────────────────── */
  const sorted = [...pts.map((p) => p.v)].sort((a, b) => a - b);
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  const pinnedLow = p90 < PINNED_PCT;

  /* ── 3. SCATTER ──────────────────────────────────────────────────────────── */
  const steps: number[] = [];
  for (let i = 1; i < pts.length; i++) steps.push(Math.abs(pts[i].v - pts[i - 1].v));
  const noisePts = median(steps);
  const noisy = noisePts != null && noisePts > NOISY_STEP_PTS;

  /* ── 3b. DOES THE RISE LAST? ──────────────────────────────────────────────
   *
   * The signal that finally separated a shallow probe from a genuinely dry
   * gritty pot, both of which read low, dry fast and are noisy.
   *
   * A pot HOLDS water. However fast the medium drains, a watering that reached
   * the root zone is still detectable a day later — even a gritty cactus mix
   * takes well over a day to give up half of what it took. A blade sitting in
   * the top centimetre is not measuring the pot at all, it is measuring the
   * surface, and a surface is dry again in hours. So the half-life of the rise
   * after a watering is close to a direct read on whether the sensor is in the
   * pot or on top of it.
   *
   * This is the one test on the list that a legitimately fast-draining pot
   * cannot imitate, because the limit is not the medium's drainage — it is how
   * little water a centimetre of surface can hold.
   */
  const halfLives: number[] = [];
  for (const q of allPours) {
    const peak = q.peakPct;
    const base = q.fromPct;
    if (peak - base < 2) continue;
    const half = base + (peak - base) / 2;
    const after = pts.filter((x) => x.t > q.at);
    const crossing = after.find((x) => x.v <= half);
    if (crossing) halfLives.push((crossing.t - q.at) / 3600000);
  }
  const riseHalfLifeH = median(halfLives);
  const risesVanish = riseHalfLifeH != null && riseHalfLifeH < VANISHING_RISE_H;

  /* ── 4. SURFACE-SPEED DRYING ─────────────────────────────────────────────── */
  const declines: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const dh = (pts[i].t - pts[i - 1].t) / 3600000;
    if (dh > 0.5 && dh < 12) {
      const drop = pts[i - 1].v - pts[i].v;
      if (drop > 0) declines.push((drop / dh) * 24);
    }
  }
  const ptsPerDay = median(declines);
  const driesLikeSurface = ptsPerDay != null && ptsPerDay > SURFACE_DRYING_PTS_PER_DAY;

  /* ── the owner's own statement, when they gave one ───────────────────────── */
  const statedShallow =
    plant.probeDepthCm != null && Number.isFinite(plant.probeDepthCm) && plant.probeDepthCm < SHALLOW_CM;

  const signals = { weakResponse, pinnedLow, noisy, driesLikeSurface, risesVanish, statedShallow };
  const fired = Object.values(signals).filter(Boolean).length;

  /*
   * WEIGHTING. `weakResponse` is worth more than the rest put together, because
   * it is the only one a genuinely dry pot cannot produce: the retention curve
   * is steepest when dry, so a dry pot responds to water MORE than predicted,
   * never less. The others are corroboration.
   */
  const strong = (weakResponse ? 1 : 0) + (risesVanish ? 1 : 0);
  const verdict: InsertionVerdict =
    statedShallow ? 'likely-shallow'
      : strong === 2 ? 'likely-shallow'
        : strong === 1 && fired >= 3 ? 'likely-shallow'
          : strong === 1 ? 'suspect'
            : fired >= 3 ? 'suspect'
              : 'seated';

  if (verdict === 'seated') {
    return {
      verdict,
      signals,
      responseRatio,
      noisePts,
      ptsPerDay,
      riseHalfLifeH,
      severity: 0,
      headline: 'The probe looks properly seated',
      detail:
        responseRatio != null
          ? `Waterings move the reading by about ${Math.round(responseRatio * 100)}% of what the pot's size predicts, which is the range a blade fully in the soil gives.`
          : 'Nothing in the readings suggests the blade is sitting in air. Log a watering with an amount and Greenr can check this properly.',
      action: null,
    };
  }

  const reasons = [
    weakResponse && responseRatio != null
      ? `waterings move the reading only ${Math.round(responseRatio * 100)}% as far as the pot's size says they should`
      : null,
    pinnedLow ? `the reading almost never rises above ${Math.round(p90)}%, which is close to what this sensor gives in open air` : null,
    noisy && noisePts != null ? `consecutive readings jump by ${noisePts.toFixed(1)} points, and soil damps a probe far more than air does` : null,
    driesLikeSurface && ptsPerDay != null ? `it loses about ${Math.round(ptsPerDay)} points a day, which is how fast a pot's top centimetre dries, not its root zone` : null,
    risesVanish && riseHalfLifeH != null ? `half of what each watering gains is gone within ${Math.round(riseHalfLifeH)} hours, and no pot gives water up that fast — a surface does` : null,
    statedShallow ? `you recorded the probe as ${(plant.probeDepthCm as number).toFixed(1)} cm in, and the blade senses ${PROBE.sensingCm} cm` : null,
  ].filter(Boolean) as string[];

  const likely = verdict === 'likely-shallow';
  return {
    verdict,
    signals,
    responseRatio,
    noisePts,
    ptsPerDay,
    riseHalfLifeH,
    severity: likely ? 72 : 40,
    headline: likely
      ? 'The probe is probably not pushed far enough into the soil'
      : 'Something about this probe’s readings suggests it may not be fully in the soil',
    detail:
      `${reasons.join('; ')}. ` +
      'A capacitive blade averages along its whole buried length, and air reads as almost perfectly dry — so a blade half out does not read half, it reads close to zero however wet the soil is. ' +
      'That is worth ruling out before anything else here, because every number Greenr shows for this plant is built on the reading.',
    action: `Push it in up to the safe-insertion line — the blade senses ${PROBE.sensingCm} cm and needs at least ${SHALLOW_CM} cm buried — angling it slightly so it sits among the roots rather than against the side of the pot. Then water as normal and check back in a day; the response should roughly double.`,
  };
}

/**
 * The dose engine should not learn from a pot whose probe is in the air.
 *
 * A shallow probe under-reports every rise, so every millilitre-per-point derived
 * from it comes out far too high — and that error feeds the suggested amount,
 * which is how a plant ends up being told to pour a litre into a pot that needed
 * two hundred. Callers use this to hold the measurement rather than bank it.
 */
export function insertionBlocksLearning(ins: ProbeInsertion): boolean {
  return ins.verdict === 'likely-shallow';
}
