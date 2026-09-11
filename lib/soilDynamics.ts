import type { Reading } from './devices';
import { waterProfileFor } from './plants';
import type { Plant } from './types';
import { soilLiters } from './watering';
import { perPointFor, poursAndCeiling } from './waterBalance';

/**
 * What the soil is DOING, not just what it reads right now.
 *
 * A single number is misleading straight after watering: soil that reads 100%
 * two minutes after a drink is not "dangerously waterlogged", it is draining —
 * exactly what should happen. Judging that instant against the ideal band scored
 * moisture 0/30 and told people to fix a problem that was really them doing the
 * right thing. So watering is treated as an EVENT with a settling curve:
 *
 *   water → saturated (expected) → drains to field capacity → dries through the
 *   ideal band → falls below it → time to water again
 *
 * While a plant is inside its expected drain window the app stays quiet and
 * simply says when the soil should be back in range. It only raises a problem if
 * the soil is STILL saturated well past when that pot should have drained —
 * which is a real signal (no drainage holes, compacted soil, a blocked saucer).
 */

/** A jump this big between consecutive readings means someone watered. */
const WATER_JUMP_PCT = 12;

export interface SoilDynamics {
  /** soil is above the ideal band, but within the normal post-watering drain window */
  draining: boolean;
  /** soil has stayed saturated longer than this pot plausibly should */
  drainageProblem: boolean;
  /** when we expect it to be back inside the ideal band */
  reachesIdealAt: Date | null;
  /** measured drying speed, % per hour (positive = drying out) */
  dryRatePerHour: number | null;
  /** when the last watering happened (logged, or detected from a soil jump) */
  wateredAt: Date | null;
  /** how long this pot should take to drain from saturated to field capacity */
  expectedDrainHours: number;
  tone: 'good' | 'warn' | 'bad' | 'unknown';
  headline: string;
  detail: string;
}

/**
 * How long this pot should take to shed excess water after a soaking. Terracotta
 * breathes and sheds fastest; plastic and glazed pots hold on to it; bigger pots
 * hold proportionally more water and take longer.
 */
export function expectedDrainHours(
  plant: Pick<Plant, 'potSize' | 'potMaterial' | 'potCm' | 'hasDrainage' | 'soilMix'> & { species?: string },
): number {
  const liters = soilLiters(plant.potSize, plant.potCm);
  let h = 6 + liters * 2.5; // ~8 h for a small pot, ~20 h for a big one
  const m = (plant.potMaterial ?? '').toLowerCase();
  if (m.includes('terra')) h *= 0.7; // porous — dries from the sides too
  else if (m.includes('plastic') || m.includes('glaz') || m.includes('ceramic')) h *= 1.2;
  // What it's potted in matters as much as the pot: grit sheds water in hours,
  // dense or compacted soil holds it for a day or more.
  switch (plant.soilMix) {
    case 'Gritty / cactus': h *= 0.5; break;
    case 'Chunky / aroid':  h *= 0.65; break;
    case 'Dense / heavy':   h *= 1.5; break;
    default: break;
  }
  // No drainage holes = water has nowhere to go; it only leaves by evaporation
  // and the roots sit in it far longer. This is the single biggest killer of
  // houseplants, so the model treats it as such.
  if (plant.hasDrainage === false) h *= 2.5;
  // The SPECIES' own curve: an orchid's bark mix sheds in minutes, a bog plant
  // holds water for days. This is what makes the model plant-specific.
  h *= waterProfileFor(plant.species).drainMult;
  return Math.max(2, Math.min(120, h));
}

/** Least-squares slope of soil% over time, in % per hour (negative = drying).
 *  Two points are enough (it reduces to a plain two-point slope) — at a 3-hourly
 *  cadence, demanding three would mean no drain estimate for ~9 hours, which is
 *  most of the window the user actually wants it for. */
