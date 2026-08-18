import type { Reading } from './devices';
import type { Plant } from './types';
import { perPointFor, poursAndCeiling, type ObservedPour } from './waterBalance';

/**
 * GRADING THE APP'S OWN ADVICE.
 *
 * Everything else in the watering model measures the POT. This measures the
 * MODEL: for each watering, what did Greenr say to pour, what was actually
 * poured, and what did the soil then do? Those three numbers together answer a
 * question the app could not previously ask about itself — "was the 900 ml we
 * recommended right?" — and the answer is a correction rather than an anecdote.
 *
 * ─────────────────────────────── THE ARITHMETIC ──────────────────────────────
 *
 * A recommendation is never just a volume. It is a volume PLUS a claim about
 * what that volume will do, and the two together imply a belief about the pot:
 *
 *     believed ml per point  =  suggested ml ÷ predicted rise
 *
 * The watering that follows tests it directly:
 *
 *     measured ml per point  =  poured ml ÷ actual rise
 *
 * and their ratio is the error, as a factor. On the pot that prompted this, the
 * app suggested 975 ml expecting +6.6 points — a belief of 148 ml per point. The
 * owner poured 400 ml and the soil rose 46 points: 8.7 ml per point. The advice
 * was not slightly off, it was seventeen times off, and the app had no way to
 * notice because it never compared the two.
 *
 * ────────────────────────── WHAT COUNTS AS EVIDENCE ──────────────────────────
 *
 * Only pours the owner actually stated. An `assumed` amount is the app's own
 * suggestion logged back when someone tapped "done", and grading a suggestion
 * against itself always returns a perfect score.
 *
 * And a pour that FILLED the pot is excluded from the ratio, because its rise
 * stopped at the ceiling while its millilitres did not — it can prove the advice
 * was too generous, never that it was correct.
 */

export interface DoseCheck {
  at: number;
  /** what Greenr recommended at the time */
  suggestedMl: number;
  /** what was actually poured */
  pouredMl: number;
  actualRisePts: number;
  /** ml-per-point the recommendation implied */
  believedMlPerPoint: number | null;
  /** ml-per-point the pour actually demonstrated */
  measuredMlPerPoint: number;
  /** believed ÷ measured. >1 means the app asked for too much */
  factor: number | null;
  /** where the soil would have ended up had the suggestion been poured */
  wouldHaveReachedPct: number | null;
  /** true when following the advice would have pushed it past its ceiling */
  wouldHaveOverflowed: boolean;
  saturated: boolean;
  verdict: string;
}

