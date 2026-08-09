import type { SoilMix, SoilRetention } from './types';

/**
 * WHERE the water is in a pot, from first principles — and therefore what a
 * probe buried to a fixed depth is actually measuring.
 *
 * The observation this explains: pushed in half way the sensor said "water me";
 * pushed to its white line the same pot said it was fine. Both readings were
 * true. They measured different parts of a pot that is genuinely, steeply wetter
 * towards the bottom.
 *
 * ─────────────────────────── THE PHYSICS ───────────────────────────
 *
 * 1. HYDROSTATIC EQUILIBRIUM. Once a watered pot stops dripping, the water left
 *    inside is held by capillary forces in balance with gravity. At equilibrium
 *    the matric potential at a height z above the pot's drainage base is simply
 *
 *        ψ(z) = −z            (z in cm, ψ in cm of water head)
 *
 *    This is the whole trick: in a container, HEIGHT IS SUCTION. Soil 10 cm up
 *    from the base is held at −10 cm of tension, and so must be drier than soil
 *    at 2 cm. No empirical fudge is needed — the depth profile falls out of
 *    hydrostatics.
 *
 * 2. THE RETENTION CURVE converts that suction into actual water content. The
 *    standard model in soil science is van Genuchten (1980), which fits
 *    horticultural substrates with R² > 0.99:
 *
 *        θ(ψ) = θr + (θs − θr) / [1 + (α·|ψ|)^n]^m,     m = 1 − 1/n
 *
 *    θs = saturated water content, θr = residual, α ≈ inverse air-entry suction
 *    (coarse media drain at low suction → large α), n = pore-size uniformity.
 *
 * 3. THE PERCHED WATER TABLE FALLS OUT OF THIS. Near z = 0 the suction is ~0, so
 *    θ ≈ θs: the base of every pot stays saturated after watering. Its height is
 *    set by α and n — i.e. by the MIX — and NOT by the pot. That is why filling
 *    cylinders of five different heights with the same compost leaves the same
 *    saturated depth in all five.
 *
 * 4. THEREFORE POT DEPTH IS DECISIVE. A saturated layer of a fixed few cm is
 *    most of a shallow bowl and a tenth of a deep pot. The same plant in the
 *    same mix is far wetter in the short one.
 *
 * 5. DRYING = LOWERING THE WATER TABLE. As roots drink and the surface
 *    evaporates, the whole profile shifts to a deeper equilibrium. That is
 *    modelled with ONE parameter: a notional water-table depth `d` below the
 *    pot's base, so ψ(z) = −(z + d). d = 0 is container capacity; d grows as the
 *    pot dries. This keeps the physics intact instead of bolting on an
 *    arbitrary decay.
 *
 * 6. THE PROBE AVERAGES ALONG ITS BLADE. A capacitive sensor does not read a
 *    point — it integrates over its buried length. So its reading is the mean of
 *    θ(z) across the band it occupies, which for this hardware is a FIXED top
 *    slice of the pot (see PROBE below).
 */

/**
 * Capacitive Soil Moisture Sensor v2.0 geometry, in cm.
 *
 * MEASURED on the physical unit: tip → white line = 6.5 cm. Because the line is
 * the maximum safe insertion (the electronics above it must stay dry), every
 * correctly-installed sensor of this model senses the SAME top 6.5 cm of soil.
 * That makes the sampled band a hardware constant, which is what lets the model
 * be exact rather than approximate: whatever the pot, the probe reports the mean
 * water content of its top 6.5 cm.
 */
export const PROBE = {
  /** tip → white line, measured: every user's probe samples this depth */
  insertCm: 6.5,
  /** the blade senses along its whole buried length */
  sensingCm: 6.5,
  /** manufacturer minimum for a meaningful reading */
  minUsefulCm: 4.0,
} as const;

/**
 * van Genuchten parameters per substrate, from the horticultural-substrate
 * literature (peat/coir/perlite/bark retention studies).
 *
 *   alpha (1/cm) — larger = coarser = drains at lower suction = LOW perched table
 *   n            — larger = more uniform pores = sharper wet→dry transition
 *   thetaS/thetaR— saturated / residual volumetric water content
 *
 * Reference points these reproduce: peat holds ~89% of saturation at 0.1 bar and
 * ~45% at 3 bar, while perlite holds ~68% and ~40% — i.e. coarse media shed water
 * far sooner, which is exactly what alpha encodes.
 */
