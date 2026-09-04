import type { Reading } from './devices';
import type { Plant } from './types';
import { perPointFor } from './waterBalance';

/**
 * "THE SOIL JUMPED — DID YOU WATER IT?"
 *
 * The single biggest hole in the watering model is not arithmetic, it is missing
 * input. Everything the app knows about a specific pot — millilitres per point,
 * where it tops out, whether the advice was any good — comes from pours whose
 * AMOUNT the owner stated. People water plants all the time without opening an
 * app, and every one of those waterings is a measurement the sensor watched in
 * full and then threw away, because nobody typed a number.
 *
 * The sensor cannot see millilitres, but it sees the jump perfectly: a rise of
 * thirty points inside one reading interval is not evaporation running backwards,
 * it is a watering can. So the app can do the one thing that recovers the lost
 * data — notice, and ask.
 *
 * ─────────────────────────── WHAT COUNTS AS A JUMP ───────────────────────────
 *
 * A fixed threshold does not work across pots. Twelve points is a clear watering
 * in a peat pot whose reading swings from 15 to 60, and impossible in a gritty
 * cactus mix where the probe only travels a few points between soaked and bone
 * dry. So the bar is the LARGER of a small absolute floor and a share of the
 * range that pot has actually been observed to move through — the pot's own
 * scale, not an assumed one.
 *
 * ──────────────────────────── WHEN NOT TO ASK ────────────────────────────────
 *
 * Asking badly is worse than not asking. The rules are deliberately conservative:
 * only jumps from the last two weeks (nobody remembers a pour from March), never
 * one already covered by a logged watering, never one the owner has said no to,
 * and never before the soil has settled — asking mid-spike would collect an
 * amount attached to a reading that is still moving.
 */

/** Never ask about anything older than this — the answer would be a guess. */
const ASK_WINDOW_DAYS = 14;
/** Wait for the pour to settle before asking, so the recorded rise is the real one. */
const SETTLE_MIN_H = 4;
/** A logged watering this close to a jump means the jump is already accounted for. */
const PAIR_WINDOW_H = 12;
/** Absolute floor — below this it is noise or a nudged probe, whatever the pot. */
const MIN_JUMP_PTS = 8;
/** …or this share of the range the pot has actually been seen to move through. */
const JUMP_SHARE_OF_RANGE = 0.25;

export interface UnloggedWatering {
  /** when the risen reading first appeared — the timestamp to log against */
  at: number;
  fromPct: number;
  peakPct: number;
  /** where it sat once it had drained, when a settled reading exists yet */
  settledPct: number | null;
  risePts: number;
  /** the app's best guess at the amount, for pre-filling the answer */
  estimatedMl: number | null;
  /** how confident that guess is — 'measured' means this pot is calibrated */
  estimateBasis: string;
  text: string;
}

type JumpPlant = Pick<
  Plant,
  'potSize' | 'potCm' | 'potHeightCm' | 'potShape' | 'probeDepthCm' | 'potMaterial'
  | 'soilMix' | 'soilRetention' | 'hasDrainage' | 'waterLog' | 'ignoredJumps'
> & { id?: string; species?: string; comfortBand?: [number, number] | null };

/**
 * Waterings the sensor saw but nobody recorded, newest first.
 *
 * Returns only jumps still worth asking about — recent, settled, unlogged and
 * not previously dismissed.
 */
export function unloggedWaterings(
  plant: JumpPlant,
  history: Reading[],
  now = Date.now(),
): UnloggedWatering[] {
  const pts = history
    .filter((r) => r.soil_pct != null && Number.isFinite(r.soil_pct))
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.soil_pct as number }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 3) return [];

  // The pot's own scale: how far this probe has actually been seen to travel.
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  const threshold = Math.max(MIN_JUMP_PTS, (hi - lo) * JUMP_SHARE_OF_RANGE);

  const logged = (plant.waterLog ?? [])
    .map((w) => new Date(w.at).getTime())
    .filter((t) => Number.isFinite(t));
  const ignored = new Set(
    (plant.ignoredJumps ?? []).map((s) => Math.round(new Date(s).getTime() / 60000)),
  );

  const out: UnloggedWatering[] = [];
  const cutoff = now - ASK_WINDOW_DAYS * 86400000;

  for (let i = 1; i < pts.length; i++) {
    const rise = pts[i].v - pts[i - 1].v;
    if (rise < threshold) continue;
    const at = pts[i].t;
    if (at < cutoff) continue;
    // Give the pour time to settle before asking — and before recording a rise.
    if (now - at < SETTLE_MIN_H * 3600000) continue;
    if (logged.some((t) => Math.abs(t - at) <= PAIR_WINDOW_H * 3600000)) continue;
    if (ignored.has(Math.round(at / 60000))) continue;

    // Walk to the top of the rise — a pour can still be climbing across two or
    // three readings, and the peak is what the ceiling logic will compare against.
    let j = i;
    while (j + 1 < pts.length && pts[j + 1].v > pts[j].v) j += 1;
    const peakPct = pts[j].v;

    const settled = pts.find((p) => p.t - at >= SETTLE_MIN_H * 3600000 && p.t - at <= 26 * 3600000);
    const effective = settled?.v ?? peakPct;
    const risePts = effective - pts[i - 1].v;
    if (risePts < threshold) continue;

    /*
     * Pre-fill with the app's own best guess so answering is a confirmation
     * rather than an act of recall. On a calibrated pot this is genuinely close;
     * on an uncalibrated one it is the geometric estimate and says so, because a
     * confident-looking wrong number is worse than an obviously rough one.
     */
    const pp = perPointFor(plant, history, pts[i - 1].v, now);
    const estimatedMl = pp.mlPerPoint > 0
      ? Math.max(25, Math.round((risePts * pp.mlPerPoint) / 25) * 25)
      : null;

    const when = (() => {
      const h = (now - at) / 3600000;
      if (h < 24) return `${Math.round(h)} h ago`;
      const d = Math.round(h / 24);
      return d === 1 ? 'yesterday' : `${d} days ago`;
    })();

    out.push({
      at,
      fromPct: pts[i - 1].v,
      peakPct,
      settledPct: settled?.v ?? null,
      risePts: Math.round(risePts * 10) / 10,
      estimatedMl,
      estimateBasis: pp.basis,
      text: `The soil jumped from ${Math.round(pts[i - 1].v)}% to ${Math.round(effective)}% ${when}. That looks like a watering — if it was, telling Greenr roughly how much you poured is the single most useful thing you can do for this plant's accuracy.`,
    });
    i = j; // don't re-report the same rise from its intermediate steps
  }

  return out.sort((a, b) => b.at - a.at);
}

/** The most recent one worth asking about, or null. */
export function pendingWateringQuestion(
  plant: JumpPlant,
  history: Reading[],
  now = Date.now(),
): UnloggedWatering | null {
  return unloggedWaterings(plant, history, now)[0] ?? null;
}