function slopePerHour(pts: { t: number; v: number }[]): number | null {
  if (pts.length < 2) return null;
  const n = pts.length;
  const t0 = pts[0].t;
  const xs = pts.map((p) => (p.t - t0) / 3600000); // hours
  const ys = pts.map((p) => p.v);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return null;
  return num / den;
}

/**
 * When did this plant last get water? Prefers what the user logged; otherwise
 * infers it from a sharp upward jump in the soil trace (someone watered without
 * logging it — very common, and the sensor saw it happen).
 */
export function lastWateringAt(plant: Pick<Plant, 'lastWateredAt'>, history: Reading[]): Date | null {
  const logged = plant.lastWateredAt ? new Date(plant.lastWateredAt) : null;
  const pts = history
    .filter((r) => r.soil_pct != null && Number.isFinite(r.soil_pct))
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.soil_pct as number }));
  let detected: Date | null = null;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].v - pts[i - 1].v >= WATER_JUMP_PCT) detected = new Date(pts[i].t);
  }
  if (logged && detected) return logged.getTime() > detected.getTime() ? logged : detected;
  return logged ?? detected;
}

/**
 * Read the soil's current behaviour. `band` is the species' ideal [lo, hi].
 */
export function soilDynamics(
  plant: Pick<Plant, 'potSize' | 'potMaterial' | 'potCm' | 'lastWateredAt' | 'hasDrainage' | 'soilMix'> & {
    species?: string;
  },
  history: Reading[],
  band: [number, number],
  now = Date.now(),
): SoilDynamics {
  const [lo, hi] = band;
  const species = plant.species;
  const drainH = expectedDrainHours(plant);
  const pts = history
    .filter((r) => r.soil_pct != null && Number.isFinite(r.soil_pct))
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.soil_pct as number }))
    .sort((a, b) => a.t - b.t);

  const base: SoilDynamics = {
    draining: false,
    drainageProblem: false,
    reachesIdealAt: null,
    dryRatePerHour: null,
    wateredAt: null,
    expectedDrainHours: drainH,
    tone: 'unknown',
    headline: 'Not enough soil readings yet',
    detail: 'A couple more readings and Greenr can track how fast this pot dries.',
  };
  if (!pts.length) return base;

  const soil = pts[pts.length - 1].v;
  const wateredAt = lastWateringAt(plant, history);
  const hoursSinceWater = wateredAt ? (now - wateredAt.getTime()) / 3600000 : Infinity;

  // Drying speed from readings taken AFTER the last watering — mixing in the
  // pre-watering trace would average a rise and a fall into nonsense.
  // Include the reading AT the watering (>=, not >) — that peak is the start of
  // the drain curve, and without it a fresh watering has only one point and no
  // rate at all, which is exactly when the estimate is most wanted.
  const since = wateredAt ? pts.filter((p) => p.t >= wateredAt.getTime()) : pts;
  const slope = slopePerHour(since.length >= 2 ? since : pts);
  const dryRatePerHour = slope != null && slope < 0 ? -slope : null;

  // Project when the soil re-enters the ideal band (target = top of the band).
  let reachesIdealAt: Date | null = null;
  if (soil > hi && dryRatePerHour && dryRatePerHour > 0.05) {
    const hours = (soil - hi) / dryRatePerHour;
    if (hours < 14 * 24) reachesIdealAt = new Date(now + hours * 3600000);
  }

  // ── Above the ideal band ──
  if (soil > hi) {
    // How long THIS species can sit saturated before it's genuinely at risk —
    // biology, not pot physics. A cactus is in danger within hours; a bog plant
    // is happy for days. A pot with no drainage brings that danger SOONER (the
    // water has nowhere to go), never later.
    const water = waterProfileFor(species);
    let safeH = water.rotRiskHours;
    if (plant.hasDrainage === false) safeH *= 0.6;
    safeH = Math.max(3, safeH); // never nag in the first hours after a drink
    const within = hoursSinceWater <= safeH;
    if (within) {
      // Normal, healthy post-watering saturation. Say nothing alarming.
      return {
        ...base,
        draining: true,
        dryRatePerHour,
        wateredAt,
        reachesIdealAt,
        tone: 'good',
        headline: 'Draining after watering — this is normal',
        detail: reachesIdealAt
          ? `Soil is ${Math.round(soil)}% right after a drink. It should settle back into the ideal ${lo}–${hi}% by about ${reachesIdealAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}. Nothing to do — just let it drain.`
          : `Soil is ${Math.round(soil)}% right after a drink. Give it a few hours to drain back toward ${lo}–${hi}%. Nothing to do.`,
      };
    }
    // Still saturated long after it should have drained — now it's a real signal.
    // Species with fleshy, rot-prone roots get a blunter warning, because for
    // them this is the difference between a setback and a dead plant.
    const urgent = water.rotRiskHours <= 18;
    return {
      ...base,
      drainageProblem: true,
      dryRatePerHour,
      wateredAt,
      reachesIdealAt,
      tone: 'bad',
      headline: urgent ? 'Waterlogged — act now, these roots rot fast' : 'Still waterlogged — the water isn’t draining',
      detail: `Soil has been above ${hi}% for over ${Math.round(safeH)} h${
        urgent ? `, and ${species ?? 'this plant'} stores its own water — its roots rot within days of sitting wet` : ', which this pot should have shed by now'
      }. Check the pot has open drainage holes, tip out any water in the saucer, and loosen compacted soil.${
        urgent ? ' If it stays soggy, repot into a grittier, faster-draining mix.' : ''
      }`,
    };
  }

  // ── Inside the ideal band ──
  if (soil >= lo) {
    let dryOut: Date | null = null;
    if (dryRatePerHour && dryRatePerHour > 0.02) {
      dryOut = new Date(now + ((soil - lo) / dryRatePerHour) * 3600000);
    }
    return {
      ...base,
      dryRatePerHour,
      wateredAt,
      tone: 'good',
      headline: 'Moisture is right where it should be',
      detail: dryOut
        ? `Soil is ${Math.round(soil)}%, inside the ideal ${lo}–${hi}%. At the current drying rate it drops below ${lo}% around ${dryOut.toLocaleDateString('en-US', { weekday: 'long' })}.`
        : `Soil is ${Math.round(soil)}%, inside the ideal ${lo}–${hi}%.`,
    };
  }

  // ── Below the ideal band ──
  // How far below is "a problem" is species-specific: a cactus at 15% below its
  // band is living normally, a fern at 5% below is already browning.
  const tol = waterProfileFor(species).dryTolerance;
  const deficit = lo - soil;
  const serious = deficit > tol;
  const style = waterProfileFor(species).style;
  return {
    ...base,
    dryRatePerHour,
    wateredAt,
    tone: serious ? 'bad' : 'warn',
    headline: serious
      ? 'Too dry — water it now'
      : style === 'soak-and-dry'
        ? 'Drying down — normal for this plant'
        : 'Drying out — water it soon',
    detail: serious
      ? `Soil is ${Math.round(soil)}%, ${Math.round(deficit)} points below the ideal ${lo}–${hi}% — past what ${species ?? 'this plant'} tolerates.`
      : style === 'soak-and-dry'
        ? `Soil is ${Math.round(soil)}%. ${species ?? 'This plant'} is meant to dry out between drinks, so this is fine — water once it's nearly dry throughout.`
        : `Soil is ${Math.round(soil)}%, just below the ideal ${lo}–${hi}%. Water it in the next day or so.`,
  };
}

