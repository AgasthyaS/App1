import type { Reading } from './devices';
import { probeReads, waterContentAt, type PotGeometry } from './soilProfile';
import type { Plant, SoilMix, SoilRetention } from './types';
import { REFERENCE_VPD_KPA, vpdKpa } from './vpd';

/**
 * MEASURING SOIL RETENTION FROM THE DRY-DOWN CURVE.
 *
 * The wizard asks the owner: "after a thorough watering, roughly how long before
 * the soil feels dry again?" That answer scales the van Genuchten alpha in
 * soilProfile, and it is the single biggest lever on every moisture number the
 * app produces — because published retention curves describe generic composts,
 * and real bags of compost differ enormously with brand, age and perlite content.
 *
 * But it is a question about something the SENSOR IS ALREADY WATCHING. A probe
 * reporting every three hours records the entire dry-down, so asking someone to
 * recall it is asking them to estimate a measurement we hold. This module makes
 * the measurement instead.
 *
 * ───────────────────────── WHY THE RATE IS THE RIGHT SIGNAL ─────────────────────
 *
 * "Retentive" means, physically, that the medium holds water against suction: a
 * smaller alpha needs more tension before the pores give their water up. The
 * observable consequence is exactly the one an owner notices — the pot stays damp
 * longer. Water leaves a pot at a rate set by demand (evaporation + the plant's
 * transpiration); how far the READING falls for that same loss depends on how
 * much water the medium was holding and how tightly. So a slow decline is the
 * signature of a retentive mix, and this is measuring the same quantity the
 * question asks about, in the same units (days), from data instead of memory.
 *
 * ─────────────────────────── THE CORRECTION THAT MATTERS ────────────────────────
 *
 * The raw rate on its own is NOT retention, and taking it at face value would be
 * a real error. The same pot of the same compost dries roughly twice as fast in a
 * heated winter room as in a humid one, because evaporative demand — not the
 * soil — sets the numerator. Uncorrected, this system would relabel every pot in
 * the house "fast-draining" in February and "retentive" in June, and then feed
 * that seasonal artefact back into the retention curve as if it were a property
 * of the compost.
 *
 * So every run is normalised to reference conditions using VPD, which is what
 * actually drives evaporation (see lib/vpd). The same `vpdIntervalFactor` that
 * stretches the watering interval is used in reverse here, so demand is described
 * in exactly one place.
 *
 * ───────────────────────────── WHAT IT CANNOT REMOVE ────────────────────────────
 *
 * Transpiration is not normalised away: a big thirsty plant empties its pot
 * faster than a cutting in the same mix. That is deliberate and honest — the
 * result is "how long THIS pot, in THIS spot, with THIS plant stays damp", which
 * is both what the owner was being asked and what watering decisions need. It is
 * not a laboratory measurement of the compost, and the UI says so.
 *
 * The other limit is the residual floor the curve decays toward. τ is genuinely
 * sensitive to it, and it starts as a literature value per mix; readings that
 * fall below it correct it, but readings that stay above it cannot confirm it. So
 * the biggest remaining error source here is a mix whose true floor differs from
 * the book, and it shows up as a systematic bias rather than as noise — which is
 * exactly the sort of error a good-looking R² will not warn you about.
 *
 * ───────────────────────────────── THE MODEL ───────────────────────────────────
 *
 * Container dry-down is close to exponential rather than linear: as the soil
 * dries, water is held at higher tension, hydraulic conductivity collapses and
 * stomata start to close, so the last few points take far longer than the first.
 * A straight line fitted to the wet end therefore predicts "dry" days too early.
 * Each run is fitted as
 *
 *     reading(t) = residual + (reading₀ − residual) · e^(−t/τ)
 *
 * by least squares on ln(reading − residual). τ — the e-folding time — is the one
 * number that describes the whole curve, and `residual` is the mix's own θr from
 * the retention curve, because that is the floor a probe asymptotically
 * approaches and the log is only meaningful measured from it.
 *
 * τ is then converted back into the owner-facing quantity — days from thoroughly
 * watered to needing water — through ONE fixed constant (see E_FOLDINGS_TO_DRY).
 * When a run actually spans that much drying the answer is a measurement; when it
 * covers part of it the answer is an extrapolation along a fitted curve, and
 * `spanned` records which.
 */