interface VanGenuchten { alpha: number; n: number; thetaS: number; thetaR: number }

const VG: Record<SoilMix, VanGenuchten> = {
  // Grit/pumice/coarse perlite: drains almost immediately, tiny saturated layer.
  'Gritty / cactus': { alpha: 0.50, n: 3.0, thetaS: 0.72, thetaR: 0.03 },
  // Bark + perlite aroid mix: large pores, drains fast, holds air.
  'Chunky / aroid':  { alpha: 0.30, n: 2.6, thetaS: 0.80, thetaR: 0.05 },
  // Peat-based general potting compost.
  'Standard mix':    { alpha: 0.15, n: 2.2, thetaS: 0.88, thetaR: 0.08 },
  // Fine/compacted/old compost: strong capillarity, tall saturated layer.
  'Dense / heavy':   { alpha: 0.08, n: 1.9, thetaS: 0.92, thetaR: 0.12 },
};

const mixOf = (m?: SoilMix | null): SoilMix =>
  m != null && Object.prototype.hasOwnProperty.call(VG, m) ? m : 'Standard mix';

/**
 * Calibration from the owner's own observation of how long their soil stays
 * damp. It scales alpha — the air-entry parameter — because that is precisely
 * what "holds water longer" means physically: a smaller alpha needs more suction
 * before the pores give their water up. This is the one lever that turns a
 * literature-average curve into a curve for the compost actually in the pot.
 */
const RETENTION_ALPHA: Record<SoilRetention, number> = {
  'fast': 1.6,            // dries within a day or two
  'typical': 1.0,         // three to five days
  'retentive': 0.65,      // about a week
  'very-retentive': 0.45, // still damp after a week or more
};

/** Sanitised soil depth — guards NaN/negative/absent input from callers. */
const potDepth = (h: unknown): number =>
  typeof h === 'number' && Number.isFinite(h) && h > 0 ? h : 0;

/**
 * van Genuchten water content at suction `psi` (cm of water, positive number).
 * Returned as a 0–100 index to match the sensor's calibration, where 100 = free
 * water and 0 = dry air.
 */
export function waterContentAt(psiCm: number, mix: SoilMix, retention?: SoilRetention | null): number {
  // Persisted plants can carry a mix string this build no longer knows, so this
  // lookup is validated rather than trusted — an unknown value used to throw.
  const { alpha, n, thetaS, thetaR } = VG[mixOf(mix)];
  const a = alpha * (retention != null ? (RETENTION_ALPHA[retention] ?? 1) : 1);
  const m = 1 - 1 / n;
  const theta = thetaR + (thetaS - thetaR) / Math.pow(1 + Math.pow(a * Math.max(0, psiCm), n), m);
  return theta * 100;
}

/* ───────────── HOW MUCH OF THE WATER IN A POT A PLANT CAN ACTUALLY USE ─────────────
 *
 * Field-soil irrigation theory does not transfer to pots, and using it is a
 * standing error in plant apps. In a field, "field capacity" is the water held at
 * about 330 cm of tension and the wilting point is 15 000 cm; the gap between
 * them is plant-available water. A POT drains under a few centimetres of tension,
 * because the column is only as tall as the pot — so a container is already at
 * its capacity around 10 cm, and essentially all of its usable water sits between
 * 10 and 100 cm. Applying the field numbers to a pot claims a reservoir that is
 * not there.
 *
 * The container literature (De Boodt & Verdonck 1972, still the standard for
 * growing media) partitions it at fixed tensions:
 *
 *   CONTAINER CAPACITY     θ at  10 cm  (1 kPa)  — a pot that has finished draining
 *   EASILY AVAILABLE WATER θ(10) − θ(50)         — taken up with no effort at all
 *   BUFFERING WATER        θ(50) − θ(100)        — the reserve, taken with effort
 *   TOTAL AVAILABLE WATER  θ(10) − θ(100)
 *
 * and their proposed optimum for a good mix is 20–30% air space, 20–30% easily
 * available water, and 4–10% buffering water.
 *
 * WHY THIS IS THE RIGHT PLACE TO SET THE WATERING THRESHOLD. Greenhouse practice
 * puts the working range at 1–5 kPa and irrigates at about 5 kPa; past 10 kPa a
 * moisture-loving plant starts to wilt. In other words the moment to water is
 * when the EASILY AVAILABLE WATER runs out — not when the pot is dry, and not on
 * a calendar. That is a physical event this app can actually detect, because the
 * probe reading inverts to a tension through the same retention curve.
 *
 * Everything here is derived from the van Genuchten parameters already fitted per
 * mix above, so it costs no new assumptions — it is the same curve, read at the
 * tensions the horticultural literature cares about.
 */