/**
 * A plant that has just changed homes (or been repotted) is re-establishing its
 * roots: it drinks less than usual, may droop for reasons that have nothing to do
 * with watering, and shouldn't be fed. Advice stays gentle for this window.
 */
const SETTLING_DAYS = 21;

export interface SettlingState {
  settling: boolean;
  daysIn: number;
  note: string;
}

export function settlingState(
  plant: Pick<Plant, 'ownedSince' | 'lastRepottedAt'>,
  now = Date.now(),
): SettlingState | null {
  const marks = [plant.ownedSince, plant.lastRepottedAt]
    .filter(Boolean)
    .map((s) => new Date(s as string).getTime())
    .filter((t) => Number.isFinite(t));
  if (!marks.length) return null;
  const latest = Math.max(...marks);
  const daysIn = Math.floor((now - latest) / 86400000);
  if (daysIn < 0 || daysIn > SETTLING_DAYS) return null;
  const repotted = plant.lastRepottedAt && new Date(plant.lastRepottedAt).getTime() === latest;
  return {
    settling: true,
    daysIn,
    note: repotted
      ? `Repotted ${daysIn} day${daysIn === 1 ? '' : 's'} ago — roots are re-establishing. Water a little less than usual and hold off feeding for about 2 months; fresh mix already carries nutrients.`
      : `In its new home ${daysIn} day${daysIn === 1 ? '' : 's'} — still settling. Some droop or a dropped leaf is normal adjustment, not a watering fault. Keep conditions steady and don't feed yet.`,
  };
}

