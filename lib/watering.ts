import type { Reading } from './devices';
import { getSpecies } from './plants';
import { currentSeason, seasonIntervalFactor, SEASON_LABEL, type Season } from './season';
import type { PotMaterial, PotSize } from './types';

/** Approximate soil volume per pot size, in liters. */
const POT_LITERS: Record<PotSize, number> = { S: 1.2, M: 3, L: 6.5 };

/**
 * Soil volume in liters. With a measured pot diameter this is exact-ish
 * (tapered pot ≈ 0.55 × d³ ml for d in cm — a 15 cm pot ≈ 1.9 L, 25 cm ≈ 8.6 L);
 * otherwise fall back to the S/M/L bucket. Same species, different pot size =
 * different water needs — the diameter is what makes amounts personal.
 */
export function soilLiters(potSize: PotSize, potCm?: number | null): number {
  if (potCm != null && potCm >= 5 && potCm <= 80) {
    return (0.55 * potCm * potCm * potCm) / 1000;
  }
  return POT_LITERS[potSize];
}

/**
 * How much water (ml) it takes to lift soil moisture from `fromPct` to
 * `toPct` in this pot. Roughly: 1% moisture in 1 L of mix ≈ 10 ml of water;
 * terracotta wicks some away, so it gets a little extra. Rounded to 25 ml —
 * an amount a person can actually measure with a cup.
 */
export function mlNeeded(
  potSize: PotSize,
  potMaterial: PotMaterial,
  fromPct: number,
  toPct: number,
  potCm?: number | null,
): number {
  const rise = Math.max(0, toPct - fromPct);
  if (rise === 0) return 0;
  const liters = soilLiters(potSize, potCm);
  const factor = potMaterial === 'Terracotta' ? 1.15 : potMaterial === 'Ceramic' ? 1.05 : 1;
  const ml = liters * 10 * rise * factor;
  return Math.max(50, Math.round(ml / 25) * 25);
}

/**
 * Turns soil-moisture history into a direct watering call — no "check if the
 * top inch is dry." Estimates the drying rate from recent readings and projects
 * when soil will fall below the plant's ideal low. Low confidence when there
 * isn't enough history yet (the learning phase fills that in).
 */
export interface Watering {
  verdict: string;
  detail: string;
  confidence: 'high' | 'low';
  tone: 'good' | 'warn' | 'bad';
}

/** Least-squares slope of soil% vs time, in %/day. Null if too few points. */
function slopePerDay(points: { t: number; v: number }[]): number | null {
  if (points.length < 3) return null;
  const t0 = points[0].t;
  const xs = points.map((p) => (p.t - t0) / 864e5); // days
  const ys = points.map((p) => p.v);
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

export function wateringAdvice(
  history: Reading[],
  band: [number, number],
  speciesName: string,
): Watering | null {
  const soils = history
    .filter((r) => r.soil_pct != null)
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.soil_pct as number }));
  if (soils.length === 0) return null;

  const latest = soils[soils.length - 1].v;
  const [lo, hi] = band;

  // Already dry → act now.
  if (latest < lo) {
    return {
      verdict: 'Water today',
      detail: `Soil is ${Math.round(latest)}% — below ${speciesName}'s ideal ${lo}–${hi}%.`,
      confidence: 'high',
      tone: 'bad',
    };
  }
  // Wetter than ideal → let it dry.
  if (latest > hi + (hi - lo) * 0.4) {
    return {
      verdict: 'No water needed',
      detail: `Soil ${Math.round(latest)}% — wetter than ideal; let it dry out.`,
      confidence: 'high',
      tone: 'good',
    };
  }

  const now = Date.now();
  const recent = soils.filter((s) => now - s.t < 3 * 864e5);
  const slope = slopePerDay(recent);

  if (slope != null && slope < -0.8) {
    const rate = Math.abs(Math.round(slope));
    const daysToDry = (latest - lo) / -slope;
    if (daysToDry <= 1)
      return { verdict: 'Water today', detail: `Drying ~${rate}%/day — it reaches its low today.`, confidence: 'high', tone: 'warn' };
    if (daysToDry <= 2)
      return { verdict: 'Water tomorrow', detail: `Drying ~${rate}%/day — it reaches its low in about a day.`, confidence: 'high', tone: 'warn' };
    return {
      verdict: 'No water needed',
      detail: `About ${Math.round(daysToDry)} days until it needs water, at the current drying pace.`,
      confidence: 'high',
      tone: 'good',
    };
  }

  // In range, not enough drying signal yet.
  if (latest >= (lo + hi) / 2) {
    return {
      verdict: 'Soil still moist',
      detail: `Soil ${Math.round(latest)}% — comfortably in range.`,
      confidence: recent.length >= 3 ? 'high' : 'low',
      tone: 'good',
    };
  }
  return {
    verdict: 'No water needed yet',
    detail: 'Learning your plant’s drying cycle — a firm prediction appears after a few days of readings.',
    confidence: 'low',
    tone: 'good',
  };
}

