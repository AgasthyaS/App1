import type { Reading } from './devices';
import { getSpecies, waterProfileFor } from './plants';
import { MAX_SINGLE_POUR_FRACTION, mlPerPointPerLiter, profileCorrection, waterFractionBetween } from './soilProfile';
import { currentSeason, seasonIntervalFactor, SEASON_LABEL, type Season } from './season';
import { vpdIntervalFactor, vpdKpa } from './vpd';
import type { PotMaterial, PotShape, PotSize, SoilMix, SoilRetention } from './types';

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
  // Plants saved by older builds may have no potSize at all; an unguarded lookup
  // returned undefined and turned every downstream millilitre into NaN.
  return POT_LITERS[potSize] ?? POT_LITERS.M;
}

/** How the pot's soil volume was arrived at — measured, or inferred and how far. */
export interface PotVolume {
  liters: number;
  /** true when the DEPTH was inferred from the diameter rather than measured */
  heightAssumed: boolean;
  /** plain-language basis, for the UI to show instead of pretending to precision */
  basis: string;
}

/**
 * Soil volume with its provenance attached.
 *
 * Volume scales with the CUBE of the diameter, so it is the single biggest lever
 * on every water figure: an unmeasured 28 cm pot is assumed to hold ~12 L, and a
 * wrong guess there moves the answer by litres. The `0.55·d³` fallback assumes a
 * pot of standard proportions (depth ≈ 0.85·diameter) and is accurate to about
 * ±5% for those — but a wide shallow bowl or a tall narrow pot breaks it badly.
 *
 * So when the depth is missing we say so and let the UI ask, rather than quoting
 * a confident number built on a guess.
 */
/**
 * Volume of a tapered pot as a share of its enclosing cylinder.
 *
 * A pot is a frustum, and its volume is (πh/3)(R² + Rr + r²) — which over the
 * cylinder πR²h reduces to (1 + k + k²)/3 for k = base ÷ top diameter. Straight
 * sides give 1.0, a typical nursery taper (base ≈ 0.8 × top) 0.81, a strongly
 * flared pot 0.65. So the shape ALONE is worth about ±20% of the soil volume, and
 * therefore ±20% of every millilitre figure — enough to matter on a big pot.
 */
export const SHAPE_LABEL: Record<PotShape, string> = {
  straight: 'straight-sided',
  tapered: 'tapered',
  'very-tapered': 'strongly tapered',
};

const SHAPE_FACTOR: Record<PotShape, number> = {
  straight: 1.0,
  tapered: 0.81,
  'very-tapered': 0.65,
};

export function potVolume(pot: {
  potSize: PotSize;
  potCm?: number | null;
  potHeightCm?: number | null;
  potShape?: PotShape;
}): PotVolume {
  const { potSize, potCm, potHeightCm, potShape } = pot;
  // Bound BOTH dimensions. soilLiters guards 5–80 but this branch did not, so a
  // stray Infinity or a fat-fingered 1e9 produced an infinite pot and an
  // infinite pour instead of falling back to the size bucket.
  if (
    potCm != null && potHeightCm != null &&
    potCm >= 5 && potCm <= 80 &&
    potHeightCm >= 3 && potHeightCm <= 200
  ) {
    const r = potCm / 2;
    const shape = potShape ?? 'tapered';
    return {
      liters: (Math.PI * r * r * potHeightCm * (SHAPE_FACTOR[shape] ?? SHAPE_FACTOR.tapered)) / 1000,
      heightAssumed: false,
      basis: `measured ${potCm} × ${potHeightCm} cm${potShape && SHAPE_LABEL[potShape] ? `, ${SHAPE_LABEL[potShape]}` : ', taper assumed'}`,
    };
  }
  if (potCm != null && potCm >= 5 && potCm <= 80) {
    return {
      liters: soilLiters(potSize, potCm),
      heightAssumed: true,
      basis: `${potCm} cm across, depth assumed`,
    };
  }
  const bucket = POT_LITERS[potSize] ?? POT_LITERS.M;
  return { liters: bucket, heightAssumed: true, basis: `${potSize ?? 'medium'} pot, size assumed` };
}