export interface DoseAccuracy {
  checks: DoseCheck[];
  /** typical error factor across the graded pours; 1.0 is perfect */
  medianFactor: number | null;
  /** how many pours could actually be graded */
  graded: number;
  /** logged pours that could not be graded, and why they were skipped */
  skippedAssumed: number;
  skippedSaturated: number;
  /** enough agreeing evidence to say the advice was systematically off */
  confident: boolean;
  /**
   * 'over'/'under'/'good' grade GREENR's advice. 'overpoured' grades the OWNER:
   * every watering filled the pot because far more than the suggested amount went
   * in, which is a different problem with a different fix.
   */
  direction: 'over' | 'under' | 'good' | 'overpoured' | 'unknown';
  /** typical poured ÷ suggested — how closely the advice is being followed */
  followFactor: number | null;
  headline: string;
  detail: string;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Within this factor either way, the advice was as good as the sensor can tell. */
const GOOD_ENOUGH = 1.25;

type AccuracyPlant = Pick<
  Plant,
  'potSize' | 'potCm' | 'potHeightCm' | 'potShape' | 'probeDepthCm' | 'potMaterial'
  | 'soilMix' | 'soilRetention' | 'hasDrainage' | 'waterLog'
> & { id?: string };

export function doseAccuracy(
  plant: AccuracyPlant,
  history: Reading[],
  now = Date.now(),
): DoseAccuracy | null {
  const { pours, ceiling } = poursAndCeiling(plant, history, now);
  const log = plant.waterLog ?? [];

  // Pair each observed pour back to its log entry, which is where the suggestion
  // and the source live.
  const byTime = (at: number) =>
    log.find((w) => w.ml != null && Math.abs(new Date(w.at).getTime() - at) < 90 * 60000);

  let skippedAssumed = 0;
  const checks: DoseCheck[] = [];

  for (const p of pours as ObservedPour[]) {
    const entry = byTime(p.at);
    if (!entry) continue;
    if (entry.source === 'assumed') { skippedAssumed += 1; continue; }

    const suggestedMl = entry.suggestedMl ?? null;
    const predicted = entry.predictedRisePts ?? null;
    const believed = suggestedMl != null && predicted != null && predicted > 0
      ? suggestedMl / predicted
      : null;
    const measured = p.mlPerPoint;
    // A saturating pour bounds the answer rather than measuring it, so the factor
    // it implies is a floor on the error, never the error itself.
    const factor = believed != null && measured > 0 && !p.saturated ? believed / measured : null;

    const wouldHaveReachedPct = suggestedMl != null && measured > 0
      ? Math.min(100, p.fromPct + suggestedMl / measured)
      : null;
    const ceilingPct = ceiling?.pct ?? null;
    const wouldHaveOverflowed =
      wouldHaveReachedPct != null && ceilingPct != null && wouldHaveReachedPct > ceilingPct + 2;

    const verdict = (() => {
      if (suggestedMl == null) return `Poured ${p.ml} ml; the soil rose ${p.risePts.toFixed(0)} points.`;
      if (p.saturated) {
        return `Greenr suggested ${suggestedMl} ml and you poured ${p.ml} ml, which already filled the pot — so ${suggestedMl} ml would have run straight out of the base.`;
      }
      if (factor == null) return `Poured ${p.ml} ml against a suggested ${suggestedMl} ml; the soil rose ${p.risePts.toFixed(0)} points.`;
      if (factor > GOOD_ENOUGH) {
        return `Greenr suggested ${suggestedMl} ml. Your ${p.ml} ml moved the soil ${p.risePts.toFixed(0)} points, which means ${suggestedMl} ml would have taken it to about ${Math.round(wouldHaveReachedPct ?? 0)}% — the suggestion was ${factor.toFixed(1)}× too generous.`;
      }
      if (factor < 1 / GOOD_ENOUGH) {
        return `Greenr suggested ${suggestedMl} ml, and your ${p.ml} ml only moved the soil ${p.risePts.toFixed(0)} points — the suggestion was ${(1 / factor).toFixed(1)}× too small for this pot.`;
      }
      return `Greenr suggested ${suggestedMl} ml and your ${p.ml} ml behaved as predicted — the amount is right for this pot.`;
    })();

    checks.push({
      at: p.at,
      suggestedMl: suggestedMl ?? 0,
      pouredMl: p.ml,
      actualRisePts: Math.round(p.risePts * 10) / 10,
      believedMlPerPoint: believed != null ? Math.round(believed * 10) / 10 : null,
      measuredMlPerPoint: Math.round(measured * 10) / 10,
      factor: factor != null ? Math.round(factor * 100) / 100 : null,
      wouldHaveReachedPct: wouldHaveReachedPct != null ? Math.round(wouldHaveReachedPct) : null,
      wouldHaveOverflowed,
      saturated: p.saturated,
      verdict,
    });
  }

  if (!checks.length) return null;

  const factors = checks.map((c) => c.factor).filter((f): f is number => f != null && f > 0);
  const medianFactor = factors.length ? median(factors) : null;
  const skippedSaturated = checks.filter((c) => c.saturated).length;

  /*
   * WHOSE FAULT WAS IT? When every pour filled the pot there is no ratio to take,
   * and an earlier version therefore reported "Not enough graded waterings yet" to
   * someone who had just flooded their plant seven times running — while the
   * detail line directly below it said "7 of them filled the pot". The headline
   * contradicted the evidence, and the one genuinely useful thing the app could
   * say went unsaid.
   *
   * It also matters WHO caused the flood. Pouring roughly what was suggested and
   * overflowing means the advice was too big. Pouring four times the suggestion
   * and overflowing means the advice was probably fine and the habit is not — the
   * opposite conclusion, and the opposite fix.
   */
  const follows = checks
    .filter((c) => c.suggestedMl > 0)
    .map((c) => c.pouredMl / c.suggestedMl);
  const followFactor = follows.length ? median(follows) : null;
  const allFlooded = checks.length >= 2 && checks.every((c) => c.saturated);

  const direction: DoseAccuracy['direction'] =
    allFlooded && followFactor != null && followFactor > 1.5 ? 'overpoured'
      : allFlooded ? 'over'
        : medianFactor == null ? 'unknown'
          : medianFactor > GOOD_ENOUGH ? 'over'
            : medianFactor < 1 / GOOD_ENOUGH ? 'under'
              : 'good';

  // Two graded pours that agree, or one that overflowed the pot so decisively
  // that the direction is not in question.
  const confident =
    (factors.length >= 2 && Math.max(...factors) / Math.min(...factors) <= 2.5) ||
    checks.some((c) => c.wouldHaveOverflowed);

  // Quote the engine's figure at the moisture the last graded pour started from,
  // so the correction is stated where it was actually tested.
  const lastFrom = pours.find((p) => p.at === checks[checks.length - 1].at)?.fromPct ?? 30;
  const current = perPointFor(plant, history, lastFrom, now);

  const headline =
    direction === 'overpoured'
      ? `Every watering has filled this pot — you are pouring about ${followFactor!.toFixed(1)}× what Greenr suggests`
      : direction === 'over' && medianFactor != null
        ? `Greenr was asking for about ${medianFactor.toFixed(1)}× too much water`
        : direction === 'over'
          ? 'Greenr’s amounts have been filling this pot — they are too big'
          : direction === 'under' ? `Greenr was asking for about ${(1 / medianFactor!).toFixed(1)}× too little`
            : direction === 'good' ? 'Greenr’s amounts have been right for this pot'
              : 'Not enough graded waterings yet';

  const detail = [
    `Graded ${checks.length} watering${checks.length === 1 ? '' : 's'} where you told Greenr how much you actually poured.`,
    skippedAssumed
      ? `${skippedAssumed} more were logged without an amount, so they cannot grade anything — tap the amount when you water and they will.`
      : '',
    skippedSaturated
      ? (direction === 'overpoured'
          ? `${skippedSaturated} of them filled the pot and ran out of the base, so the extra never reached the roots — it just sat in the saucer, which is what rots them.`
          : `${skippedSaturated} of them filled the pot, which proves the suggestion was too big but cannot say by how much.`)
      : '',
    direction === 'over' || direction === 'under'
      ? `Greenr now works on ${current.mlPerPoint} ml per point for this pot, corrected from what you poured.`
      : '',
  ].filter(Boolean).join(' ');

  return {
    checks,
    medianFactor: medianFactor != null ? Math.round(medianFactor * 100) / 100 : null,
    followFactor: followFactor != null ? Math.round(followFactor * 100) / 100 : null,
    graded: checks.length,
    skippedAssumed,
    skippedSaturated,
    confident,
    direction,
    headline,
    detail,
  };
}
