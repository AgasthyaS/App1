import { IDLE_WAKE_SECONDS, type Reading } from './devices';
import type { PotMaterial, PotSize, WaterEvent } from './types';
import { mlPerPointPerLiter } from './soilProfile';
import { soilLiters } from './watering';

/**
 * Soil-hydration dynamics — inferring watering VOLUME and optimising it from the
 * shape of the moisture curve.
 *
 * The physical model, made rigorous:
 *
 *   • A pour SATURATES the soil: moisture jumps from a trough (pre) up to a peak.
 *     The RISE (peak − pre) is proportional to how much water was actually
 *     absorbed:  poured_ml ≈ rise% × pot_soil_volume × retention.  This is the
 *     exact inverse of the ml-needed calculator, so volume and moisture speak the
 *     same language.
 *
 *   • The soil then DRIES at a rate set by the plant + its environment (evapo-
 *     transpiration), NOT by how much was poured. So a bigger pour doesn't dry
 *     slower — it starts HIGHER and therefore LASTS LONGER before hitting the
 *     "needs water" low.  duration ≈ (peak − low) / dryingRate.
 *
 *   • Pairing what the user LOGGED (ml) with what the sensor SAW (rise) calibrates
 *     the volume↔moisture constant for THIS pot/soil/sensor, correcting the
 *     generic soil-volume estimate. Two paired pours and the model is personal.
 *
 * Inverting all this gives efficiency: to last a target number of days, fill to a
 * specific peak — and pouring past saturation just drains away (wasted water).
 * Everything degrades honestly: no events → null; the confidence grows with data.
 */

const DAY = 86400000;
const HOUR = 3600000;
const RISE_MIN = 10; // an UNLOGGED jump this big (%) marks a watering
/** A LOGGED pour only needs to clear sensor noise to be worth calibrating from. */
const SMALL_RISE_MIN = 4;
const PAIR_WINDOW_H = 18; // logged ml within this of a detected pour = the same event
const SAT_CEIL = 95; // practical saturation — beyond this, water drains, not stores
/** A reading gap this many times the normal spacing = the sensor was offline. */
const OFFLINE_GAP_FACTOR = 2.5;

export interface WateringEvent {
  /** peak (saturation) time, ms */
  at: number;
  preMoisture: number;
  peakMoisture: number;
  /** peak − pre, the absorbed rise */
  rise: number;
  /** drying rate over the segment after this pour, %/day (positive) */
  dryingPerDay: number | null;
  /** days from peak until soil reached the band low (null = watered again first) */
  lastedDays: number | null;
  /** true if the next pour came before soil hit the low (we can't see full duration) */
  wateredEarly: boolean;
  /** estimated volume poured, ml (calibrated if we have paired logs) */
  estMl: number | null;
  /** the user's logged amount paired to this event, if any */
  loggedMl: number | null;
}

export interface EfficientPour {
  ml: number;
  /** the peak moisture that volume fills to */
  peak: number;
  /** true when the target can't be met with one pour (would exceed saturation) */
  capped: boolean;
  /** days this pour is expected to last */
  lastsDays: number;
}

export interface HydrationModel {
  events: WateringEvent[];
  /** ml that raises THIS pot's moisture by 1 percentage point */
  mlPerPct: number;
  /**
   * Least-squares fit through the logged pours — the pot's own correlation.
   * `r2` here is an AGREEMENT score (how well the individual pours concur about
   * ml-per-point), not a textbook R²: see the note where it is computed.
   */
  fit: { k: number; r2: number; n: number };
  /** what the physics model alone predicted, for comparison */
  modelledMlPerPct: number;
  /** true when mlPerPct came from paired logged pours, not just the soil model */
  calibrated: boolean;
  calibrationPairs: number;
  /** typical drying rate, %/day (median of per-event decays) */
  dryingPerDay: number | null;
  /** highest peak actually observed — the real saturation ceiling for this setup */
  saturationPct: number;
  /** the reporting cadence measured from the data, in hours (≈3 h at idle) */
  reportIntervalH: number;
  /** 0–1, grows with events + calibration pairs; lower when sampling is coarse */
  confidence: number;
  /** ml to last `targetDays` starting from `fromMoisture`; null if drying unknown */
  mlForDays: (targetDays: number, fromMoisture: number, band: [number, number]) => EfficientPour | null;
}