/**
 * How many ml of water raise 1 L of potting mix by ONE point on the sensor's
 * 0–100 display scale, quoted at typical "time to water" dryness.
 *
 * This was previously 1.9, back-derived from an assumed thorough-pour size. That
 * figure does not survive contact with the physics: it implies a full soak of a
 * 3 L pot is ~256 ml, which would not wet the root ball, and contradicts the
 * standard horticultural instruction to water until it runs from the drainage
 * holes (~1 L for a 3 L pot). The value below comes from the Topp curve instead
 * — see `mlPerPointPerLiter`, which is exact for a given moisture level; this
 * constant is just its value around display 30 for callers that need a scalar.
 *
 * Logged pours still override it per pot: see `buildHydrationModel`.
 */
export const ML_PER_PT_PER_LITER = mlPerPointPerLiter(30);

/**
 * Container capacity on the display scale — the wettest a pot stays once it has
 * finished draining. Peat-based mixes hold roughly 55–60% water content at that
 * point, which the Topp curve puts near display 70.
 *
 * Deliberately conservative. Freshly-watered pots are often SEEN to peak higher
 * than this, partly because the probe's buried span sits in the wetter lower part
 * of the profile. Capping here keeps a single suggested pour to something that
 * will soak in rather than run out of the holes; a genuinely bone-dry pot needs
 * two slow passes, not one huge one.
 */
const CONTAINER_CAPACITY_PCT = 70;

/** Hard ceiling on any single suggested pour, whatever the stored pot size. */
const ABSOLUTE_MAX_POUR_ML = 10000;

/**
 * Where a soak-and-dry plant should be taken TO when it is watered.
 *
 * Succulents, cacti and snake plants are not "little and often" — the practice
 * that keeps them alive is drenching the whole root ball, then leaving it until
 * bone dry. Their comfort BAND is low because that is where they should sit most
 * of the time, so quoting the band mid-point as a pour target would have you
 * dribbling water onto the surface, which rots the crown and never reaches the
 * roots. The interval already carries the "and then leave it" half.
 */
const SOAK_AND_DRY_TARGET_PCT = 55;
/** Bog plants (flytraps, pitchers) must never dry out — aim high, not mid-band. */
const CONSTANTLY_DAMP_TARGET_PCT = 60;

/**
 * How much MORE than the stored-water deficit you have to pour, and why.
 *
 * The share of a pour that leaves without ever wetting the root ball is the
 * container-nursery LEACHING FRACTION, and best practice puts it at 0.15–0.30.
 * Where a given pot sits in that range is not arbitrary — it follows from the
 * medium and the pot:
 *
 *   • COARSE MEDIA (grit, bark, cactus mix) have large pores and low capillarity,
 *     so water channels straight through: top of the range. This is why orchids in
 *     bark seem to take no water at all — most of it never touches the roots.
 *   • FINE / DENSE MIXES hold water against gravity and leach least.
 *   • TERRACOTTA is porous and pulls water into its own walls, a loss that is not
 *     leachate at all; ceramic glazes are near-sealed but rarely perfect.
 *   • NO DRAINAGE HOLES means the leaching fraction is ZERO by definition —
 *     nothing can run out. Every millilitre stays, so pouring the usual extra
 *     would sit at the base and rot the roots.
 */
export interface WettingContext {
  potMaterial?: PotMaterial;
  soilMix?: SoilMix | null;
  soilRetention?: SoilRetention | null;
  hasDrainage?: boolean;
}

export interface Wetting {
  /** multiplier applied to the stored-water deficit */
  mult: number;
  leachFraction: number;
  /** plain-language reasons, for showing the working */
  notes: string[];
}

/** Leaching fraction by medium, within the 0.15–0.30 best-practice range. */
const MIX_LEACH: Record<SoilMix, number> = {
  'Gritty / cactus': 0.3,
  'Chunky / aroid': 0.26,
  'Standard mix': 0.2,
  'Dense / heavy': 0.15,
};

/**
 * The owner's own observation of how long their compost stays damp, applied to
 * leaching. It is the same physical property as the alpha scaling in soilProfile:
 * a mix that stays damp for a week is holding water against gravity that a
 * fast-drying one lets go, so proportionally less of a pour escapes.
 */
const RETENTION_LEACH: Record<SoilRetention, number> = {
  fast: +0.04,
  typical: 0,
  retentive: -0.03,
  'very-retentive': -0.05,
};