/** The tensions (cm of water) that partition a container's water. */
export const TENSION = {
  /** a pot that has finished draining */
  containerCapacity: 10,
  /** easily available water is exhausted here — the moment to water */
  easilyAvailable: 50,
  /** the buffer is gone too; past this most plants wilt */
  wilting: 100,
} as const;

export interface SubstrateWater {
  /** θ at container capacity, as a 0–100 index on the sensor's scale */
  capacity: number;
  /** the reading at which easily-available water runs out — the watering trigger */
  refillAt: number;
  /** the reading at which the buffer is gone as well */
  stressAt: number;
  /** easily available water, in points of the 0–100 scale */
  easilyAvailable: number;
  /** buffering water, in points */
  buffering: number;
  /** total available water, in points */
  totalAvailable: number;
  /** how this mix compares with the De Boodt optimum (20–30% EAW, 4–10% WBC) */
  verdict: 'free-draining' | 'ideal' | 'retentive';
  note: string;
}

/**
 * The usable water in this mix, as the SENSOR will see it.
 *
 * Returned on the probe's own 0–100 scale rather than as volumetric water
 * content, because every threshold in the app is compared against a reading.
 */
export function substrateWater(mix: SoilMix, retention?: SoilRetention | null): SubstrateWater {
  const capacity = waterContentAt(TENSION.containerCapacity, mix, retention);
  const refillAt = waterContentAt(TENSION.easilyAvailable, mix, retention);
  const stressAt = waterContentAt(TENSION.wilting, mix, retention);
  const easilyAvailable = Math.max(0, capacity - refillAt);
  const buffering = Math.max(0, refillAt - stressAt);
  const verdict =
    easilyAvailable < 20 ? 'free-draining' : easilyAvailable > 30 ? 'retentive' : 'ideal';
  return {
    capacity,
    refillAt,
    stressAt,
    easilyAvailable,
    buffering,
    totalAvailable: Math.max(0, capacity - stressAt),
    verdict,
    note:
      verdict === 'free-draining'
        ? `This mix holds only about ${easilyAvailable.toFixed(0)} points of easily-available water, below the 20–30 that growing-media research treats as ideal. It will need watering little and often.`
        : verdict === 'retentive'
          ? `This mix holds about ${easilyAvailable.toFixed(0)} points of easily-available water, above the 20–30 ideal — generous, but it stays wet a long time, so err on the side of less.`
          : `This mix holds about ${easilyAvailable.toFixed(0)} points of easily-available water, right in the 20–30 range growing-media research calls ideal.`,
  };
}

export interface PotGeometry {
  /** depth of soil in the pot, cm (surface → base) */
  potHeightCm: number;
  soilMix?: SoilMix | null;
  /** the owner's own observation of how long this compost stays damp */
  soilRetention?: SoilRetention | null;
  /** how far the probe is buried; defaults to the hardware constant 6.5 cm */
  probeDepthCm?: number | null;
}

/**
 * Water content (0–100) at height `z` cm above the base of the pot.
 * `waterTableDepthCm` is how far the equilibrium water surface has fallen BELOW
 * the pot base as the soil dried: 0 = just drained, larger = drier.
 */