/* ───────────────────────── The real watering calculator ─────────────────────────
 * Not a bucket guess. The plan works from physical inputs and shows its math:
 *   volume    — soil liters from the measured pot diameter (or S/M/L fallback)
 *   species   — how much of the pot's water this category actually consumes
 *               between drinks (succulents sip; ferns gulp)
 *   material  — terracotta wicks water out through its walls
 *   climate   — measured temperature / humidity / light shift evaporation
 *   season    — winter dormancy stretches the cycle; summer heat shortens it
 * Output: exact ml per watering + expected interval + every factor listed, so
 * the number is checkable, not oracular. */

/** Fraction of the pot's water a category consumes between waterings, and its baseline cycle. */
const CATEGORY_DRAW: Record<string, { drawPct: number; cycleDays: number }> = {
  tropical: { drawPct: 14, cycleDays: 7 },
  fern: { drawPct: 16, cycleDays: 4 },
  palm: { drawPct: 13, cycleDays: 8 },
  succulent: { drawPct: 9, cycleDays: 14 },
  cactus: { drawPct: 7, cycleDays: 21 },
  vine: { drawPct: 13, cycleDays: 7 },
  tree: { drawPct: 13, cycleDays: 9 },
  herb: { drawPct: 16, cycleDays: 3 },
  vegetable: { drawPct: 18, cycleDays: 2 },
  flowering: { drawPct: 15, cycleDays: 5 },
  orchid: { drawPct: 11, cycleDays: 7 },
  grass: { drawPct: 14, cycleDays: 5 },
  carnivorous: { drawPct: 16, cycleDays: 4 },
  shrub: { drawPct: 13, cycleDays: 7 },
  bulb: { drawPct: 13, cycleDays: 5 },
};

export interface WaterFactor {
  label: string;
  /** e.g. "×1.2" or "−15%" in words */
  effect: string;
}

export interface WaterPlan {
  /** ml to give per watering (rounded to a measurable 25 ml) */
  ml: number;
  /** expected days between waterings under current conditions */
  intervalDays: number;
  /** estimated daily consumption, ml/day */
  perDayMl: number;
  season: Season;
  /** every input that shaped the number, for transparency */
  factors: WaterFactor[];
  /** one-line summary, e.g. "≈350 ml about every 6 days" */
  summary: string;
}

/**
 * Compute the personalized watering plan. Climate inputs are optional — each
 * one provided sharpens the number (sensor plants pass measured values;
 * sensorless plants get the seasonal/pot-accurate baseline).
 */