export function wettingFor(ctx: WettingContext): Wetting {
  const notes: string[] = [];
  // A sealed pot cannot leach. Only a little is lost to the surface and the walls.
  if (ctx.hasDrainage === false) {
    notes.push('No drainage holes — nothing runs out, so every drop stays in the pot');
    return { mult: 1.02, leachFraction: 0, notes };
  }
  const base = (ctx.soilMix != null ? MIX_LEACH[ctx.soilMix] : undefined) ?? 0.2;
  const adj = (ctx.soilRetention != null ? RETENTION_LEACH[ctx.soilRetention] : undefined) ?? 0;
  // Stay inside the 0.15–0.30 range the nursery literature actually supports.
  const leachFraction = Math.min(0.32, Math.max(0.12, base + adj));
  if (adj < 0) notes.push('Your soil holds water longer than average, so less is wasted');
  else if (adj > 0) notes.push('Your soil dries fast, so a little more runs through');
  if (ctx.soilMix && leachFraction >= 0.26) {
    notes.push(`${ctx.soilMix} drains fast — about ${Math.round(leachFraction * 100)}% runs straight through`);
  } else if (ctx.soilMix === 'Dense / heavy') {
    notes.push('Dense mix holds water well — little is wasted');
  } else {
    notes.push(`About ${Math.round(leachFraction * 100)}% drains away without wetting the roots`);
  }
  let mult = 1 / (1 - leachFraction);
  if (ctx.potMaterial === 'Terracotta') {
    mult *= 1.06;
    notes.push('Terracotta is porous and drinks some through its walls');
  } else if (ctx.potMaterial === 'Ceramic') {
    mult *= 1.02;
    notes.push('Glazed ceramic loses only a little');
  }
  return { mult, leachFraction, notes };
}

/**
 * How much water (ml) it takes to lift soil moisture from `fromPct` to
 * `toPct` (display %) in this pot. Terracotta wicks some away, so it gets a
 * little extra. Rounded to 25 ml — an amount a person can actually measure.
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
  // Integrate the real water-content curve over the rise rather than assuming a
  // display point is worth the same everywhere — it is worth ~3× more when dry.
  const ml = waterFractionBetween(fromPct, toPct) * liters * 1000 * factor;
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
  potHeightCm?: number | null;
  potShape?: PotShape;
  soilMix?: SoilMix | null;
  soilRetention?: SoilRetention | null;
  hasDrainage?: boolean;
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
  void cat;
  // Use the SAME volume the deficit path uses. This previously called
  // soilLiters(), which ignores the measured depth and the pot's taper — so the
  // "water plan" line could quote a different pot from the action above it.
  const vol = potVolume({
    potSize: opts.potSize,
    potCm: opts.potCm,
    potHeightCm: opts.potHeightCm,
    potShape: opts.potShape,
  });
  const liters = vol.liters;
  const factors: WaterFactor[] = [];

  factors.push({ label: 'Pot volume', effect: `${liters.toFixed(1)} L of mix (${vol.basis})` });
  factors.push({
    label: sp?.category ? `${opts.species} (${sp.category})` : opts.species,
    effect: `uses ~${cat.drawPct}% of pot water per cycle`,
  });

  // Per-watering amount: refill from the point it wants watering back up to its
  // target. Computed with the SAME physics as the live deficit (mix leaching,
  // wall losses, drainage, depth profile) so the routine figure and the measured
  // one can never disagree — they are the same function, one fed a live reading
  // and the other the band low.
  const band = sp?.band ?? [30, 55];
  const style = waterProfileFor(opts.species).style;
  const routineTarget =
    style === 'soak-and-dry'
      ? SOAK_AND_DRY_TARGET_PCT
      : style === 'constantly-damp'
        ? CONSTANTLY_DAMP_TARGET_PCT
        : Math.round((band[0] + band[1]) / 2);
  let ml = mlToReachTarget({
    currentPct: band[0],
    targetPct: routineTarget,
    potSize: opts.potSize,
    potCm: opts.potCm,
    potHeightCm: opts.potHeightCm,
    potShape: opts.potShape,
    potMaterial: opts.potMaterial,
    soilMix: opts.soilMix,
    soilRetention: opts.soilRetention,
    hasDrainage: opts.hasDrainage,
  });
  factors.push({
    label: 'Refill',
    effect: `${band[0]}% → ${routineTarget}% soil moisture`,
  });
  const wet = wettingFor({
    potMaterial: opts.potMaterial,
    soilMix: opts.soilMix,
    soilRetention: opts.soilRetention,
    hasDrainage: opts.hasDrainage,
  });
  for (const n of wet.notes) factors.push({ label: 'Losses', effect: n });

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

  // EVAPORATIVE DEMAND — temperature and humidity together, not separately.
  //
  // These used to be two independent multipliers, which is physically wrong: what
  // pulls water out of the soil is the vapour pressure deficit between them. The
  // old model scored 22 °C/60% and 28 °C/60% almost the same, when the second
  // dries a pot roughly twice as fast. One correct term replaces both.
  const kpa = vpdKpa(opts.tempC, opts.humidityPct);
  if (kpa != null) {
    const f = vpdIntervalFactor(kpa);
    interval *= f;
    const pctChange = Math.round((f - 1) * 100);
    factors.push({
      label: `Air demand ${kpa.toFixed(2)} kPa (${Math.round(opts.tempC as number)}°C, ${Math.round(opts.humidityPct as number)}% RH)`,
      effect:
        pctChange === 0
          ? 'typical evaporation — no change'
          : pctChange < 0
            ? `dry air pulls water faster — ${pctChange}% interval`
            : `humid air holds it longer — +${pctChange}% interval`,
    });
  } else if (opts.tempC != null) {
    // Temperature alone, when humidity is missing: evaporation roughly doubles
    // per +10 °C above room temperature.
    const t = opts.tempC;
    if (t >= 28) { interval *= 0.75; factors.push({ label: `Warm (${Math.round(t)}°C measured)`, effect: 'faster drying — −25% interval' }); }
    else if (t >= 24) { interval *= 0.9; factors.push({ label: `Mild-warm (${Math.round(t)}°C measured)`, effect: '−10% interval' }); }
    else if (t <= 16) { interval *= 1.2; factors.push({ label: `Cool (${Math.round(t)}°C measured)`, effect: 'slower drying — +20% interval' }); }
  }

  // Humidity alone, when temperature is missing — otherwise it is already
  // accounted for above, inside the vapour pressure deficit.
  if (kpa == null && opts.humidityPct != null) {
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

  const mlRounded = Math.max(25, Math.round(ml / 25) * 25);
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

/**
 * THE recommended pour for a plant, in ml — the single source of truth.
 *
 * Every surface must show the SAME number. Home used to compute a partial
 * "refill to mid-band" (≈450 ml) while the plant screen showed the full plan
 * (≈1050 ml), so the app contradicted itself depending on where you looked.
 *
 * It resolves to the full plan amount because that is also the correct advice:
 * a partial top-up wets only the upper soil and leaves dry pockets around the
 * roots, while a thorough soak until it drains wets the whole root ball. So the
 * VOLUME is constant and only the TIMING changes with conditions.
 */