export function moistureAtHeight(z: number, geo: PotGeometry, waterTableDepthCm = 0): number {
  const mix = mixOf(geo.soilMix);
  // Height above the water surface IS the suction, in cm of water.
  return waterContentAt(Math.max(0, z) + Math.max(0, waterTableDepthCm), mix, geo.soilRetention);
}

/**
 * Height of the saturated layer — where air first enters the pores, taken as the
 * point water content falls below 90 % of saturation. It EMERGES from the
 * retention curve rather than being hard-coded, and lands where the horticultural
 * literature puts it (~1 cm for grit, ~3.5 cm for peat-based compost).
 */
export function perchedWaterTableCm(mix: SoilMix, retention?: SoilRetention | null): number {
  const sat = waterContentAt(0, mix, retention);
  for (let z = 0; z <= 40; z += 0.1) {
    if (waterContentAt(z, mix, retention) < sat * 0.9) return z;
  }
  return 40;
}

/**
 * What the probe reads: the mean water content over the soil it occupies, plus
 * any part of the blade sticking out into the air (which reads as 0 and is what
 * makes a shallow install look so dramatically dry).
 */
export function probeReads(geo: PotGeometry, waterTableDepthCm = 0): number {
  if (!Number.isFinite(waterTableDepthCm)) return 0;
  const potH = potDepth(geo.potHeightCm);
  // SHALLOW POTS (< 6.5 cm — bonsai trays, seed pans, shallow succulent bowls):
  // the blade bottoms out before the line, so the remainder stands in air. Air
  // has a far lower permittivity than wet soil, so it drags the capacitive
  // reading down in proportion to the exposed length. Two effects then fight
  // each other: a shallow pot is proportionally WETTER (the saturated layer is
  // a bigger share of it) but its reading is DILUTED by the exposed blade. Both
  // are modelled, so a 4 cm pan doesn't masquerade as a bone-dry deep pot.
  const depth = Math.max(0, Math.min(geo.probeDepthCm ?? PROBE.insertCm, potH));
  const buried = Math.min(depth, PROBE.sensingCm);
  const inAir = Math.max(0, PROBE.sensingCm - buried);
  if (buried <= 0) return 0;

  const STEPS = 60;
  let sum = 0;
  for (let i = 0; i < STEPS; i++) {
    const depthFromTop = ((i + 0.5) / STEPS) * buried;
    sum += moistureAtHeight(geo.potHeightCm - depthFromTop, geo, waterTableDepthCm);
  }
  return (sum / STEPS) * (buried / (buried + inAir));
}

/**
 * Invert the model: given what the probe reported, how far has the equilibrium
 * water table fallen? This is the pot's true dryness state, independent of pot
 * size — the quantity that actually predicts when watering is due.
 */