/** A rise this big ends a drying run — someone watered, it rained, or it was moved. */
const RISE_BREAK_PTS = 3;
/** A run shorter than this is a weather wobble, not a dry-down. */
const MIN_RUN_HOURS = 18;
const MIN_RUN_POINTS = 5;
/** Below this the soil barely moved, so the slope is noise. */
const MIN_RUN_DROP_PTS = 5;
/** How far above the residual floor a reading must sit to carry information. */
const FLOOR_MARGIN_PTS = 2;
/** R² of the log-linear fit below which a run is not trusted at all. */
const MIN_RUN_FIT = 0.75;
/** A tail declining slower than this has stopped falling rather than been cut short. */
const FLAT_PTS_PER_DAY = 0.35;
/** …sustained for at least this long, so a quiet night cannot pass as an asymptote. */
const FLAT_MIN_HOURS = 36;
/** Total observed drying time before any answer is offered. */
const MIN_TOTAL_HOURS = 36;
/** Share of a full watered→dry cycle a single run must cover to count as spanning it. */
const SPANNED_FRACTION = 0.55;

/**
 * How many e-foldings separate "thoroughly watered" from "needs water".
 *
 * τ describes the CURVE; this constant turns it into the DAYS the four classes
 * are defined in. It is deliberately a single fixed number rather than one
 * derived per pot, and the first version of this module got that wrong.
 *
 * Deriving the anchors from each pot's own geometry looked more rigorous and was
 * actively worse: the probe reads a fixed top 6.5 cm, and in a deep pot that
 * slice sits at high suction and therefore starts near-dry, so the same compost
 * drying at the same rate scored 9.2 days in an 8 cm pot and 4.8 in a 30 cm one.
 * Pot depth was leaking into a value that scales the MIX's retention curve — and
 * in a coarse mix the anchors collapsed together and no answer was possible at
 * all. Retention is a property of the compost; the container is already modelled
 * separately, and double-counting it here corrupts both.
 *
 * The value is the range of the app's reference pot — a 16 cm standard mix, whose
 * probe reads 41.2% just drained against a residual of 8%, falling to the 11%
 * where that pot wants water: ln((41.2 − 8) / (11 − 8)) ≈ 2.4. So one class
 * boundary lands where horticulture puts it — 'typical' compost, watered
 * thoroughly, is ready again in three to five days.
 */
const E_FOLDINGS_TO_DRY = 2.4;

/**
 * Bounds on the evaporative-demand correction.
 *
 * The relationship is the same one `vpdIntervalFactor` uses — evaporation scales
 * close to linearly with VPD, so drying time scales with its inverse — but the
 * BOUNDS are deliberately wider than that function's. Its clamp exists to stop a
 * single spot reading from tripling somebody's watering schedule, which is a
 * sensible guard on a live instruction and the wrong guard here: this is
 * averaging days of readings to normalise a physical measurement, and clamping at
 * 0.55 left a genuinely retentive pot in a 2.8 kPa room reading as 5.6 days
 * instead of 7.2. These bounds still refuse to believe extreme values outright.
 */
const DEMAND_MIN = 0.35;
const DEMAND_MAX = 2.5;

/** How much longer this soil would have taken to dry in reference air. */
function demandFactor(kpa: number): number {
  return Math.max(DEMAND_MIN, Math.min(DEMAND_MAX, REFERENCE_VPD_KPA / kpa));
}
/** Two runs that disagree by more than this factor are not a stable measurement. */
const MAX_SPREAD = 2.5;
/** Same fallback the plant screen uses when the owner hasn't measured the pot. */
const DEFAULT_DEPTH_CM = 16;

const DAY_MS = 86400000;