export function recommendedPourMl(
  plant: {
    species: string;
    potSize: PotSize;
    potMaterial: PotMaterial;
    potCm?: number | null;
    potHeightCm?: number | null;
    potShape?: PotShape;
    soilMix?: SoilMix | null;
    soilRetention?: SoilRetention | null;
    hasDrainage?: boolean;
  },
  env?: {
    tempC?: number | null;
    humidityPct?: number | null;
    lightAvg?: number | null;
    /** live soil reading — when present the amount is the MEASURED deficit */
    soilPct?: number | null;
    /** the soil % to bring it back to (usually mid-band) */
    targetPct?: number | null;
  },
): number {
  // With a sensor we know exactly how dry it is, so quote the water needed to
  // close that gap rather than a routine soak. Quoting a litre for a six-point
  // deficit is the error this prevents.
  // HOW this species likes to be watered changes the TARGET, not just the timing.
  // A snake plant or cactus is on soak-and-dry: the correct action is to wet the
  // whole root ball and then let it dry out completely, so topping it up to a low
  // mid-band figure is the wrong instruction even though the band is low. Bog
  // plants are the mirror image — they must never dry, so they aim high in band.
  const style = waterProfileFor(plant.species).style;
  const effectiveTarget =
    env?.targetPct == null
      ? env?.targetPct
      : style === 'soak-and-dry'
        ? Math.max(env.targetPct, SOAK_AND_DRY_TARGET_PCT)
        : style === 'constantly-damp'
          ? Math.max(env.targetPct, CONSTANTLY_DAMP_TARGET_PCT)
          : env.targetPct;

  if (env?.soilPct != null && effectiveTarget != null && env.soilPct < effectiveTarget) {
    return mlToReachTarget({
      currentPct: env.soilPct,
      targetPct: effectiveTarget,
      potSize: plant.potSize,
      potCm: plant.potCm,
      potHeightCm: plant.potHeightCm,
      potShape: plant.potShape,
      potMaterial: plant.potMaterial,
      soilMix: plant.soilMix,
      soilRetention: plant.soilRetention,
      hasDrainage: plant.hasDrainage,
    });
  }
  // No reading (or already at target): the routine volume for this plant.
  return waterPlan({
    species: plant.species,
    potSize: plant.potSize,
    potMaterial: plant.potMaterial,
    potCm: plant.potCm,
    potHeightCm: plant.potHeightCm,
    potShape: plant.potShape,
    soilMix: plant.soilMix,
    soilRetention: plant.soilRetention,
    hasDrainage: plant.hasDrainage,
    tempC: env?.tempC ?? null,
    humidityPct: env?.humidityPct ?? null,
    lightAvg: env?.lightAvg ?? null,
  }).ml;
}