export function inferWaterTableDepth(readingPct: number, geo: PotGeometry): number {
  if (!Number.isFinite(readingPct)) return 0;
  // A reading ABOVE the just-drained equilibrium means the pot is still draining
  // — genuinely wetter than container capacity, which is a transient state, not
  // a water-table depth. Report 0 (fully charged); soilDynamics owns the
  // "draining" case separately.
  if (readingPct >= probeReads(geo, 0)) return 0;
  let lo = 0;
  // Upper bound = 15 000 cm suction, the permanent wilting point (15 bar). Below
  // that the curve is asymptotic to the residual water content θr, so readings
  // at θr are unreachable by design — the soil simply cannot get drier.
  let hi = 15000;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (probeReads(geo, mid) > readingPct) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Moisture the ROOTS actually sit in — the mean over the root zone, which is
 * deeper and therefore wetter than the top 6.5 cm the probe can reach. The gap
 * widens with pot depth, which is why a tall pot can read "dry" at the probe
 * while the roots are still comfortable.
 */
export function rootZoneMoisture(geo: PotGeometry, waterTableDepthCm = 0, rootFraction = 0.75): number {
  const potH = potDepth(geo.potHeightCm);
  if (potH <= 0) return 0; // no soil, nothing to report
  const top = potH * (1 - rootFraction);
  const STEPS = 60;
  let sum = 0;
  for (let i = 0; i < STEPS; i++) {
    sum += moistureAtHeight(top + ((i + 0.5) / STEPS) * (potH - top), geo, waterTableDepthCm);
  }
  return sum / STEPS;
}

/** How much wetter the root zone is than the probe suggests, in points. */
export function rootZoneOffset(geo: PotGeometry, waterTableDepthCm = 0): number {
  return rootZoneMoisture(geo, waterTableDepthCm) - probeReads(geo, waterTableDepthCm);
}

/**
 * Translate a probe reading into what the roots are experiencing — the number
 * watering decisions should actually use. Works by inferring the pot's dryness
 * state from the reading, then evaluating the profile across the root zone.
 */
export function rootZoneFromReading(readingPct: number, geo: PotGeometry): {
  rootZonePct: number;
  waterTableDepthCm: number;
  offset: number;
} {
  const d = inferWaterTableDepth(readingPct, geo);
  const rz = rootZoneMoisture(geo, d);
  return { rootZonePct: rz, waterTableDepthCm: d, offset: rz - readingPct };
}

/** Explanatory bands for the UI: what each layer of this pot holds right now. */
export function profileBands(
  geo: PotGeometry,
  waterTableDepthCm = 0,
): { label: string; pct: number }[] {
  const mix = mixOf(geo.soilMix);
  const pwt = perchedWaterTableCm(mix);
  const probeDepth = geo.probeDepthCm ?? PROBE.insertCm;
  return [
    { label: 'Surface', pct: moistureAtHeight(geo.potHeightCm, geo, waterTableDepthCm) },
    { label: `Probe zone (top ${probeDepth} cm)`, pct: probeReads(geo, waterTableDepthCm) },
    { label: 'Mid root zone', pct: moistureAtHeight(geo.potHeightCm * 0.45, geo, waterTableDepthCm) },
    { label: `Saturated layer (${pwt.toFixed(1)} cm)`, pct: moistureAtHeight(pwt / 2, geo, waterTableDepthCm) },
  ];
}


export interface ContainerThresholds {
  /** what the probe reads when this pot has just finished draining */
  capacityReading: number;
  /** what it reads when the roots have used up the easily-available water */
  refillReading: number;
  /** what it reads when the buffer is gone too */
  stressReading: number;
  /** the span between capacity and refill, in reading points — the working range */
  workingPoints: number;
  /** the probe cannot resolve this pot/mix well enough for the thresholds to mean much */
  unreliable: boolean;
}

/**
 * The container-water tensions, translated into READINGS for a specific pot.
 *
 * `substrateWater` gives the water contents at 10, 50 and 100 cm of tension, but
 * those are values at a POINT, and the probe does not measure a point — it
 * averages θ over the top 6.5 cm of a profile that is wetter with depth. Comparing
 * a depth-averaged reading against a point threshold is a units error, and it
 * would put the "water me" line in the wrong place by a wide margin in deep pots.
 *
 * So the thresholds are converted properly: for each water-table depth the model
 * knows both what the ROOT ZONE holds and what the PROBE would report, so we
 * find the depth at which the root zone reaches each tension and read off the
 * probe value that goes with it. The answer is what the sensor will actually show
 * when the roots are at that tension, for this pot's depth and mix.
 */
export function containerThresholds(geo: PotGeometry): ContainerThresholds {
  const mix = mixOf(geo.soilMix);
  const targets = [
    waterContentAt(TENSION.containerCapacity, mix, geo.soilRetention),
    waterContentAt(TENSION.easilyAvailable, mix, geo.soilRetention),
    waterContentAt(TENSION.wilting, mix, geo.soilRetention),
  ];

  // Root-zone water content falls monotonically as the water table drops, so a
  // binary search over depth inverts it exactly.
  const readingWhereRootZoneIs = (theta: number): number => {
    let lo = 0;
    let hi = 15000;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (rootZoneMoisture(geo, mid) > theta) lo = mid;
      else hi = mid;
    }
    return probeReads(geo, (lo + hi) / 2);
  };

  const capacityReading = probeReads(geo, 0);
  const refillReading = readingWhereRootZoneIs(targets[1]);
  const stressReading = readingWhereRootZoneIs(targets[2]);
  const workingPoints = Math.max(0, capacityReading - refillReading);

  return {
    capacityReading,
    refillReading,
    stressReading,
    workingPoints,
    // Below a few points of travel the probe simply cannot tell "watered" from
    // "needs water" in this pot — the same limitation `profileCorrection` reports
    // as `probeBlind`, stated here in the units the thresholds are used in.
    unreliable: workingPoints < 4,
  };
}

