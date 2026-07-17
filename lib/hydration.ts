import { IDLE_WAKE_SECONDS, type Reading } from './devices';
import type { PotMaterial, PotSize, WaterEvent } from './types';
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
const RISE_MIN = 10; // a moisture jump this big (%) marks a watering
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

/** ml per 1% moisture rise from the pot's soil volume + material (the generic model). */
function modelMlPerPct(pot: Pot): number {
  const liters = soilLiters(pot.size, pot.cm);
  const factor = pot.material === 'Terracotta' ? 1.15 : pot.material === 'Ceramic' ? 1.05 : 1;
  return liters * 10 * factor; // matches mlNeeded: ml = liters*10*rise*factor
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
  if (events.length === 0) return null;

  // Calibrate volume↔rise: pair logged ml with the detected pour it belongs to.
  const logs = (waterLog ?? [])
    .filter((w) => w.ml != null && w.ml > 0)
    .map((w) => ({ t: new Date(w.at).getTime(), ml: w.ml as number }));
  const ratios: number[] = [];
  for (const ev of events) {
    let best: { t: number; ml: number } | null = null;
    let bestDt = PAIR_WINDOW_H * 3600000;
    for (const l of logs) {
      const dt = Math.abs(l.t - ev.at);
      if (dt <= bestDt) {
        best = l;
        bestDt = dt;
      }
    }
    if (best && ev.rise > 0) {
      ev.loggedMl = best.ml;
      ratios.push(best.ml / ev.rise); // ml per 1% rise, observed
    }
  }

  const calibrated = ratios.length >= 2;
  const mlPerPct = calibrated ? median(ratios) : modelMlPerPct(pot);

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
    calibrated,
    calibrationPairs: ratios.length,
    dryingPerDay,
    saturationPct: Math.round(saturationPct),
    reportIntervalH: Math.round(reportIntervalH * 10) / 10,
    confidence: Math.round(confidence * 100) / 100,
    mlForDays,
  };
}