export type WateringOutcome = 'about-right' | 'too-little' | 'too-much' | 'unknown';

export interface WateringReview {
  outcome: WateringOutcome;
  text: string;
}

/**
 * Did the last watering actually do the job? Judged from what the soil DID
 * afterwards, which is the only honest measure:
 *   • never reached the ideal band  → too little (a splash that wet the surface)
 *   • still saturated past the drain window → too much, or the pot can't drain
 *   • rose into range and drained normally → about right
 */
export function reviewWatering(
  plant: Pick<Plant, 'potSize' | 'potMaterial' | 'potCm' | 'lastWateredAt' | 'hasDrainage' | 'soilMix'>,
  history: Reading[],
  band: [number, number],
  now = Date.now(),
): WateringReview | null {
  const [lo, hi] = band;
  const wateredAt = lastWateringAt(plant, history);
  if (!wateredAt) return null;
  const after = history
    .filter((r) => r.soil_pct != null && Number.isFinite(r.soil_pct) && new Date(r.created_at).getTime() >= wateredAt.getTime())
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.soil_pct as number }));
  if (after.length < 2) return null;

  const peak = Math.max(...after.map((p) => p.v));
  const drainH = expectedDrainHours(plant);
  const hoursSince = (now - wateredAt.getTime()) / 3600000;
  const latest = after[after.length - 1].v;

  if (peak < lo) {
    return {
      outcome: 'too-little',
      text: `That watering only brought the soil to ${Math.round(peak)}%, short of the ${lo}–${hi}% ideal — the water likely ran down the sides without soaking the root ball. Next time pour slowly until it drains from the base.`,
    };
  }
  if (hoursSince > drainH * 1.5 && latest > hi) {
    return {
      outcome: 'too-much',
      text: `The soil is still above ${hi}% more than ${Math.round(drainH)} h after watering. That's either more water than this pot can hold or drainage that isn't clearing — check the holes and the saucer.`,
    };
  }
  if (peak >= lo) {
    return {
      outcome: 'about-right',
      text: `That watering took the soil to ${Math.round(peak)}% and it's draining normally — a good pour for this pot.`,
    };
  }
  return null;
}

/**
 * Did the owner water AFTER the sensor's most recent reading?
 *
 * The sensor only reports every few hours, so right after someone waters, the
 * newest reading still describes bone-dry soil. Left alone the app keeps
 * shouting "water this plant!" at someone who just did — the alert appears
 * unclearable, because tapping "log" changes nothing the sensor has seen yet.
 *
 * When this returns true, every "needs water" prompt is suppressed until a fresh
 * reading arrives to confirm the pour. That's honest: we're not claiming the
 * soil is fine, we're acknowledging we haven't measured it since you acted.
 */