interface Pot {
  size: PotSize;
  material: PotMaterial;
  cm?: number | null;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * The reporting cadence, MEASURED from the data (median gap between readings) —
 * not assumed. wake_seconds is server-controlled, so a device might report every
 * 3 h, or faster in watch mode, or slower; the model adapts to whatever it sees.
 * Falls back to the idle default until there's enough history.
 */
function observedIntervalMs(soils: { t: number }[]): number {
  if (soils.length < 3) return IDLE_WAKE_SECONDS * 1000;
  const gaps: number[] = [];
  for (let i = 1; i < soils.length; i++) gaps.push(soils[i].t - soils[i - 1].t);
  const m = median(gaps);
  return m > 0 ? m : IDLE_WAKE_SECONDS * 1000;
}

function slopePerDay(pts: { t: number; v: number }[]): number | null {
  if (pts.length < 3) return null;
  const t0 = pts[0].t;
  const xs = pts.map((p) => (p.t - t0) / DAY);
  const ys = pts.map((p) => p.v);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? null : num / den;
}

/** ml per 1 display-% rise from the pot's soil volume + material (the generic
 *  model, same curve as mlNeeded so all app volumes agree; paired logged
 *  pours replace this with the pot's own measured ratio).
 *
 *  `atPct` is where the soil currently sits: a display point costs about three
 *  times as much water at 10 as it does at 50, so the prior is evaluated on the
 *  Topp curve's local slope instead of a single flat constant. */
function modelMlPerPct(pot: Pot, atPct: number): number {
  const liters = soilLiters(pot.size, pot.cm);
  const factor = pot.material === 'Terracotta' ? 1.15 : pot.material === 'Ceramic' ? 1.05 : 1;
  return liters * mlPerPointPerLiter(atPct) * factor;
}

/** Find watering events (moisture jumps) and characterise each one.
 *  `offlineGapMs` is the span above which a reading gap means the sensor was
 *  offline, so decay/duration must not be interpolated across it. */
function detectEvents(soils: { t: number; v: number }[], lo: number, offlineGapMs: number): WateringEvent[] {
  const events: WateringEvent[] = [];
  let i = 1;
  while (i < soils.length) {
    if (soils[i].v - soils[i - 1].v >= RISE_MIN) {
      const pre = soils[i - 1].v;
      // Walk up to the local peak (moisture may still be rising over 1–2 readings).
      let j = i;
      while (j + 1 < soils.length && soils[j + 1].v >= soils[j].v - 1) {
        if (soils[j + 1].v > soils[j].v) j += 1;
        else break;
      }
      const peak = soils[j].v;
      const rise = peak - pre;
      if (rise >= RISE_MIN) {
        events.push({
          at: soils[j].t,
          preMoisture: pre,
          peakMoisture: peak,
          rise,
          dryingPerDay: null,
          lastedDays: null,
          wateredEarly: false,
          estMl: null,
          loggedMl: null,
        });
      }
      i = j + 1;
    } else {
      i += 1;
    }
  }

  // Characterise the decay after each event (up to the next event, or the end).
  for (let e = 0; e < events.length; e++) {
    const ev = events[e];
    const segEnd = e + 1 < events.length ? events[e + 1].at : Infinity;
    const seg = soils.filter((p) => p.t >= ev.at && p.t <= segEnd);
    // Fit the drying rate only over the contiguous run after the pour — stop at
    // the first offline gap so a sleep period doesn't flatten or distort it.
    const contig: { t: number; v: number }[] = [];
    for (let k = 0; k < seg.length; k++) {
      if (k > 0 && seg[k].t - seg[k - 1].t > offlineGapMs) break;
      contig.push(seg[k]);
    }
    const slope = slopePerDay(contig);
    ev.dryingPerDay = slope != null && slope < 0 ? Math.round(-slope * 100) / 100 : null;

    // Duration: interpolate when the decaying series first crosses the band low.
    // Never interpolate across an offline gap — if the crossing falls inside a
    // stretch where the sensor was asleep, we genuinely don't know when it
    // happened, so we don't invent a precise time.
    let lasted: number | null = null;
    for (let k = 1; k < seg.length; k++) {
      if (seg[k - 1].v >= lo && seg[k].v < lo) {
        if (seg[k].t - seg[k - 1].t > offlineGapMs) break; // crossing hidden in a gap
        const frac = (seg[k - 1].v - lo) / (seg[k - 1].v - seg[k].v || 1);
        const crossT = seg[k - 1].t + frac * (seg[k].t - seg[k - 1].t);
        lasted = (crossT - ev.at) / DAY;
        break;
      }
    }
    if (lasted == null && e + 1 < events.length) {
      // Watered again before reaching the low — we can't see the full duration.
      ev.wateredEarly = true;
    }
    ev.lastedDays = lasted != null ? Math.round(lasted * 10) / 10 : null;
  }

  return events;
}

/**
 * Build the hydration model for a plant from its sensor history + logged pours.
 * Returns null until at least one watering event is visible in the data.
 */
export function buildHydrationModel(
  history: Reading[],
  waterLog: WaterEvent[] | undefined,
  pot: Pot,
  band: [number, number],
): HydrationModel | null {
  const soils = history
    .filter((r) => r.soil_pct != null)
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.soil_pct as number }))
    .sort((a, b) => a.t - b.t);
  if (soils.length < 3) return null;

  // The reporting cadence, measured from the data. A gap much larger than this
  // means the sensor was offline — used to keep decay/duration honest.
  const intervalMs = observedIntervalMs(soils);
  const offlineGapMs = intervalMs * OFFLINE_GAP_FACTOR;

  const [lo] = band;
  const events = detectEvents(soils, lo, offlineGapMs);

  // Calibrate volume↔rise: pair logged ml with the detected pour it belongs to.
  const logs = (waterLog ?? [])
    .filter((w) => w.ml != null && w.ml > 0)
    .map((w) => ({ t: new Date(w.at).getTime(), ml: w.ml as number }))
    .filter((l) => Number.isFinite(l.t));

  // Bail only when there is genuinely nothing to learn from. Requiring a detected
  // JUMP here was silently fatal for thirsty pots: one that costs 120 ml per
  // point answers a 1 L trial with an 8-point rise, under the 10-point jump
  // threshold, so the model returned null and it could never calibrate — the
  // exact pots that most need calibrating were the ones locked out of it.
  if (events.length === 0 && logs.length < 2) return null;
  const ratios: number[] = [];
  const usedLogs = new Set<number>(); // each logged pour calibrates at most ONE event
  for (const ev of events) {
    let best: { t: number; ml: number } | null = null;
    let bestDt = PAIR_WINDOW_H * 3600000;
    for (const l of logs) {
      if (usedLogs.has(l.t)) continue;
      const dt = Math.abs(l.t - ev.at);
      if (dt <= bestDt) {
        best = l;
        bestDt = dt;
      }
    }
    if (best && ev.rise > 0) {
      usedLogs.add(best.t);
      ev.loggedMl = best.ml;
      ratios.push(best.ml / ev.rise); // ml per 1% rise, observed
    }
  }

  const calibrated = ratios.length >= 2;
  // Evaluate the generic prior at the band low — the moisture level where the
  // "how much should I pour" question is actually asked.
  const modelled = modelMlPerPct(pot, lo);
  const mlPerPct = calibrated ? median(ratios) : modelled;

  /*
   * THE CORRELATION. Each logged pour paired with the rise the sensor actually
   * saw is one (rise, ml) observation. Fitting ml = k·rise through the origin
   * gives k — this pot's real millilitres-per-point — which supersedes the whole
   * modelled chain (Topp curve, leaching, depth profile) because it measures the
   * thing those were estimating, including everything they cannot see: how
   * root-bound the pot is, how hydrophobic the compost has become, how much runs
   * down one particular gap between soil and wall.
   *
   * R² reports how well a single constant explains the observations. Low R² means
   * the pours disagree with each other — usually because one ran straight through
   * — and the model should keep leaning on physics rather than trust the fit.
   */
  const fit = (() => {
    // Observations come from LOGGED pours, not only from detected jumps. The jump
    // detector needs a RISE_MIN (10 pt) step to call something a watering, which
    // is right for spotting unlogged waterings but wrong here: a pot that costs
    // 120 ml per point answers a 1 L trial with only 8 points, so it would never
    // have produced a single calibration pair and could never learn.
    const obs: { x: number; y: number }[] = [];
    for (const ev of events) {
      if (ev.loggedMl != null && ev.rise > 0) obs.push({ x: ev.rise, y: ev.loggedMl });
    }
    for (const l of logs) {
      if (events.some((e) => e.loggedMl === l.ml && Math.abs(e.at - l.t) <= PAIR_WINDOW_H * 3600000)) continue;
      const before = soils.filter((p) => p.t <= l.t);
      const after = soils.filter((p) => p.t > l.t && p.t - l.t <= PAIR_WINDOW_H * 3600000);
      if (!before.length || !after.length) continue;
      const rise = Math.max(...after.map((p) => p.v)) - before[before.length - 1].v;
      // Still require a rise clearly above sensor noise, just a far lower bar.
      if (rise >= SMALL_RISE_MIN) obs.push({ x: rise, y: l.ml });
    }
    if (obs.length < 2) return { k: modelled, r2: 0, n: obs.length };

    let sxy = 0;
    let sxx = 0;
    for (const o of obs) {
      sxy += o.x * o.y;
      sxx += o.x * o.x;
    }
    const k = sxx > 0 ? sxy / sxx : modelled;

    /*
     * QUALITY, measured robustly. R² is the wrong tool here: it compares against
     * the variance of y, and when every logged pour is the same size that
     * variance is ~0, so a PERFECT fit scores R² = −Infinity and the gate would
     * reject its own best calibration.
     *
     * What actually matters is whether the individual pours AGREE with each other
     * about the millilitres-per-point. So: median absolute deviation of the
     * per-pour ratios, relative to the median. Tight agreement → near 1.
     */
    const ratios = obs.map((o) => o.y / o.x);
    const med = median(ratios);
    const mad = median(ratios.map((r) => Math.abs(r - med)));
    const agreement = med > 0 ? Math.max(0, Math.min(1, 1 - (mad / med) * 2)) : 0;
    return { k, r2: agreement, n: obs.length };
  })();

  // Fill in each event's estimated volume from the (calibrated) constant.
  for (const ev of events) {
    ev.estMl = Math.max(25, Math.round((ev.rise * mlPerPct) / 25) * 25);
  }

  // Typical drying rate: median of per-event decays that we could measure.
  const decays = events.map((e) => e.dryingPerDay).filter((d): d is number => d != null && d > 0);
  const dryingPerDay = decays.length ? Math.round(median(decays) * 100) / 100 : null;

  const saturationPct = Math.min(100, Math.max(SAT_CEIL, ...events.map((e) => e.peakMoisture)));

  // Coarser sampling resolves the peak and drying curve less precisely, so it
  // caps confidence: 1× at the nominal ~3 h cadence, tapering for slower reports.
  const reportIntervalH = intervalMs / HOUR;
  const cadenceFactor = Math.min(1, (IDLE_WAKE_SECONDS / 3600) / reportIntervalH);
  const confidence = Math.max(
    0,
    Math.min(1, 0.2 + 0.12 * Math.min(events.length, 4) + 0.16 * Math.min(ratios.length, 2)) *
      (0.7 + 0.3 * cadenceFactor),
  );

  const mlForDays = (targetDays: number, fromMoisture: number, b: [number, number]): EfficientPour | null => {
    if (dryingPerDay == null || dryingPerDay <= 0) return null;
    const low = b[0];
    // Peak needed so that (peak − low) / dryingRate ≈ targetDays.
    let neededPeak = low + dryingPerDay * targetDays;
    const capped = neededPeak > saturationPct;
    if (capped) neededPeak = saturationPct;
    const start = Math.min(fromMoisture, neededPeak);
    const neededRise = Math.max(0, neededPeak - start);
    const ml = Math.max(25, Math.round((neededRise * mlPerPct) / 25) * 25);
    const lastsDays = Math.round(((neededPeak - low) / dryingPerDay) * 10) / 10;
    return { ml, peak: Math.round(neededPeak), capped, lastsDays };
  };

  return {
    events,
    mlPerPct: Math.round(mlPerPct * 10) / 10,
    fit: { k: Math.round(fit.k * 10) / 10, r2: Math.round(fit.r2 * 100) / 100, n: fit.n },
    modelledMlPerPct: Math.round(modelled * 10) / 10,
    calibrated,
    calibrationPairs: ratios.length,
    dryingPerDay,
    saturationPct: Math.round(saturationPct),
    reportIntervalH: Math.round(reportIntervalH * 10) / 10,
    confidence: Math.round(confidence * 100) / 100,
    mlForDays,
  };
}

