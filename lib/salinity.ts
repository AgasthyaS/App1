import type { Reading } from './devices';
import { containerThresholds } from './soilProfile';
import type { Plant } from './types';
import { potVolume } from './watering';

/**
 * SALT, AND THE SENSOR IT QUIETLY RUINS.
 *
 * Prof. Dana Porter's point, and it is the one failure in this whole system that
 * gets WORSE the longer everything appears to be working: salts build up in the
 * medium, and the sensor deteriorates in them.
 *
 * Two separate harms, and conflating them would lose both.
 *
 * THE PLANT is harmed because dissolved salts lower the osmotic potential of the
 * soil solution. Water moves from high potential to low, so a root sitting in a
 * salty solution has to work against the gradient to drink — and past a point it
 * cannot, which produces a plant that wilts in wet soil, scorches at the leaf
 * margins, and is routinely misdiagnosed as underwatered and watered more, which
 * makes it worse.
 *
 * THE SENSOR is harmed twice over. A capacitive probe measures bulk permittivity,
 * and dissolved ions raise the apparent permittivity of the soil solution — so a
 * salting pot READS WETTER at the same real water content. The drift is slow,
 * monotonic, and utterly plausible, which is the dangerous combination: nothing
 * looks broken, the numbers just gradually stop being true. And physically the
 * salts attack the probe's coating, which is why Prof. Porter's other suggestion
 * — a casing — matters, and why `PROBE_CASING_ADVICE` below is stated rather than
 * left as folklore.
 *
 * ────────────────────────── HOW THE DRIFT IS DETECTED ────────────────────────
 *
 * The signature is a DECOUPLING, and that is what makes it findable at all.
 *
 * If a pot's dry-end readings climb over months, there are two explanations: it
 * is genuinely holding more water, or it reads higher for the same water. Those
 * make opposite predictions about TIME. A pot that truly holds more water takes
 * LONGER to dry out. A pot whose readings have simply inflated dries in exactly
 * the same time as before — the number moved, the physics did not.
 *
 * So: rising pre-watering minima WITH a flat or shortening dry-down time is the
 * fingerprint of salt. Rising minima with a lengthening dry-down is a pot that
 * has genuinely changed — a repot, a cooler room, a plant that lost roots.
 *
 * This is reported as "consistent with", never as a diagnosis, because a probe
 * pushed deeper produces the same drift and the app cannot see hands.
 *
 * ─────────────────────────── AND WHAT TO DO ABOUT IT ─────────────────────────
 *
 * Leaching: apply enough water that a known share of it drains out, carrying
 * dissolved salts with it. Standard practice is a leaching fraction of 15–20%,
 * i.e. apply the deficit divided by (1 − LF).
 *
 * The critical qualification, and Prof. Porter stated it as a condition rather
 * than a footnote: THE SOIL MUST BE WELL DRAINED. Pouring a large volume through
 * a pot with no drainage hole does not remove salt, it dissolves the salt and
 * leaves the solution in the bottom of the pot, concentrating it around exactly
 * the roots it was meant to protect. So this refuses to recommend leaching where
 * there is nowhere for the water to go, and says why.
 */

/** Standard greenhouse leaching fraction: this share of what is applied drains away. */
const LEACH_FRACTION = 0.2;
/** A drift needs at least this many days of evidence to mean anything. */
const MIN_DRIFT_DAYS = 21;
/** …and at least this many dry-down cycles. */
const MIN_CYCLES = 3;
/** Points of upward baseline drift per month before it is worth mentioning. */
const DRIFT_PTS_PER_MONTH = 1.5;
/** The dry-down time must be flat or falling within this ratio to count as decoupled. */
const DRYDOWN_FLAT_RATIO = 1.15;
/** Waterings between leaches when feeding regularly — nursery practice. */
export const LEACH_EVERY_N_FEEDS = 4;

export const PROBE_CASING_ADVICE =
  'Salts corrode the probe itself, not just the plant. A snug sleeve of heat-shrink or a thin conformal coating over the electronics end — leaving the sensing blade bare below the safe-insertion line — keeps the crystallised salt off the circuitry where it does permanent damage. Rinse the blade under a tap and dry it whenever you repot.';

export type SaltRisk = 'unknown' | 'low' | 'watch' | 'likely';

export interface SalinityAssessment {
  risk: SaltRisk;
  /** upward drift of the dry-end baseline, display points per 30 days */
  driftPtsPerMonth: number | null;
  /** how the dry-down time changed over the same window — the decoupling test */
  dryDownRatio: number | null;
  /** days of evidence behind this */
  observedDays: number;
  cycles: number;
  /** true when the pot cannot be leached safely as it stands */
  leachingBlocked: boolean;
  /** millilitres for a leaching irrigation, when one is safe and warranted */
  leachMl: number | null;
  headline: string;
  detail: string;
  action: string | null;
  /** 0–100, for ranking against everything else demanding attention */
  severity: number;
}