export interface ProbeFit {
  /** how much of the blade is actually in soil, cm */
  buriedCm: number;
  /** how much stands in the air above the soil, cm */
  exposedCm: number;
  /** true when the pot is too shallow to bury the blade to its line */
  potTooShallow: boolean;
  /** the factor by which the exposed blade drags the reading down */
  dilution: number;
  note: string;
}

/**
 * How the probe physically fits THIS pot. Matters for the rare-but-real case of
 * a pot shallower than the blade: the reading is then diluted by the exposed
 * section and can never reach the values a deep pot produces, so it must be
 * interpreted on its own terms rather than called "dry".
 */
export function probeFit(geo: PotGeometry): ProbeFit {
  const potH = potDepth(geo.potHeightCm);
  const buried = Math.max(0, Math.min(geo.probeDepthCm ?? PROBE.insertCm, potH, PROBE.sensingCm));
  const exposed = Math.max(0, PROBE.sensingCm - buried);
  const dilution = buried / PROBE.sensingCm;
  const tooShallow = potH < PROBE.sensingCm;
  return {
    buriedCm: buried,
    exposedCm: exposed,
    potTooShallow: tooShallow,
    dilution,
    note: tooShallow
      ? `This pot is only ${potH} cm deep, so the probe bottoms out with about ${exposed.toFixed(1)} cm of blade still in the air. That exposed section pulls the reading down by roughly ${Math.round((1 - dilution) * 100)}%, so treat its numbers as relative to this pot — Greenr already corrects for it. Lay the probe at a slight angle if you can, to bury more of the blade.`
      : '',
  };
}

/* ─────────────────── DISPLAY SCALE → ACTUAL WATER CONTENT ───────────────────
 *
 * A correction that matters whenever we convert a moisture GAP into millilitres.
 *
 * The probe is calibrated air = 0, water = 100, and that scale is very nearly
 * linear in the medium's DIELECTRIC PERMITTIVITY (ε ≈ 1 in air, ≈ 80 in water) —
 * because a capacitive probe measures capacitance, and capacitance tracks ε.
 *
 * But water content is NOT linear in permittivity. The standard conversion is
 * Topp et al. (1980), which holds across most substrates:
 *
 *     θ = −5.3e-2 + 2.92e-2·Ka − 5.5e-4·Ka² + 4.3e-6·Ka³
 *
 * It is markedly concave, so a display point is worth much more water when the
 * soil is dry than when it is wet:
 *
 *     display 10 → ~16 ml per point per litre
 *     display 30 → ~7.8
 *     display 50 → ~4.6
 *
 * Treating the display scale AS water content (the "10 ml per point per litre"
 * shortcut) therefore over-waters dry-to-mid soil by roughly a third. Reading the
 * curve's local slope instead is both cheaper and more accurate.
 *
 * HONESTY ABOUT THE LIMITS. Topp was derived for mineral soils; potting mixes are
 * organic and far more porous, and the published field accuracy of low-cost
 * capacitive probes on a generic calibration is only ±6–9 points of water content
 * (Sensors 2025; soil-specific calibration is dramatically better). So this is a
 * good PRIOR, not a measurement — which is exactly why `buildHydrationModel`
 * overrides it with the pot's own observed ml-per-point as soon as two pours have
 * been logged. Physics until there is evidence; evidence thereafter.
 */

/** Bulk permittivity implied by a display reading (air = 1, water = 80). */
function permittivityFromDisplay(displayPct: number): number {
  const p = Math.min(100, Math.max(0, displayPct));
  return 1 + (p / 100) * 79;
}