export function waterPlan(opts: {
  species: string;
  potSize: PotSize;
  potMaterial: PotMaterial;
  potCm?: number | null;
  /** measured air temperature, °C */
  tempC?: number | null;
  /** measured relative humidity, % */
  humidityPct?: number | null;
  /** multi-day daytime light average, 0–100 */
  lightAvg?: number | null;
  now?: Date;
}): WaterPlan {
  const now = opts.now ?? new Date();
  const season = currentSeason(now);
  const sp = getSpecies(opts.species);
  const cat = CATEGORY_DRAW[sp?.category ?? 'tropical'] ?? CATEGORY_DRAW.tropical;
  const liters = soilLiters(opts.potSize, opts.potCm);
  const factors: WaterFactor[] = [];

  factors.push({
    label: 'Pot volume',
    effect: `${liters.toFixed(1)} L of mix${opts.potCm ? ` (${opts.potCm} cm pot)` : ` (${opts.potSize} pot)`}`,
  });
  factors.push({
    label: sp?.category ? `${opts.species} (${sp.category})` : opts.species,
    effect: `uses ~${cat.drawPct}% of pot water per cycle`,
  });

  // Per-watering amount: replace what the plant + evaporation consumed.
  // Baseline: drawPct% of the pot volume (1% of 1 L ≈ 10 ml of water).
  let ml = liters * 10 * cat.drawPct;

  // Material: terracotta loses extra to its walls; plastic loses least.
  if (opts.potMaterial === 'Terracotta') {
    ml *= 1.15;
    factors.push({ label: 'Terracotta pot', effect: 'breathes — +15% water' });
  } else if (opts.potMaterial === 'Plastic') {
    factors.push({ label: 'Plastic pot', effect: 'holds moisture — no extra' });
  }

  // Interval starts at the category cycle, then climate + season reshape it.
  let interval = cat.cycleDays;

  // Pot size: more soil = longer reserves (interval scales gently with volume).
  if (liters < 1.8) {
    interval *= 0.8;
    factors.push({ label: 'Small pot', effect: 'dries fast — water sooner' });
  } else if (liters > 4.5) {
    interval *= 1.25;
    factors.push({ label: 'Large pot', effect: 'deep reserves — longer gaps' });
  }

  // Temperature: evaporation roughly doubles per +10 °C above room temp.
  if (opts.tempC != null) {
    const t = opts.tempC;
    if (t >= 28) { interval *= 0.75; factors.push({ label: `Warm (${Math.round(t)}°C measured)`, effect: 'faster drying — −25% interval' }); }
    else if (t >= 24) { interval *= 0.9; factors.push({ label: `Mild-warm (${Math.round(t)}°C measured)`, effect: '−10% interval' }); }
    else if (t <= 16) { interval *= 1.2; factors.push({ label: `Cool (${Math.round(t)}°C measured)`, effect: 'slower drying — +20% interval' }); }
  }

  // Humidity: dry air pulls water out of soil and leaves.
  if (opts.humidityPct != null) {
    const h = opts.humidityPct;
    if (h <= 35) { interval *= 0.88; factors.push({ label: `Dry air (${Math.round(h)}% RH)`, effect: '−12% interval' }); }
    else if (h >= 65) { interval *= 1.12; factors.push({ label: `Humid air (${Math.round(h)}% RH)`, effect: '+12% interval' }); }
  }

  // Light: brighter spot = more photosynthesis + evaporation.
  if (opts.lightAvg != null) {
    const l = opts.lightAvg;
    if (l >= 60) { interval *= 0.88; factors.push({ label: `Bright spot (${Math.round(l)}/100 daytime avg)`, effect: '−12% interval' }); }
    else if (l <= 20) { interval *= 1.12; factors.push({ label: `Dim spot (${Math.round(l)}/100 daytime avg)`, effect: '+12% interval' }); }
  }

  // Season: dormancy vs growth.
  const sf = seasonIntervalFactor(season);
  if (sf !== 1) {
    interval *= sf;
    factors.push({
      label: SEASON_LABEL[season],
      effect: sf > 1 ? `dormant pace — ${Math.round((sf - 1) * 100)}% longer gaps` : `growth pace — ${Math.round((1 - sf) * 100)}% shorter gaps`,
    });
  }

  const mlRounded = Math.max(50, Math.round(ml / 25) * 25);
  const intervalDays = Math.max(1, Math.round(interval * 10) / 10);
  const perDayMl = Math.round(mlRounded / intervalDays);

  return {
    ml: mlRounded,
    intervalDays,
    perDayMl,
    season,
    factors,
    summary: `≈${mlRounded} ml about every ${Math.round(intervalDays)} day${Math.round(intervalDays) === 1 ? '' : 's'} (~${perDayMl} ml/day)`,
  };
}