/* ─────────────────── CLOSED-LOOP WATERING: DOSE, OBSERVE, CORRECT ───────────────────
 *
 * Everything above this point is a MODEL. It chains the Topp curve, a leaching
 * fraction, a van Genuchten depth correction and a pot-volume estimate — and each
 * link carries real uncertainty. Published field accuracy for a low-cost
 * capacitive probe on a generic calibration is only ±6–9 points of water content,
 * and the model cannot see how root-bound the pot is, how hydrophobic the compost
 * has gone, or that this particular pot has a channel down one side.
 *
 * So rather than assert a large number and hope, the app now behaves like an
 * experiment:
 *
 *   1. DOSE — pour a deliberately modest amount, sized so the response will be
 *      clearly readable above sensor noise (about 12 display points).
 *   2. PREDICT — state, before the water goes in, how far the soil should rise.
 *      That makes the model falsifiable instead of decorative.
 *   3. OBSERVE — the next reading shows what actually happened.
 *   4. CORRECT — pouring X ml and seeing Y points IS the calibration. Two paired
 *      observations and the regression in buildHydrationModel supersedes the
 *      entire modelled chain for this pot.
 *
 * The dose is small on purpose. Three litres in one go mostly runs down the sides
 * of dry compost, which teaches nothing and looks like a thorough watering; a
 * litre that visibly moves the reading teaches everything.
 */

/**
 * Rise (display points) a trial dose aims for — enough to read clearly above
 * sensor noise, small enough not to overshoot.
 *
 * Scaled to the SPECIES, because a fixed 12 points means very different things to
 * different plants: it is half of a cactus's whole 8–25% band but a modest step
 * inside a fern's. Aiming at ~40% of the band width keeps the test proportionate
 * to how finely that plant needs to be controlled, floored so it always clears
 * noise and capped so it never becomes a soak.
 */
function trialTargetRisePts(band: [number, number]): number {
  const width = Math.max(1, band[1] - band[0]);
  return Math.min(12, Math.max(5, width * 0.4));
}
/** Below this, the full amount is already small enough to just pour. */
const TRIAL_MIN_ML = 150;
/**
 * Hard bounds on a trial dose, deliberately INDEPENDENT of the model.
 *
 * Sizing the trial purely from the model's own millilitres-per-point inherits the
 * model's error: in simulation a pot the model over-estimated by 4.5× produced a
 * 3-litre "trial", which is not a trial at all. The whole point of the first pour
 * is that we do not yet trust the estimate — so the dose is also capped at a
 * share of the pot and an absolute ceiling. Under-dosing is cheap (pour again and
 * learn twice); over-dosing drowns the plant and teaches nothing.
 */
const TRIAL_MAX_POT_FRACTION = 0.07;
/**
 * Absolute ceiling on a trial, itself scaled by pot size.
 *
 * A flat 1000 ml cap looked safe but flattened the answer: every pot above ~17 L
 * got the identical 1000 ml regardless of size or species, and for a 36 L pot
 * that is only 2.8% of the volume — too small to move the reading, so it would
 * never learn. Scaling with a hard upper bound keeps big pots learnable while
 * still refusing to instruct anyone to pour several litres in one go.
 */
const trialCeilingMl = (liters: number): number =>
  Math.min(1500, Math.max(250, TRIAL_MAX_POT_FRACTION * liters * 1000));

export interface PourStep {
  /** ml to pour right now */
  ml: number;
  /** how this number was arrived at */
  basis: 'measured' | 'trial' | 'modelled';
  /** predicted soil rise, display points — the claim the next reading tests */
  predictedRisePts: number | null;
  /** true when this is a deliberately small dose to learn from */
  isTrial: boolean;
  /** ml the full deficit would be, if poured all at once */
  fullMl: number;
  note: string;
}