/** Volumetric water content (%) for a display reading, via Topp et al. (1980). */
export function waterContentFromDisplay(displayPct: number): number {
  if (!Number.isFinite(displayPct)) return 0;
  const Ka = permittivityFromDisplay(displayPct);
  const theta = -5.3e-2 + 2.92e-2 * Ka - 5.5e-4 * Ka * Ka + 4.3e-6 * Ka * Ka * Ka;
  return Math.max(0, Math.min(100, theta * 100));
}

/* The Topp curve gives the right SHAPE but the wrong MAGNITUDE for potting mix.
 * Taken literally it says rehydrating a dry pot to container capacity needs 45%
 * of the pot's volume in water, where practical horticulture puts a thorough
 * watering at 25–30% (and a routine one nearer 10%). That gap is expected: Topp
 * was fitted to mineral soils, and not all of a pot's pore space is refilled by
 * one pour.
 *
 * So the curve is ANCHORED to the horticultural figure — shape from physics,
 * magnitude from practice. Without this the estimate over-poured by ~1.7×, which
 * is how a modest 16→30 top-up turned into a two-litre instruction.
 */
/** Display reading of a pot that needs water. */
const DRY_DISPLAY = 10;
/** Display reading of a pot at container capacity. */
const CAPACITY_DISPLAY = 70;
/** Thorough watering ≈ this share of pot volume (literature: 0.25–0.30). */
const SOAK_FRACTION_OF_POT = 0.27;

const rawFraction = (fromPct: number, toPct: number): number => {
  // A missing or malformed reading must yield "no water needed", never NaN.
  if (!Number.isFinite(fromPct) || !Number.isFinite(toPct)) return 0;
  return Math.max(0, (waterContentFromDisplay(toPct) - waterContentFromDisplay(fromPct)) / 100);
};

/** Scales the Topp curve so a full rehydration matches the horticultural soak. */
const TOPP_TO_POT = SOAK_FRACTION_OF_POT / rawFraction(DRY_DISPLAY, CAPACITY_DISPLAY);

/**
 * Real water needed to move the display from `fromPct` to `toPct`, as a fraction
 * of the soil's bulk volume — the honest version of "the deficit". It follows the
 * Topp curve between the two points (so a point is worth more when dry) and is
 * calibrated so a full dry→capacity soak comes to ~27% of the pot.
 */
export function waterFractionBetween(fromPct: number, toPct: number): number {
  return rawFraction(fromPct, toPct) * TOPP_TO_POT;
}

/**
 * The most water it is sensible to pour in ONE go, as a fraction of pot volume.
 * Past this it runs straight out of the holes; a genuinely bone-dry pot wants two
 * slow passes (or a bottom-soak), not one flood.
 */
export const MAX_SINGLE_POUR_FRACTION = 0.25;

/**
 * Millilitres that raise ONE litre of mix by ONE display point, at the moisture
 * level where the soil currently sits. Used as the generic prior for the
 * hydration model; superseded by measured pours.
 */
export function mlPerPointPerLiter(atDisplayPct: number): number {
  return Math.max(1, waterFractionBetween(atDisplayPct - 0.5, atDisplayPct + 0.5) * 1000);
}

/* ───────────── POT DEPTH: WHAT THE PROBE SEES vs WHAT THE POT HOLDS ─────────────
 *
 * The probe reads a FIXED top 6.5 cm, but water fills the whole column. Because
 * height above the base is suction, the deep soil sits at low suction where the
 * retention curve is steepest — so when a pot dries, the lower soil gives up far
 * more water than the top does. A point of probe movement therefore means more
 * stored water in a deep pot than in a shallow one, and the deficit measured at
 * the probe under-states a deep pot's real need.
 *
 * `profileFactor` is that correction: the whole-column water change per unit of
 * probe change, from the van Genuchten profile, normalised so a 16 cm pot (the
 * app's reference depth) is exactly 1.0. Shallow pots come out below 1, deep pots
 * above — and the pot-volume term stays responsible for sheer size, so the two do
 * not double-count.
 *
 * WHY IT IS CLAMPED. Taken literally the ratio explodes — a 30 cm gritty pot
 * computes 61×. That is not physics, it is division by almost zero: in a deep
 * coarse pot the top 6.5 cm sits at 3.3% water against a residual of 3.0%, so the
 * probe is pinned at the dry end of its curve and cannot resolve change at all.
 * The correct reading of that number is "this probe cannot see this pot", not
 * "this pot needs sixty times the water". So the factor is clamped to a range the
 * measurement can actually support, and `probeBlind` reports the real limitation
 * instead of dressing it up as precision.
 */