/**
 * Day counts that separate the four classes. They sit between the wizard's own
 * labels ("a day or two" / "3–5 days" / "about a week" / "over a week") so a
 * measured answer and a stated one mean the same thing.
 */
const CLASS_BOUNDS: { upTo: number; value: SoilRetention }[] = [
  { upTo: 2.5, value: 'fast' },
  { upTo: 5.5, value: 'typical' },
  { upTo: 8.5, value: 'retentive' },
];

export const RETENTION_LABEL: Record<SoilRetention, string> = {
  'fast': 'Fast-draining',
  'typical': 'Typical',
  'retentive': 'Holds water well',
  'very-retentive': 'Very retentive',
};

export const RETENTION_SPOKEN: Record<SoilRetention, string> = {
  'fast': 'dries within a day or two',
  'typical': 'dries in three to five days',
  'retentive': 'stays damp about a week',
  'very-retentive': 'stays damp for over a week',
};

/** Which class a measured dry-down time falls into. */
export function retentionClass(dryDays: number): SoilRetention {
  for (const b of CLASS_BOUNDS) if (dryDays <= b.upTo) return b.value;
  return 'very-retentive';
}

export interface RetentionRun {
  startMs: number;
  endMs: number;
  hours: number;
  /** reading at the start and end of the fitted stretch */
  fromPct: number;
  toPct: number;
  points: number;
  /** e-folding time as observed, in days */
  tauDays: number;
  /** …and corrected to reference evaporative demand */
  tauRefDays: number;
  /** mean vapour pressure deficit over the run, kPa (null if the sensor lacks temp/RH) */
  vpdKpa: number | null;
  /** R² of the log-linear fit */
  fit: number;
  /** the run covered most of the capacity→dry range, so its answer is measured not extrapolated */
  spanned: boolean;
  /** plain observed decline, points per day — the number an owner would eyeball */
  ptsPerDay: number;
}

export interface RetentionEstimate {
  value: SoilRetention;
  /** days from a just-drained pot to needing water, at reference conditions */
  dryDays: number;
  /** demand-corrected e-folding time, days */
  tauDays: number;
  /** observed decline in display points per day, averaged over the runs */
  ptsPerDay: number;
  runs: RetentionRun[];
  observedHours: number;
  /** mean R² across the runs */
  fit: number;
  /** enough agreeing evidence to supersede the owner's answer */
  confident: boolean;
  /** true when at least one run genuinely covered the whole capacity→dry range */
  measuredEndToEnd: boolean;
  /** false when the sensor reported no temperature/humidity, so demand couldn't be corrected for */
  demandCorrected: boolean;
  /** what the owner said, when they answered */
  stated: SoilRetention | null;
  /** null when they didn't answer */
  agreesWithOwner: boolean | null;
  headline: string;
  detail: string;
}

type Pt = { t: number; v: number };

/**
 * Pot geometry for the anchors, DELIBERATELY without a retention value.
 *
 * The capacity and dry anchors must not depend on the answer we are computing —
 * feeding the stated (or a previously measured) retention back in would make the
 * result chase its own tail, drifting further from the truth on every pass. The
 * mix baseline is a fixed reference frame.
 */
function anchorGeometry(plant: RetentionPlant): PotGeometry {
  return {
    potHeightCm: plant.potHeightCm ?? DEFAULT_DEPTH_CM,
    soilMix: plant.soilMix ?? null,
    probeDepthCm: plant.probeDepthCm ?? null,
    soilRetention: null,
  };
}

/** Least-squares fit of ln(reading − residual) against time. */
function logFit(pts: Pt[], residual: number): { tauDays: number; fit: number } | null {
  const n = pts.length;
  if (n < 2) return null;
  const t0 = pts[0].t;
  const xs = pts.map((p) => (p.t - t0) / DAY_MS);
  const ys = pts.map((p) => Math.log(p.v - residual));
  if (ys.some((y) => !Number.isFinite(y))) return null;

  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den <= 0) return null;
  const slope = num / den;
  // A flat or rising run is not a dry-down, whatever else it is.
  if (!(slope < 0)) return null;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = my + slope * (xs[i] - mx);
    ssRes += (ys[i] - pred) ** 2;
    ssTot += (ys[i] - my) ** 2;
  }
  // ssTot ≈ 0 means the reading never moved; MIN_RUN_DROP_PTS has already
  // rejected that case, so this only guards the division.
  const fit = ssTot > 1e-9 ? Math.max(0, 1 - ssRes / ssTot) : 0;
  return { tauDays: -1 / slope, fit };
}