type SaltPlant = Pick<Plant,
  'potSize' | 'potCm' | 'potHeightCm' | 'potShape' | 'potMaterial'
  | 'soilMix' | 'soilRetention' | 'hasDrainage' | 'probeDepthCm' | 'waterLog'
> & { id?: string; species?: string; comfortBand?: [number, number] | null };

/** Least-squares slope of y against x. Null when the inputs cannot support one. */
function slope(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den > 0 ? num / den : null;
}

/**
 * The millilitres that would leach this pot, and whether it is safe to.
 *
 * `deficitMl` is the water needed to bring the medium back to capacity; the
 * leaching volume is that divided by (1 − LF), so the surplus runs through and
 * takes dissolved salts with it. Capped at what a pot can physically accept in
 * one pass — a genuinely salty pot wants two or three slow passes, not a flood,
 * and saying so is more useful than quoting a number nobody can pour.
 */
export function leachingVolume(
  plant: SaltPlant,
  deficitMl: number,
): { ml: number | null; safe: boolean; note: string } {
  const liters = potVolume(plant).liters;
  if (plant.hasDrainage === false) {
    return {
      ml: null,
      safe: false,
      note:
        'This pot is set as having no drainage hole, so it cannot be leached. Water poured through has nowhere to go: the salt dissolves, settles in the bottom of the pot, and ends up more concentrated around the roots than before. The fix is a drainage hole or a repot, not more water.',
    };
  }
  const raw = deficitMl / (1 - LEACH_FRACTION);
  // Half the pot's volume in one pass is already a lot of water going through.
  const cap = liters * 1000 * 0.5;
  const ml = Math.round(Math.min(raw, cap) / 25) * 25;
  return {
    ml: ml > 0 ? ml : null,
    safe: true,
    note:
      raw > cap
        ? `Pour it in two or three slow passes rather than all at once — poured in one go most of it channels straight down the sides and leaches nothing.`
        : `About ${Math.round(LEACH_FRACTION * 100)}% of this runs out of the base, carrying dissolved salts with it. Empty the saucer afterwards, or the salt goes straight back up.`,
  };
}

/**
 * Whether this pot's readings are drifting the way a salting pot's readings drift.
 */