export function wateredSinceLastReading(
  plant: Pick<Plant, 'lastWateredAt'>,
  latest: Reading | null,
  now = Date.now(),
): boolean {
  if (!plant.lastWateredAt) return false;
  const watered = new Date(plant.lastWateredAt).getTime();
  if (!Number.isFinite(watered)) return false;
  // Ignore anything older than a day — a stale log must never mute a real alert.
  if (now - watered > 24 * 3600 * 1000) return false;
  if (!latest) return true;
  return watered > new Date(latest.created_at).getTime();
}

/** A rise smaller than this is indistinguishable from sensor noise. */
const NO_CHANGE_PCT = 4;
/** How long a pour has to show up in the soil before we call it missing. */
const CONFIRM_WINDOW_H = 12;

export interface WateringMiss {
  /** soil reading just before the pour */
  beforePct: number;
  /** best reading seen since */
  afterPct: number;
  hoursSince: number;
  text: string;
}

/**
 * The owner logged a watering, the sensor has since reported — and the soil did
 * not move. That is a genuinely important signal, and distinct from
 * `reviewWatering`'s "too little": this is not a small pour, it is NO measurable
 * water reaching the probe at all.
 *
 * Real causes, in rough order of likelihood: the water ran straight down the gap
 * between a dry root ball and the pot wall (very common with peat that has dried
 * hard, and it fools people because it pours out of the base looking like a
 * thorough soak); the probe has worked loose or is sitting in a dry pocket; the
 * wrong plant got watered; or the log was a mistap.
 *
 * Deliberately quiet until a reading has actually ARRIVED after the pour —
 * `wateredSinceLastReading` owns the waiting period, and firing during it would
 * accuse someone of a failure we have not measured yet.
 */
export function wateringDidNotRegister(
  plant: Pick<Plant, 'lastWateredAt'>,
  history: Reading[],
  /**
   * The species' ideal band. Supplied so a pour is judged by its RESULT, not by
   * its size: a small rise that nonetheless lands the soil inside the safe zone
   * did its job, and there is nothing to redo. Without this the app kept asking
   * for a retry on a plant that was already comfortable.
   */
  band?: [number, number] | null,
  now = Date.now(),
): WateringMiss | null {
  if (!plant.lastWateredAt) return null;
  const watered = new Date(plant.lastWateredAt).getTime();
  if (!Number.isFinite(watered)) return null;

  const hoursSince = (now - watered) / 3600000;
  // Too long ago to still be talking about, and pointless before the sensor has
  // had a realistic chance to report.
  if (hoursSince > 48) return null;

  // Sensor payloads arrive over the network and are not guaranteed sane, so
  // non-finite readings and unparseable timestamps are dropped rather than
  // averaged into a NaN that would surface in the alert text.
  const pts = history
    .filter((r) => r.soil_pct != null && Number.isFinite(r.soil_pct))
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.soil_pct as number }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);

  const before = pts.filter((p) => p.t <= watered);
  const after = pts.filter((p) => p.t > watered);
  // No baseline, or the sensor hasn't reported since — nothing to conclude.
  if (!before.length || !after.length) return null;

  const beforePct = before[before.length - 1].v;
  const afterPct = Math.max(...after.map((p) => p.v));
  if (afterPct - beforePct >= NO_CHANGE_PCT) return null;

  // Judge the pour by where it LEFT the soil, not by how far it moved. A barely
  // detectable rise that still puts the plant inside its comfortable band is a
  // success — the plant needed almost nothing and now has it. Only a pour that
  // left the soil below the floor is worth redoing.
  const latest = after[after.length - 1].v;
  if (band && (afterPct >= band[0] || latest >= band[0])) return null;

  // Give it the full window before crying foul, unless several readings agree.
  const elapsedSinceFirstReport = (now - after[0].t) / 3600000;
  if (hoursSince < CONFIRM_WINDOW_H && after.length < 2 && elapsedSinceFirstReport < 3) return null;

  return {
    beforePct,
    afterPct,
    hoursSince,
    text: `You logged a watering ${hoursSince < 1 ? 'less than an hour' : `about ${Math.round(hoursSince)} h`} ago, but the soil has barely moved — ${beforePct.toFixed(0)}% before, ${afterPct.toFixed(0)}% since. That usually means the water ran down the gap between a dried-out root ball and the pot wall instead of soaking in (it still pours out of the base, so it looks like it worked). Try watering slowly in several small passes, or stand the pot in a few cm of water for 20 minutes. Worth checking the probe is still firmly in the soil too.`,
  };
}