/**
 * What to pour RIGHT NOW, and what it should do.
 *
 * `calibration` is this pot's own measured millilitres-per-point once two pours
 * have been logged and agree with each other. When present it replaces the model
 * outright — a measurement of the real pot beats a chain of estimates about it.
 */
export function pourStep(
  plant: {
    species: string;
    potSize: PotSize;
    potMaterial: PotMaterial;
    potCm?: number | null;
    potHeightCm?: number | null;
    potShape?: PotShape;
    soilMix?: SoilMix | null;
    soilRetention?: SoilRetention | null;
    hasDrainage?: boolean;
  },
  env: { soilPct?: number | null; targetPct?: number | null; tempC?: number | null; humidityPct?: number | null; lightAvg?: number | null },
  calibration?: { mlPerPoint: number; pairs: number; r2: number } | null,
  /**
   * The reconciled millilitres-per-point for THIS pot (lib/waterBalance). Passed
   * in rather than computed here because it needs the reading history, which this
   * function deliberately does not take. When present it supersedes both the
   * logged-pour calibration and the geometric chain below — it already contains
   * both, weighted by how much each is worth.
   */
  balance?: { mlPerPoint: number; basis: string; note: string } | null,
): PourStep {
  const fullMl = recommendedPourMl(plant, env);
  const soil = env.soilPct;
  const target = env.targetPct;

  // No live reading: nothing to measure against, so just quote the routine plan.
  if (soil == null || target == null || !Number.isFinite(soil) || !Number.isFinite(target)) {
    return { ml: fullMl, basis: 'modelled', predictedRisePts: null, isTrial: false, fullMl, note: '' };
  }

  const deficitPts = Math.max(0, target - soil);
  // Already at or above target: the honest answer is "none", not a 25 ml floor.
  if (deficitPts <= 0) {
    return { ml: 0, basis: 'modelled', predictedRisePts: 0, isTrial: false, fullMl, note: '' };
  }

  // THE POT'S OWN ANSWER, when it has given one. `balance` reconciles the
  // geometric prior with every logged pour and with the pot's observed ceiling —
  // see lib/waterBalance for why the old whole-pot chain asked a 16 L Peace lily
  // for 975 ml when 400 ml overflowed it.
  /*
   * A balance resting on MEASUREMENT answers directly. One that is still pure
   * geometry does not get to skip the trial dose.
   *
   * An earlier version returned here unconditionally, and that quietly killed
   * trial dosing: `waterAction` always supplies a balance when there is history,
   * so `isTrial` could never be true again and every uncalibrated pot was handed
   * the full modelled amount — the very amount we now know can be several times
   * out on a pot nobody has measured. The trial is also HOW a pot gets measured,
   * so removing it broke the loop that makes the rest of this work.
   */
  /*
   * `bounded` joins `modelled` on the trial side, and that is not a detail.
   *
   * A bounded estimate means every pour so far FILLED the pot, so all we know is
   * a ceiling on the millilitres-per-point — the true figure could be far lower.
   * Dosing from the bound produces another pour that overflows, which teaches
   * nothing, so the estimate never improves and the app keeps recommending a
   * flood. That is the loop a chronic over-waterer would be stuck in forever:
   * seven identical 1000 ml pours left the engine at 18.8 ml/point against a true
   * 8.2, with every future dose built on the same over-estimate.
   *
   * Routing it through the trial path breaks the loop, because a deliberately
   * small pour is the only thing that CAN come back under the ceiling and give a
   * real measurement.
   */
  if (balance && balance.basis !== 'modelled' && balance.basis !== 'bounded') {
    // Every branch of this min() must be a whole number of millilitres — the
    // pot-volume cap is a raw float, and when it won it surfaced in the UI as
    // "~43.67721905116241 ml".
    const ml = Math.round(Math.min(
      Math.max(25, Math.round((deficitPts * balance.mlPerPoint) / 25) * 25),
      MAX_SINGLE_POUR_FRACTION * potVolume(plant).liters * 1000,
      ABSOLUTE_MAX_POUR_ML,
    ));
    return {
      ml,
      basis: 'measured',
      predictedRisePts: Math.round((ml / balance.mlPerPoint) * 10) / 10,
      isTrial: false,
      fullMl,
      note: balance.note,
    };
  }

  // CALIBRATED: this pot has told us its own answer. Trust it over the model —
  // but only once the evidence is strong enough to beat the physics.
  //
  // Two pours that agree are normally plenty. The exception is a calibration that
  // contradicts the model wildly: that is either a genuinely unusual pot or two
  // noisy observations of a response too small to measure, and those look
  // identical from here. In simulation a very thirsty pot answered a 1 L trial
  // with a 3-point rise — inside sensor noise — and two such readings produced a
  // 37% error. Demanding a third pour before believing an extreme value costs one
  // watering and removes that failure.
  const modelPerPoint = (() => {
    const { liters: L } = potVolume(plant);
    return Math.max(1, waterFractionBetween(soil, soil + 1) * L * 1000);
  })();
  const extreme =
    calibration != null &&
    (calibration.mlPerPoint > modelPerPoint * 4 || calibration.mlPerPoint < modelPerPoint / 4);
  const trusted =
    calibration != null &&
    calibration.mlPerPoint > 0 &&
    calibration.r2 >= 0.6 &&
    calibration.pairs >= (extreme ? 3 : 2);
  if (trusted) {
    const measured = Math.max(25, Math.round((deficitPts * calibration.mlPerPoint) / 25) * 25);
    // The measured path may legitimately differ from the model — that is the
    // point of it — but it does NOT get to escape the physical ceiling. This
    // previously allowed `fullMl × 2`, i.e. half the pot's volume in one go, and
    // a calibration inflated by a mis-paired pour duly produced 6.2 L for a 15 L
    // pot. Cap it where every other path is capped.
    const { liters: capL } = potVolume(plant);
    const capped = Math.min(
      measured,
      MAX_SINGLE_POUR_FRACTION * capL * 1000,
      ABSOLUTE_MAX_POUR_ML,
    );
    return {
      ml: capped,
      basis: 'measured',
      predictedRisePts: Math.round((capped / calibration.mlPerPoint) * 10) / 10,
      isTrial: false,
      fullMl,
      note: `Measured on this pot: about ${Math.round(calibration.mlPerPoint)} ml lifts it one point, from ${calibration.pairs} logged waterings.`,
    };
  }

  // UNCALIBRATED. Work out what the model thinks one point costs here, and dose
  // for a readable response rather than for the whole deficit.
  const { liters } = potVolume(plant);
  // Prefer the balance's reconciled figure even when it is still modelled — it is
  // built on the responsive volume rather than the whole pot, so the trial's
  // predicted rise matches what the dose engine would say.
  const perPoint = balance ? Math.max(1, balance.mlPerPoint) : Math.max(
    1,
    waterFractionBetween(soil, soil + 1) *
      liters *
      1000 *
      wettingFor({ potMaterial: plant.potMaterial, soilMix: plant.soilMix, soilRetention: plant.soilRetention, hasDrainage: plant.hasDrainage }).mult *
      (plant.potHeightCm ? profileCorrection({ potHeightCm: plant.potHeightCm, soilMix: plant.soilMix, soilRetention: plant.soilRetention }).factor : 1),
  );
  const band = getSpecies(plant.species)?.band ?? [30, 55];
  const targetRise = trialTargetRisePts(band as [number, number]);
  const wantTrial = fullMl > TRIAL_MIN_ML && deficitPts > targetRise * 0.75;
  if (!wantTrial) {
    return {
      ml: fullMl,
      basis: 'modelled',
      predictedRisePts: Math.round((fullMl / perPoint) * 10) / 10,
      isTrial: false,
      fullMl,
      note: '',
    };
  }

  const trialRaw = Math.min(fullMl, targetRise * perPoint, trialCeilingMl(liters));
  const ml = Math.max(TRIAL_MIN_ML, Math.round(trialRaw / 25) * 25);
  return {
    ml,
    basis: 'trial',
    predictedRisePts: Math.round((ml / perPoint) * 10) / 10,
    isTrial: true,
    fullMl,
    note: `Start with ${ml} ml rather than the full ${fullMl} ml. Greenr has not watered this pot before, so this is a measured test: the next reading shows what ${ml} ml actually does here, and the amount becomes exact instead of estimated.`,
  };
}