export function salinityAssessment(
  plant: SaltPlant,
  history: Reading[],
  now = Date.now(),
): SalinityAssessment {
  const base: SalinityAssessment = {
    risk: 'unknown',
    driftPtsPerMonth: null,
    dryDownRatio: null,
    observedDays: 0,
    cycles: 0,
    leachingBlocked: plant.hasDrainage === false,
    leachMl: null,
    headline: 'Not enough history to judge salt build-up',
    detail:
      'Salt shows up as a slow upward drift in the dry-end readings, so it takes a few watering cycles across several weeks before there is anything to see.',
    action: null,
    severity: 0,
  };

  const pts = history
    .filter((r) => r.soil_pct != null && Number.isFinite(r.soil_pct))
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.soil_pct as number }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 20) return base;

  const observedDays = (pts[pts.length - 1].t - pts[0].t) / 86400000;
  if (observedDays < MIN_DRIFT_DAYS) return { ...base, observedDays: Math.round(observedDays) };

  /*
   * THE DRY-END BASELINE. Every watering is preceded by a minimum — the driest
   * the pot got that cycle. Those minima are the right series to trend, because
   * they are the one moment in each cycle when the medium is in a comparable
   * state, so a change between them is a change in the medium or the sensor
   * rather than in where we happened to look.
   */
  /*
   * CYCLES ARE FOUND IN THE READINGS, NOT IN THE WATERING LOG.
   *
   * The first version cut the history at each logged pour. That fails twice
   * over. It depends on the owner logging every watering, which is the one
   * assumption this codebase keeps learning not to make — and it depends on
   * `observedPours` recognising each of them, which it does not always, so the
   * segments came out ragged and of wildly unequal length. The dry-down
   * comparison then measured the raggedness rather than the pot: in simulation
   * it reported the same 0.40 ratio for a pot that was drying at a constant
   * rate and for one that was genuinely slowing down, which is precisely the
   * distinction the whole test exists to make.
   *
   * A refill is visible in the readings themselves — it is the only thing that
   * makes a drying curve go sharply back up — so the cycles are detected from
   * the trace directly. That works for the unlogged waterings too, which in
   * practice are most of them.
   */
  const REFILL_RISE_PTS = 5;
  const boundaries: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].v - pts[i - 1].v >= REFILL_RISE_PTS) {
      // one boundary per refill, not one per sample of a multi-step rise
      if (!boundaries.length || pts[i].t - boundaries[boundaries.length - 1] > 24 * 3600000) {
        boundaries.push(pts[i].t);
      }
    }
  }

  const minima: { t: number; v: number }[] = [];
  const cycleHours: number[] = [];
  let segStart = pts[0].t;
  for (const cut of [...boundaries, pts[pts.length - 1].t]) {
    const seg = pts.filter((p) => p.t >= segStart && p.t < cut);
    // A cycle needs to be a real dry-down, not a two-sample blip.
    if (seg.length >= 6 && cut - segStart >= 24 * 3600000) {
      const lo = seg.reduce((a, b) => (b.v < a.v ? b : a));
      minima.push(lo);
      cycleHours.push((cut - segStart) / 3600000);
    }
    segStart = cut;
  }
  if (minima.length < MIN_CYCLES) {
    return { ...base, observedDays: Math.round(observedDays), cycles: minima.length };
  }

  const days = minima.map((m) => (m.t - minima[0].t) / 86400000);
  const perDay = slope(days, minima.map((m) => m.v));
  const driftPtsPerMonth = perDay != null ? perDay * 30 : null;

  /*
   * THE DECOUPLING TEST. Compare how long the first half of the cycles took
   * against the second half. A pot genuinely holding more water takes longer;
   * a pot whose readings have merely inflated takes the same time or less.
   */
  const half = Math.floor(cycleHours.length / 2);
  const early = cycleHours.slice(0, half);
  const late = cycleHours.slice(half);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const dryDownRatio = early.length && late.length && mean(early) > 0 ? mean(late) / mean(early) : null;

  const drifting = driftPtsPerMonth != null && driftPtsPerMonth >= DRIFT_PTS_PER_MONTH;
  const decoupled = dryDownRatio != null && dryDownRatio <= DRYDOWN_FLAT_RATIO;

  const risk: SaltRisk =
    !drifting ? 'low'
      : decoupled ? 'likely'
        : 'watch';

  // What a leach would cost, from where the pot sits now.
  const geo = {
    potHeightCm: plant.potHeightCm ?? 16,
    soilMix: plant.soilMix ?? null,
    soilRetention: plant.soilRetention ?? null,
    probeDepthCm: plant.probeDepthCm ?? null,
  };
  const th = containerThresholds(geo);
  const latest = pts[pts.length - 1].v;
  const deficitPts = Math.max(0, th.capacityReading - latest);
  const perPointGuess = potVolume(plant).liters * 1000 * 0.004;
  const leach = leachingVolume(plant, Math.max(100, deficitPts * perPointGuess));

  const driftText =
    driftPtsPerMonth != null
      ? `${driftPtsPerMonth >= 0 ? '+' : ''}${driftPtsPerMonth.toFixed(1)} points a month at the dry end`
      : 'no measurable drift';

  if (risk === 'low') {
    return {
      risk,
      driftPtsPerMonth,
      dryDownRatio,
      observedDays: Math.round(observedDays),
      cycles: minima.length,
      leachingBlocked: plant.hasDrainage === false,
      leachMl: null,
      severity: 0,
      headline: 'No sign of salt building up',
      detail: `Across ${minima.length} watering cycles over ${Math.round(observedDays)} days the dry-end readings have held steady (${driftText}). Salt shows up as those readings creeping upward while the pot dries in the same time as ever.`,
      action: null,
    };
  }

  if (risk === 'watch') {
    return {
      risk,
      driftPtsPerMonth,
      dryDownRatio,
      observedDays: Math.round(observedDays),
      cycles: minima.length,
      leachingBlocked: plant.hasDrainage === false,
      leachMl: null,
      severity: 25,
      headline: 'The dry-end readings are climbing, but the pot is also drying more slowly',
      detail: `The driest point of each cycle has risen ${driftText}, which on its own could mean salt. But this pot now takes ${((dryDownRatio ?? 1) * 100 - 100).toFixed(0)}% longer to dry than it did, and salt does not slow drying — inflated readings dry in the same time as ever. Something has genuinely changed here: a repot, a cooler or darker spot, or a plant that has lost roots and is drinking less.`,
      action: 'Worth a look at the roots and at where it is standing, rather than a leach.',
    };
  }

  return {
    risk,
    driftPtsPerMonth,
    dryDownRatio,
    observedDays: Math.round(observedDays),
    cycles: minima.length,
    leachingBlocked: plant.hasDrainage === false,
    leachMl: leach.ml,
    severity: plant.hasDrainage === false ? 55 : 45,
    headline: 'Readings are drifting upward the way a salting pot drifts',
    detail:
      `Over ${minima.length} cycles and ${Math.round(observedDays)} days the driest point of each cycle has risen ${driftText}, while the time it takes to dry has NOT lengthened (${((dryDownRatio ?? 1)).toFixed(2)}× the earlier cycles). ` +
      'That combination is the fingerprint of dissolved salts rather than of a wetter pot: fertiliser residue and the minerals in tap water raise what a capacitive probe reads at the same real water content, so the number climbs while the physics stays put. ' +
      'It matters for the plant too — salty soil is harder for roots to drink from, which looks exactly like thirst and gets treated with more water. ' +
      'It could also be a probe that has been pushed deeper since; if you have moved it, that explains this and there is nothing to fix.',
    action: leach.safe
      ? `Leach it: water with about ${leach.ml} ml so a fifth runs out of the base. ${leach.note} ${plant.waterLog?.length ? `Doing this every ${LEACH_EVERY_N_FEEDS} waterings keeps it from returning.` : ''}`
      : leach.note,
  };
}