export interface RootBoundSignal {
  /** ml-per-point measured from the earliest pours */
  earlyMlPerPoint: number;
  /** ml-per-point measured from the most recent pours */
  recentMlPerPoint: number;
  /** negative = the pot now holds less water than it used to */
  changePct: number;
  confident: boolean;
  text: string;
}

/**
 * ROOT-BOUND DETECTION, for free, from the calibration itself.
 *
 * As a root ball fills its pot there is progressively less SOIL in the same
 * volume — roots displace it. Less soil means less water is needed to move the
 * moisture reading, so this pot's measured millilitres-per-point drifts DOWN over
 * months. That drift is a direct physical measurement of the root ball growing,
 * and it needs no new sensor, no new question and no calendar: it falls out of
 * data the watering model is already collecting.
 *
 * It is the honest version of "repot every year or two" — some plants fill a pot
 * in six months and others sit happily for five years, and this tells them apart
 * by measurement rather than by rule of thumb.
 *
 * Deliberately cautious: it needs several pours spread over real time, and the
 * drop has to be large enough that noise cannot explain it.
 */
export function rootBoundSignal(model: HydrationModel | null): RootBoundSignal | null {
  if (!model) return null;
  const paired = model.events
    .filter((e) => e.loggedMl != null && e.rise > 0)
    .sort((a, b) => a.at - b.at);
  // Four pours minimum, so "early" and "recent" are each an average of two.
  if (paired.length < 4) return null;
  // …and they must span enough time for roots to have actually grown.
  const spanDays = (paired[paired.length - 1].at - paired[0].at) / DAY;
  if (spanDays < 45) return null;

  const half = Math.floor(paired.length / 2);
  const ratio = (list: WateringEvent[]) =>
    median(list.map((e) => (e.loggedMl as number) / e.rise));
  const early = ratio(paired.slice(0, half));
  const recent = ratio(paired.slice(-half));
  if (!(early > 0) || !(recent > 0)) return null;

  const changePct = ((recent - early) / early) * 100;
  // Only a sustained DROP means root-bound; a rise usually means the compost has
  // gone hydrophobic, which is a different problem with a different fix.
  if (changePct > -18) return null;

  return {
    earlyMlPerPoint: Math.round(early * 10) / 10,
    recentMlPerPoint: Math.round(recent * 10) / 10,
    changePct: Math.round(changePct),
    confident: paired.length >= 6 && changePct <= -25,
    text: `This pot now takes about ${Math.round(Math.abs(changePct))}% less water to shift its moisture reading than it did ${Math.round(spanDays)} days ago — ${Math.round(recent)} ml per point versus ${Math.round(early)} ml. That means there is measurably less soil in it than there was, which is what happens as roots fill a pot. Worth checking for roots circling the base or coming out of the drainage holes; if so it is ready for a pot one size up.`,
  };
}