/**
 * How much water this pot actually needs RIGHT NOW, from the measured deficit.
 *
 * `recommendedPourMl` answers "what's a normal drink for this plant" — a routine
 * volume from pot size and species. That's right when there's no sensor, but with
 * a real reading it over-waters: soil at 29 % that wants 35 % needs a top-up, not
 * a full soak, and quoting a litre for a six-point deficit is simply wrong.
 *
 * The physical amount is the water needed to lift the soil from where it is to
 * its target content:
 *
 *     ml = (θ_target − θ_now) × soil volume × wetting inefficiency
 *
 * θ is REAL water content, which is not the same thing as our display %. The
 * display scale is linear in permittivity, and water content is a concave
 * function of permittivity (Topp et al. 1980), so a display point near 30 is
 * worth about 7.8 ml per litre while the naive reading of the scale claims 10.
 * `waterFractionBetween` integrates that curve properly; assuming the scale IS
 * water content over-pours dry-to-mid soil by roughly a third.
 *
 * The inefficiency factor is the standard LEACHING FRACTION from container
 * nursery practice — the share of a pour that leaves through the drainage holes
 * without wetting the root ball. Southern Nursery Association best practice
 * targets a leaching fraction of 0.15–0.20, i.e. applied = deficit / (1 − LF).
 * Terracotta additionally wicks water into its own walls, so it gets a little
 * more.
 *
 * It is capped at a full soak, because pouring past container capacity just
 * drains away — you cannot store more than the pot can hold.
 */