export interface PourOutcome {
  pouredMl: number;
  predictedRisePts: number | null;
  actualRisePts: number;
  /** millilitres per display point for THIS pot — the figure the dose engine uses */
  mlPerPoint: number;
  /** true when this pour overflowed the pot, so its own ratio is only a ceiling */
  saturated: boolean;
  /** predicted ÷ actual — 1.0 is a perfect call */
  accuracy: number | null;
  text: string;
}

/**
 * What the last logged pour actually did, versus what was predicted.
 *
 * This closes the loop. The app states a dose and a expected rise BEFORE the
 * water goes in; this reads the sensor afterwards and reports the real
 * millilitres-per-point, which is the single most valuable number in the whole
 * watering model — it measures the actual pot rather than estimating it.
 *
 * Returns null until a reading has genuinely landed after the pour and the soil
 * has moved enough to measure; guessing from noise would poison the calibration.
 */
export function pourOutcome(
  plant: Pick<Plant, 'lastWateredAt' | 'waterLog' | 'potSize' | 'potCm' | 'potHeightCm' | 'potShape' | 'probeDepthCm' | 'potMaterial' | 'soilMix' | 'soilRetention' | 'hasDrainage'> & { id?: string },
  history: Reading[],
  predictedRisePts?: number | null,
  now = Date.now(),
): PourOutcome | null {
  if (!plant.lastWateredAt) return null;
  const watered = new Date(plant.lastWateredAt).getTime();
  if (!Number.isFinite(watered) || now - watered > 7 * 24 * 3600 * 1000) return null;

  const logged = (plant.waterLog ?? []).find(
    (w) => w.ml != null && w.ml > 0 && Math.abs(new Date(w.at).getTime() - watered) < 6 * 3600 * 1000,
  );
  if (!logged?.ml) return null;

  const pts = history
    .filter((r) => r.soil_pct != null && Number.isFinite(r.soil_pct))
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.soil_pct as number }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);

  const before = pts.filter((p) => p.t <= watered);
  const after = pts.filter((p) => p.t > watered);
  if (!before.length || !after.length) return null;

  const pre = before[before.length - 1].v;
  const peak = Math.max(...after.map((p) => p.v));
  const rise = peak - pre;
  // Below this the "rise" is indistinguishable from noise — wateringDidNotRegister
  // owns that case and calling it a calibration point would corrupt the fit.
  if (rise < NO_CHANGE_PCT) return null;

  /*
   * THE MILLILITRES-PER-POINT SHOWN HERE MUST BE THE ONE THE APP DOSES WITH.
   *
   * This card used to compute its own: poured ÷ rise. That is wrong whenever the
   * pour overflowed the pot, because the rise stops at the pot's ceiling while
   * the millilitres keep counting — so the ratio climbs the more you over-water,
   * which is backwards. On a real 30 × 29 cm pot whose last pour was 1050 ml this
   * card read 21.9 ml/point while the dose engine, which knows that pour
   * saturated, read 7.5 — a 2.9× disagreement between two numbers on the same
   * screen describing the same pot.
   *
   * So the figure comes from `perPointFor`, which reconciles the geometry, every
   * logged pour, and the observed ceiling. This card keeps what is genuinely its
   * own — what THIS pour did, and whether the prediction held up.
   */
  const { ceiling } = poursAndCeiling(plant, history, now);
  const saturated = !!ceiling?.confirmed && peak >= ceiling.pct - 4;
  const mlPerPoint = perPointFor(plant, history, pre, now).mlPerPoint;
  // Prefer the prediction recorded WITH the pour — that is the one that was
  // actually shown to the person before they watered.
  const predicted = logged.predictedRisePts ?? predictedRisePts ?? null;
  const accuracy = predicted != null && predicted > 0 ? rise / predicted : null;

  const verdict =
    accuracy == null
      ? `${logged.ml} ml raised this pot ${rise.toFixed(1)} points.`
      : accuracy >= 0.8 && accuracy <= 1.25
        ? `Predicted ${predicted?.toFixed(0)} points, got ${rise.toFixed(1)} — the model is right for this pot.`
        : accuracy > 1.25
          ? `Predicted ${predicted?.toFixed(0)} points but it rose ${rise.toFixed(1)} — this pot takes less water than estimated, so amounts are coming down.`
          : `Predicted ${predicted?.toFixed(0)} points but it only rose ${rise.toFixed(1)} — this pot needs more than estimated, so amounts are going up.`;

  return {
    pouredMl: logged.ml,
    predictedRisePts: predicted,
    actualRisePts: Math.round(rise * 10) / 10,
    mlPerPoint: Math.round(mlPerPoint * 10) / 10,
    saturated,
    accuracy: accuracy != null ? Math.round(accuracy * 100) / 100 : null,
    text: saturated
      ? `${verdict} It also filled the pot — the reading stopped at ${Math.round(peak)}%, which is where this pot tops out, so the rest ran out of the base. Greenr works on about ${Math.round(mlPerPoint)} ml per point here, and a smaller pour would tell it more.`
      : `${verdict} That works out at about ${Math.round(mlPerPoint)} ml per point here.`,
  };
}