/** Mean vapour pressure deficit over a window, from whatever the sensor logged. */
function meanVpd(history: Reading[], fromMs: number, toMs: number): number | null {
  let sum = 0;
  let n = 0;
  for (const r of history) {
    const t = new Date(r.created_at).getTime();
    if (!Number.isFinite(t) || t < fromMs || t > toMs) continue;
    const k = vpdKpa(r.temp_c, r.humidity_pct);
    if (k == null || !Number.isFinite(k) || k <= 0) continue;
    sum += k;
    n++;
  }
  return n ? sum / n : null;
}

/**
 * The level a dry-down actually levels off at, if it levels off at all.
 *
 * Takes the tail of each drying stretch and asks whether it had stopped moving:
 * a decline of less than `FLAT_PTS_PER_DAY` sustained over `FLAT_MIN_HOURS` is a
 * curve that has found its asymptote rather than one that was cut short. The
 * median across such stretches is returned, so one odd cycle cannot set it.
 */
function flatteningFloor(pts: Pt[]): number | null {
  const levels: number[] = [];
  for (const run of splitRuns(pts)) {
    if (run.length < MIN_RUN_POINTS * 2) continue;
    const tail = run.slice(Math.floor(run.length * 0.6));
    if (tail.length < 4) continue;
    const hours = (tail[tail.length - 1].t - tail[0].t) / 3600000;
    if (hours < FLAT_MIN_HOURS) continue;
    const drop = tail[0].v - tail[tail.length - 1].v;
    const perDay = (drop / hours) * 24;
    if (perDay <= FLAT_PTS_PER_DAY) levels.push(tail[tail.length - 1].v);
  }
  if (!levels.length) return null;
  const sorted = levels.sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * How far below the observed floor to sit when raising it.
 *
 * A fixed two points is a reasonable hedge on a peat pot ranging over thirty,
 * and a severe one on a gritty pot ranging over eleven — where it left the fit
 * chasing an asymptote two points below the real one and still reported the
 * soil three times slower than it was. The margin scales with the range it is
 * a margin on.
 */
function floorMargin(pts: Pt[]): number {
  const vals = pts.map((p) => p.v).sort((a, b) => a - b);
  const range = vals[Math.floor(vals.length * 0.95)] - vals[Math.floor(vals.length * 0.05)];
  return Math.max(0.4, Math.min(FLOOR_MARGIN_PTS, range * 0.08));
}

/** Split the soil trace into stretches that were purely drying. */
function splitRuns(pts: Pt[]): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  for (const p of pts) {
    const prev = cur.length ? cur[cur.length - 1] : null;
    // A real rise ends the run and starts the next one AT the new peak, which is
    // where the following dry-down genuinely begins.
    if (prev && p.v - prev.v > RISE_BREAK_PTS) {
      out.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out;
}

type RetentionPlant = Pick<
  Plant,
  'potHeightCm' | 'probeDepthCm' | 'soilMix' | 'soilRetention'
> & { id?: string };

/**
 * Every clean dry-down the sensor has recorded, newest last. Exported because it
 * is the evidence behind the headline figure, and the plant screen shows it.
 */
export function dryDownRuns(plant: RetentionPlant, history: Reading[]): RetentionRun[] {
  const mix: SoilMix = plant.soilMix ?? 'Standard mix';
  const geo = anchorGeometry(plant);
  const capacity = probeReads(geo, 0);

  const pts = history
    .filter((r) => r.soil_pct != null && Number.isFinite(r.soil_pct))
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.soil_pct as number }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  if (pts.length < MIN_RUN_POINTS) return [];

  /*
   * THE FLOOR THE READING DECAYS TOWARD. The exponential is only meaningful
   * measured from it, and τ is genuinely sensitive to it, so it is worth getting
   * right rather than assuming.
   *
   * The book value is the mix's residual water content θr — retention-independent
   * (alpha scales suction, not θr), so it is safe to use even though retention is
   * what we are solving for. But θr is a literature average, and a probe that has
   * ALREADY READ BELOW IT has disproved it for this pot: no amount of theory
   * outranks the pot reporting 9% while the book insists it bottoms out at 12.
   * Left uncorrected those readings are simply discarded as unresolvable, which
   * silently deletes the slow tail of every dry-down and makes the soil look
   * faster than it is.
   *
   * So the book value is overridden ONLY where the readings contradict it. An
   * earlier version capped it at `lowest − margin` unconditionally, which fired
   * on healthy data too: a fast pot that genuinely dries to its floor pushed the
   * floor 2 points lower still, flattened its own tail, and reported a 0.7-day
   * soil as 1.5 days — turning `fast` into `typical`. Evidence overrules theory;
   * agreeing with theory is not evidence against it.
   */
  const book = waterContentAt(1e5, mix);
  const lowestSeen = Math.min(...pts.map((p) => p.v));

  /*
   * …AND IT CAN BE TOO LOW AS WELL AS TOO HIGH, which this only ever corrected
   * in one direction.
   *
   * θr is where a medium ends up when it is dried to exhaustion. A pot on a
   * windowsill is not: while there is still free water lower in the column,
   * capillary rise keeps the probe zone supplied, so the reading levels off at
   * the pot's hydrostatic equilibrium — around 18% for a 20 cm standard mix —
   * and stays there. It is nowhere near θr and it is not going there this week.
   *
   * Fitting ln(reading − 8) to a curve that is actually flattening at 22 stretches
   * the tail out enormously, because the fit is chasing an asymptote the data
   * never approaches. In simulation a pot that genuinely dried from 52% to its
   * refill point in eighteen days was reported as taking fifty-nine. That is a
   * three-fold error in the number the watering interval is built on, and it
   * biases every well-watered pot in the same direction — always slower, always
   * "water less often".
   *
   * So the floor is raised when the trace SHOWS one. The distinction that makes
   * this safe is between a reading that stopped falling and a reading that was
   * interrupted: a genuine asymptote flattens out — the decline decelerates to
   * nearly nothing and stays there for a stretch — whereas a pot watered while
   * still falling steeply has no floor in evidence, only an intervention. Only
   * the first raises the floor, and it is taken a margin BELOW the level seen,
   * so a mistake shortens the tail rather than deleting it.
   */
  const flattenedAt = flatteningFloor(pts);
  const residual =
    lowestSeen < book ? Math.max(0, lowestSeen - FLOOR_MARGIN_PTS)
      : flattenedAt != null && flattenedAt > book + FLOOR_MARGIN_PTS * 2
        ? flattenedAt - floorMargin(pts)
        : book;

  // Can the model tell "still draining" from "drying" in this pot at all? In a
  // deep pot of coarse mix the probe zone sits barely above the residual even
  // when the pot is full, so a modelled capacity that close to the floor cannot
  // be used as a threshold — the same limitation soilProfile reports as
  // `probeBlind`. Where it can't, no drainage is trimmed rather than most of the
  // run being deleted on the strength of a number that means nothing.
  const capacityUsable = capacity - residual >= 5;

  const runs: RetentionRun[] = [];
  for (const raw of splitRuns(pts)) {
    // Drop the free-drainage phase at the head of the run. Water leaving a
    // saturated pot under gravity is governed by conductivity, not retention, and
    // it is far faster than the drying that follows — fitting through it makes
    // every soil look fast. Capped at half the run so a mis-modelled capacity
    // can't quietly delete the evidence.
    let seg = raw;
    const maxDrop = Math.floor(raw.length / 2);
    let dropped = 0;
    while (capacityUsable && dropped < maxDrop && seg.length && seg[0].v > capacity) {
      seg = seg.slice(1);
      dropped++;
    }
    // Readings pinned near the residual floor carry no information and blow the
    // logarithm up, so the tail is trimmed to what the probe can still resolve.
    seg = seg.filter((p) => p.v - residual >= FLOOR_MARGIN_PTS);
    if (seg.length < MIN_RUN_POINTS) continue;

    const hours = (seg[seg.length - 1].t - seg[0].t) / 3600000;
    const drop = seg[0].v - seg[seg.length - 1].v;
    if (hours < MIN_RUN_HOURS || drop < MIN_RUN_DROP_PTS) continue;

    const fitted = logFit(seg, residual);
    if (!fitted || fitted.fit < MIN_RUN_FIT) continue;

    const vpd = meanVpd(history, seg[0].t, seg[seg.length - 1].t);
    // Observed in dry air ⇒ the same soil would have taken longer in reference
    // air, so τ is divided by the factor that shortened it.
    const tauRefDays = vpd != null ? fitted.tauDays / demandFactor(vpd) : fitted.tauDays;

    const covered =
      Math.log((seg[0].v - residual) / (seg[seg.length - 1].v - residual)) / E_FOLDINGS_TO_DRY;

    runs.push({
      startMs: seg[0].t,
      endMs: seg[seg.length - 1].t,
      hours,
      fromPct: seg[0].v,
      toPct: seg[seg.length - 1].v,
      points: seg.length,
      tauDays: fitted.tauDays,
      tauRefDays,
      vpdKpa: vpd,
      fit: fitted.fit,
      spanned: covered >= SPANNED_FRACTION,
      ptsPerDay: drop / (hours / 24),
    });
  }
  return runs;
}

/**
 * Cached because Home evaluates the whole garden on every render and this walks
 * the full reading history per plant. Keyed on everything that can change the
 * answer, so a stale entry is impossible rather than merely unlikely.
 */
const estimateCache = new Map<string, RetentionEstimate | null>();

export function retentionEstimate(
  plant: RetentionPlant,
  history: Reading[],
): RetentionEstimate | null {
  // No id, no cache. The key falls back to '' without one, and since two plants
  // watched over the same window also share a length and a last timestamp, every
  // id-less plant collided onto ONE entry — a slow-drying pot and a fast one both
  // reported the first answer computed. Callers always pass a real Plant today,
  // so this is a latent trap rather than a live fault, but a cache whose key can
  // silently become a constant is not one to leave in place.
  if (!plant.id) return computeEstimate(plant, history);

  const last = history.length ? history[history.length - 1]?.created_at : '';
  const key = [
    plant.id,
    history.length,
    last,
    plant.potHeightCm ?? '',
    plant.probeDepthCm ?? '',
    plant.soilMix ?? '',
    plant.soilRetention ?? '',
  ].join('|');
  if (estimateCache.has(key)) return estimateCache.get(key) ?? null;

  const result = computeEstimate(plant, history);
  if (estimateCache.size > 400) estimateCache.clear();
  estimateCache.set(key, result);
  return result;
}

function computeEstimate(plant: RetentionPlant, history: Reading[]): RetentionEstimate | null {
  const runs = dryDownRuns(plant, history);
  if (!runs.length) return null;

  // Weight each run by how much drying it watched and how well the curve fitted;
  // a run that covered the whole range end to end is worth more than one that
  // had to be extrapolated.
  const weightOf = (r: RetentionRun) => r.hours * r.fit * (r.spanned ? 1.25 : 1);
  const totalWeight = runs.reduce((a, r) => a + weightOf(r), 0);
  if (totalWeight <= 0) return null;

  // Geometric mean: these are durations, so they spread multiplicatively and an
  // arithmetic mean would let one slow run drag the answer up out of proportion.
  const logTau = runs.reduce((a, r) => a + Math.log(r.tauRefDays) * weightOf(r), 0) / totalWeight;
  const tauDays = Math.exp(logTau);
  const dryDays = tauDays * E_FOLDINGS_TO_DRY;

  const observedHours = runs.reduce((a, r) => a + r.hours, 0);
  const fit = runs.reduce((a, r) => a + r.fit * weightOf(r), 0) / totalWeight;
  const ptsPerDay = runs.reduce((a, r) => a + r.ptsPerDay * weightOf(r), 0) / totalWeight;
  const implied = runs.map((r) => r.tauRefDays);
  const spread = Math.max(...implied) / Math.min(...implied);
  const measuredEndToEnd = runs.some((r) => r.spanned);
  const demandCorrected = runs.every((r) => r.vpdKpa != null);

  // Enough to overrule what the owner told us? Either two runs that agree, or a
  // single run that watched a whole dry-down from capacity to dry with a clean
  // fit. Anything less is shown but not acted on.
  const confident =
    observedHours >= MIN_TOTAL_HOURS &&
    ((runs.length >= 2 && fit >= 0.8 && spread <= MAX_SPREAD) ||
      (measuredEndToEnd && fit >= 0.9 && observedHours >= 36));

  const value = retentionClass(dryDays);
  const stated = plant.soilRetention ?? null;
  const days = dryDays < 1 ? dryDays.toFixed(1) : Math.round(dryDays).toString();

  const headline = confident
    ? `This soil ${RETENTION_SPOKEN[value]}`
    : `Still measuring — looks like it ${RETENTION_SPOKEN[value]}`;

  const observedDays = Math.max(1, Math.round(observedHours / 24));
  const evidence = `${runs.length} dry-down${runs.length === 1 ? '' : 's'} over ${observedDays} day${observedDays === 1 ? '' : 's'}`;
  const parts = [
    `The soil falls about ${ptsPerDay.toFixed(1)} points a day here, which works out at roughly ${days} day${days === '1' ? '' : 's'} from thoroughly watered to wanting water again.`,
    `Measured from ${evidence}${measuredEndToEnd ? ', one of them start to finish' : ''}.`,
    demandCorrected
      ? 'Corrected for how dry the air was at the time, so a hot week doesn’t make your compost look sandy.'
      : 'The sensor didn’t log temperature and humidity for these stretches, so this hasn’t been corrected for how thirsty the air was — expect it to read faster in a heated room.',
  ];
  if (!confident) {
    parts.push('One more watering cycle and Greenr will use this instead of the published average.');
  } else if (stated && stated !== value) {
    parts.push(
      `You said it ${RETENTION_SPOKEN[stated]}. Greenr is going with what the sensor watched — you can change your answer when you edit this plant, but the measurement will keep taking precedence.`,
    );
  }

  return {
    value,
    dryDays,
    tauDays,
    ptsPerDay,
    runs,
    observedHours,
    fit,
    confident,
    measuredEndToEnd,
    demandCorrected,
    stated,
    agreesWithOwner: stated ? stated === value : null,
    headline,
    detail: parts.join(' '),
  };
}

/**
 * The retention value the rest of the app should use: the measurement once it is
 * trustworthy, otherwise whatever the owner said, otherwise nothing (and
 * soilProfile falls back to the published curve for the mix).
 *
 * The same precedence the hydration model already follows for millilitres —
 * physics until there is evidence, evidence thereafter.
 */
export function effectiveRetention(
  plant: RetentionPlant,
  history: Reading[],
): SoilRetention | null {
  const est = history.length ? retentionEstimate(plant, history) : null;
  if (est?.confident) return est.value;
  return plant.soilRetention ?? null;
}

/**
 * A plant with its measured retention substituted in, for handing to the
 * watering and soil-profile maths. Returns the original object unchanged when
 * there is nothing to substitute, so it is free to call on every render.
 */
export function withMeasuredRetention<T extends RetentionPlant>(plant: T, history: Reading[]): T {
  const eff = effectiveRetention(plant, history);
  if (eff == null || eff === plant.soilRetention) return plant;
  return { ...plant, soilRetention: eff };
}