const REFERENCE_DEPTH_CM = 16;
const FACTOR_MIN = 0.8;
const FACTOR_MAX = 1.5;

/** Mean water content across the whole soil column at water-table depth `d`. */
function columnMean(geo: PotGeometry, d: number): number {
  const potH = potDepth(geo.potHeightCm);
  if (potH <= 0) return 0;
  const STEPS = 120;
  let sum = 0;
  for (let i = 0; i < STEPS; i++) sum += moistureAtHeight(((i + 0.5) / STEPS) * potH, geo, d);
  return sum / STEPS;
}

/** Unnormalised whole-column change per unit of probe change, averaged over drying. */
function rawProfileFactor(geo: PotGeometry): number {
  let num = 0;
  let den = 0;
  for (let d = 0.5; d <= 12; d += 0.5) {
    const dCol = columnMean(geo, d - 0.25) - columnMean(geo, d + 0.25);
    const dProbe = probeReads(geo, d - 0.25) - probeReads(geo, d + 0.25);
    if (dProbe > 0.01) {
      num += dCol;
      den += dProbe;
    }
  }
  return den > 0 ? num / den : 1;
}

export interface ProfileCorrection {
  /** clamped multiplier on a probe-measured deficit */
  factor: number;
  /** what the physics said before clamping — diagnostic, not for arithmetic */
  raw: number;
  /** the probe cannot resolve moisture in this pot/mix combination */
  probeBlind: boolean;
  note: string;
}

/**
 * Depth/medium correction for a deficit measured at the probe. Returns the
 * clamped factor plus an honest account of how far the physics was trimmed.
 */
/**
 * Memoised: the correction integrates the retention curve over ~24 water-table
 * depths twice, which measured at ~1.7 ms per call. It is called for every plant
 * on every render (Home iterates the whole garden), so uncached it cost tens of
 * milliseconds a frame. Inputs are a tiny discrete set, so caching is exact.
 */
const correctionCache = new Map<string, ProfileCorrection>();

export function profileCorrection(geo: PotGeometry): ProfileCorrection {
  const potH = potDepth(geo.potHeightCm);
  if (potH <= 0) return { factor: 1, raw: 1, probeBlind: false, note: '' };
  const key = `${potH.toFixed(2)}|${geo.soilMix ?? ''}|${geo.soilRetention ?? ''}|${geo.probeDepthCm ?? ''}`;
  const hit = correctionCache.get(key);
  if (hit) return hit;

  const mix = mixOf(geo.soilMix);
  const ref = rawProfileFactor({ ...geo, potHeightCm: REFERENCE_DEPTH_CM });
  const raw = ref > 0 ? rawProfileFactor(geo) / ref : 1;

  // Is the probe zone pinned at the dry end, where it cannot resolve change?
  const residual = waterContentAt(1e5, mix, geo.soilRetention);
  const atProbe = probeReads(geo, 2);
  const probeBlind = atProbe - residual < 1.5;

  const factor = probeBlind ? 1 : Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, raw));
  let note = '';
  if (probeBlind) {
    note = `This pot is deep for a free-draining mix, so the top ${PROBE.insertCm} cm the probe reads stays dry even when there is water lower down. Amounts here lean on pot size rather than the reading — water by weight or by lifting the pot if you can.`;
  } else if (factor > 1.05) {
    note = `Deep pot: the roots below the probe hold water the probe cannot see, so the amount is scaled up ${Math.round((factor - 1) * 100)}%.`;
  } else if (factor < 0.95) {
    note = `Shallow pot: the probe reads most of the soil there is, so it needs ${Math.round((1 - factor) * 100)}% less than a standard pot would.`;
  }
  const result = { factor, raw, probeBlind, note };
  if (correctionCache.size < 500) correctionCache.set(key, result);
  return result;
}