export function mlToReachTarget(opts: {
  currentPct: number;
  targetPct: number;
  potSize: PotSize;
  potCm?: number | null;
  /** soil depth, cm — refines the volume when a diameter alone would mislead */
  potHeightCm?: number | null;
  potShape?: PotShape;
  potMaterial?: PotMaterial;
  /** the medium — sets how much of a pour runs straight through */
  soilMix?: SoilMix | null;
  soilRetention?: SoilRetention | null;
  /** a sealed pot cannot leach, so it must be given less */
  hasDrainage?: boolean;
}): number {
  const { currentPct, targetPct, potSize, potCm, potHeightCm, potMaterial } = opts;
  // A missing or malformed reading must not become a NaN millilitre figure on
  // screen — NaN fails every comparison, so it slips past a plain >= guard.
  if (!Number.isFinite(currentPct) || !Number.isFinite(targetPct)) return 0;
  if (currentPct >= targetPct) return 0;

  // Volume of mix: real cylinder geometry when both dimensions are known (a wide
  // shallow bowl and a narrow tall pot can share a diameter yet hold very
  // different amounts of soil), otherwise the proportion-based fallback.
  const { liters } = potVolume({ potSize, potCm, potHeightCm, potShape: opts.potShape });

  // Real water content gained, from the Topp curve — not the raw display gap.
  const rawDeficit = waterFractionBetween(currentPct, targetPct);

  // PHYSICS: the probe reads a fixed top 6.5 cm while water fills the whole
  // column, and the deep soil sits at low suction where the retention curve is
  // steepest. So the same probe movement means more stored water in a deep pot
  // than a shallow one. profileCorrection turns the van Genuchten profile into
  // that multiplier (clamped — see its docs for why the raw ratio explodes).
  const correction = potHeightCm
    ? profileCorrection({
        potHeightCm,
        soilMix: opts.soilMix,
        soilRetention: opts.soilRetention,
      }).factor
    : 1;
  const deficitFraction = rawDeficit * correction;

  // How much MORE than that must be poured: leaching through the medium, wall
  // losses in porous pots, and nothing at all when the pot cannot drain.
  const inefficiency = wettingFor({
    potMaterial,
    soilMix: opts.soilMix,
    soilRetention: opts.soilRetention,
    hasDrainage: opts.hasDrainage,
  }).mult;
  const ml = deficitFraction * liters * 1000 * inefficiency;

  // Never suggest more than a thorough soak, on either of two grounds: the pot
  // cannot hold past CONTAINER CAPACITY, and no single pour should exceed a
  // quarter of the pot's volume regardless — beyond that it runs out of the holes
  // instead of soaking in, and a bone-dry pot needs two slow passes rather than
  // one flood.
  const toCapacity = waterFractionBetween(currentPct, CONTAINER_CAPACITY_PCT) * liters * 1000 * inefficiency;
  // A pot with no holes gets a tighter ceiling: there is no way to flush an
  // overshoot back out, and standing water at the base is what actually kills
  // plants in cachepots. Published guidance caps those at a quarter of the pot;
  // this stays under it because the error is one-directional.
  const ceiling = (opts.hasDrainage === false ? 0.18 : MAX_SINGLE_POUR_FRACTION) * liters * 1000;
  // Absolute backstop. No houseplant instruction should ever read in tens of
  // litres, whatever nonsense the stored dimensions contain.
  const fullSoak = Math.min(toCapacity, ceiling, ABSOLUTE_MAX_POUR_ML);
  return Math.max(25, Math.round(Math.min(ml, fullSoak) / 25) * 25);
}