export interface SensorSilence {
  lastReadingAt: number;
  hoursSince: number;
  /** the cadence this sensor actually reports at, measured from its own history */
  expectedGapH: number;
  /** it has missed enough reports that the latest reading can no longer be trusted as current */
  stale: boolean;
  text: string;
}

/**
 * HAS THIS SENSOR GONE QUIET?
 *
 * Every judgement in the app is made on "the latest reading", and nothing checked
 * how old that was. A sensor that dies — flat battery, dropped Wi-Fi, knocked out
 * of the soil — leaves its last reading sitting there being treated as the
 * present. In simulation that produced the worst possible failure: a plant
 * genuinely at 15% soil against a 30% floor, its sensor silent for six days, and
 * the app calmly reporting "Fine — nothing needs doing" off a reading from before
 * the drought started. Silence looked exactly like health.
 *
 * The threshold is measured rather than assumed, because the reporting cadence is
 * server-controlled and can be changed: three missed reports, with a floor of 12
 * hours so a fast watch-mode cadence cannot make the app twitchy.
 */
export function sensorSilence(history: Reading[], now = Date.now()): SensorSilence | null {
  const ts = history
    .map((r) => new Date(r.created_at).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (!ts.length) return null;

  const gaps: number[] = [];
  for (let i = 1; i < ts.length; i++) gaps.push((ts[i] - ts[i - 1]) / 3600000);
  const sorted = gaps.slice().sort((a, b) => a - b);
  const medianGapH = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 3;
  const expectedGapH = medianGapH > 0 && Number.isFinite(medianGapH) ? medianGapH : 3;

  const lastReadingAt = ts[ts.length - 1];
  const hoursSince = (now - lastReadingAt) / 3600000;
  const threshold = Math.max(12, expectedGapH * 3);
  const stale = hoursSince > threshold;

  return {
    lastReadingAt,
    hoursSince,
    expectedGapH,
    stale,
    text: stale
      ? `This sensor last reported ${hoursSince < 48 ? `${Math.round(hoursSince)} hours` : `${Math.round(hoursSince / 24)} days`} ago, so everything below describes the plant as it was THEN, not now. Check the sensor is powered, in range, and still pushed into the soil.`
      : '',
  };
}
