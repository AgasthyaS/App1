import { potVolume } from './watering';
import {
  TENSION,
  waterContentAt,
  waterContentFromDisplay,
  waterFractionBetween,
  containerThresholds,
  inferWaterTableDepth,
  probeReads,
  mlPerPointPerLiter,
} from './soilProfile';
import { REFERENCE_VPD_KPA, saturationVaporPressureKpa, vpdIntervalFactor, vpdKpa } from './vpd';

/**
 * THE MATHS, CHECKING ITSELF.
 *
 * Every number this app puts in front of someone comes out of a chain of
 * physics: a retention curve, a vapour-pressure equation, a volume, three unit
 * conversions. Any one of them can be quietly wrong — a transposed coefficient,
 * a centimetre read as a metre, an inverse that does not invert — and the result
 * still looks like a plausible number of millilitres. That is the failure mode
 * that matters here, because nothing about "water with 340 ml" announces that
 * the exponent was wrong.
 *
 * So the formulas are checked against values that do not come from this codebase.
 *
 * ─────────────────────────── WHAT MAKES THIS TRUSTWORTHY ─────────────────────
 *
 * Two kinds of check, and the distinction is the whole point:
 *
 *   REFERENCE CHECKS compare a function against a number published elsewhere —
 *   saturation vapour pressure at 20 °C is 2.3388 kPa in every physics table
 *   ever printed, and if `saturationVaporPressureKpa(20)` disagrees, this code is
 *   wrong and the table is not. These catch transcription errors, which are the
 *   ones that survive review because the code reads correctly.
 *
 *   PROPERTY CHECKS assert relationships that must hold for ANY input: water
 *   content falls as suction rises, never the reverse; a pot cannot need
 *   negative water; an inverse must round-trip; doubling a pot's radius must
 *   quadruple its volume. These catch the errors reference points miss, because
 *   a wrong formula can still pass through one correct value.
 *
 * None of it involves a model, a judgement, or a network call. It is arithmetic
 * compared with arithmetic, so it produces the same verdict on every device,
 * every run, forever — which is exactly what "the math cannot be wrong" has to
 * mean if it is to mean anything. A language model can be asked whether a
 * formula looks right; it cannot be relied on to notice that the fourth
 * significant figure moved. This can.
 *
 * ────────────────────────────── HOW IT IS USED ───────────────────────────────
 *
 * `runFormulaChecks()` is pure and fast enough to run on a screen. It is wired
 * into the methodology page so the workings are auditable by the person relying
 * on them — and by anyone they show it to. It also runs in the test harness,
 * where a failure is a build failure.
 */

export type CheckKind = 'reference' | 'property';

export interface FormulaCheck {
  id: string;
  /** the formula under test, by the name it has in the literature */
  formula: string;
  /** where the expected value comes from — never this codebase */
  source: string;
  kind: CheckKind;
  passed: boolean;
  /** human-readable statement of what was asserted */
  statement: string;
  /** the observed value, when the check compares numbers */
  got?: number;
  expected?: number;
  /** allowed relative difference, as a fraction */
  tolerance?: number;
}

export interface FormulaReport {
  checks: FormulaCheck[];
  passed: number;
  failed: number;
  /** true when every single check passed */
  sound: boolean;
  /** the failures, most fundamental first */
  failures: FormulaCheck[];
}

/* ───────────────────────────── the assertion kit ───────────────────────────── */

const near = (got: number, expected: number, tol: number): boolean =>
  Number.isFinite(got) && Number.isFinite(expected) &&
  Math.abs(got - expected) <= Math.abs(expected) * tol + 1e-12;

/** A value from a published table. Fails on any discrepancy beyond `tolerance`. */
function ref(
  out: FormulaCheck[],
  id: string,
  formula: string,
  source: string,
  statement: string,
  got: number,
  expected: number,
  tolerance: number,
): void {
  out.push({
    id, formula, source, kind: 'reference', statement, got, expected, tolerance,
    passed: near(got, expected, tolerance),
  });
}

/** A relationship that must hold for every input, not just the ones tried. */
function prop(
  out: FormulaCheck[],
  id: string,
  formula: string,
  source: string,
  statement: string,
  holds: boolean,
): void {
  out.push({ id, formula, source, kind: 'property', statement, passed: !!holds });
}

/* ────────────────────────────────── the checks ─────────────────────────────── */

/**
 * Run every check. Pure, synchronous, deterministic — same answer on every
 * device and every run.
 */
export function runFormulaChecks(): FormulaReport {
  const c: FormulaCheck[] = [];

  /* ── 1. TETENS (1930): saturation vapour pressure ──────────────────────────
   *
   * The anchor of the whole demand model: every drying rate is normalised by
   * VPD, and VPD is this function minus what the air already holds. Published
   * saturation pressures are among the best-measured quantities in physics, so
   * a tight tolerance is fair — 0.5% here is loose enough for Tetens' own
   * approximation error and tight enough to catch a wrong coefficient.
   */
  const TETENS = 'SVP(T) = 0.61078 · exp(17.27·T / (T + 237.3))';
  const TETENS_SRC = 'Tetens (1930); values cross-checked against standard steam tables';
  ref(c, 'svp-0', TETENS, TETENS_SRC, 'Saturation vapour pressure at 0 °C is 0.6112 kPa',
    saturationVaporPressureKpa(0), 0.6112, 0.005);
  ref(c, 'svp-10', TETENS, TETENS_SRC, 'Saturation vapour pressure at 10 °C is 1.2281 kPa',
    saturationVaporPressureKpa(10), 1.2281, 0.005);
  ref(c, 'svp-20', TETENS, TETENS_SRC, 'Saturation vapour pressure at 20 °C is 2.3388 kPa',
    saturationVaporPressureKpa(20), 2.3388, 0.005);
  ref(c, 'svp-25', TETENS, TETENS_SRC, 'Saturation vapour pressure at 25 °C is 3.1690 kPa',
    saturationVaporPressureKpa(25), 3.1690, 0.005);
  ref(c, 'svp-30', TETENS, TETENS_SRC, 'Saturation vapour pressure at 30 °C is 4.2455 kPa',
    saturationVaporPressureKpa(30), 4.2455, 0.005);
  prop(c, 'svp-monotone', TETENS, 'Clausius–Clapeyron: warmer air holds more vapour',
    'Saturation pressure rises with every degree, with no exceptions',
    Array.from({ length: 60 }, (_, i) => i).every(
      (t) => saturationVaporPressureKpa(t + 1) > saturationVaporPressureKpa(t)));

  /* ── 2. VAPOUR PRESSURE DEFICIT ──────────────────────────────────────────── */
  const VPD = 'VPD = SVP(T) · (1 − RH/100)';
  const VPD_SRC = 'Standard glasshouse definition (Allen et al., FAO-56)';
  ref(c, 'vpd-22-60', VPD, VPD_SRC, 'At 22 °C and 60% RH the deficit is 1.06 kPa',
    vpdKpa(22, 60) ?? NaN, 1.06, 0.02);
  ref(c, 'vpd-28-60', VPD, VPD_SRC, 'At 28 °C and 60% RH the deficit is 1.51 kPa',
    vpdKpa(28, 60) ?? NaN, 1.51, 0.02);
  prop(c, 'vpd-saturated', VPD, VPD_SRC,
    'Saturated air has zero deficit at every temperature',
    [0, 10, 20, 30, 40].every((t) => (vpdKpa(t, 100) ?? -1) === 0));
  prop(c, 'vpd-dry-equals-svp', VPD, VPD_SRC,
    'Perfectly dry air has a deficit equal to the full saturation pressure',
    [5, 15, 25, 35].every((t) => near(vpdKpa(t, 0) ?? NaN, saturationVaporPressureKpa(t), 1e-9)));
  prop(c, 'vpd-monotone-rh', VPD, VPD_SRC,
    'Deficit falls as humidity rises, at fixed temperature',
    Array.from({ length: 99 }, (_, i) => i).every(
      (rh) => (vpdKpa(22, rh) ?? 0) > (vpdKpa(22, rh + 1) ?? 0)));
  prop(c, 'vpd-reference-consistent', VPD, VPD_SRC,
    'The reference VPD the drying model is calibrated at really is 22 °C / 55% RH',
    near(vpdKpa(22, 55) ?? NaN, REFERENCE_VPD_KPA, 0.02));
  prop(c, 'vpd-factor-neutral', 'interval ∝ 1/VPD', VPD_SRC,
    'Air at the reference deficit leaves the watering interval unchanged',
    near(vpdIntervalFactor(REFERENCE_VPD_KPA), 1, 1e-9));
  prop(c, 'vpd-factor-direction', 'interval ∝ 1/VPD', VPD_SRC,
    'Drier air shortens the interval and damper air lengthens it',
    vpdIntervalFactor(2.4) < 1 && vpdIntervalFactor(0.6) > 1);

  /* ── 3. VAN GENUCHTEN (1980): the retention curve ──────────────────────────
   *
   * θ(ψ) = θr + (θs − θr) / [1 + (α|ψ|)ⁿ]^m,  m = 1 − 1/n
   *
   * There is no universal table to compare against — the parameters are fitted
   * per medium — so this is checked on the properties the equation must satisfy
   * whatever the parameters are. Those are strong: they pin the curve at both
   * ends and forbid every shape it must not have.
   */
  const VG = 'θ(ψ) = θr + (θs − θr) / [1 + (α|ψ|)ⁿ]^(1−1/n)';
  const VG_SRC = 'van Genuchten (1980), Soil Sci. Soc. Am. J. 44:892';
  const MIXES = ['Standard mix', 'Gritty / cactus', 'Chunky / aroid', 'Dense / heavy'] as const;
  prop(c, 'vg-saturation', VG, VG_SRC,
    'At zero suction every mix sits at its saturated water content',
    MIXES.every((m) => waterContentAt(0, m) > 60 && waterContentAt(0, m) <= 100));
  prop(c, 'vg-monotone', VG, VG_SRC,
    'Water content falls as suction rises — for every mix, at every step',
    MIXES.every((m) =>
      Array.from({ length: 200 }, (_, i) => i * 5).every(
        (psi) => waterContentAt(psi + 5, m) <= waterContentAt(psi, m) + 1e-9)));
  prop(c, 'vg-residual', VG, VG_SRC,
    'At extreme suction each mix approaches a positive residual, never zero or below',
    MIXES.every((m) => {
      const dry = waterContentAt(100000, m);
      return dry > 0 && dry < waterContentAt(0, m);
    }));
  prop(c, 'vg-ordering', VG, VG_SRC,
    'A gritty mix holds less water at container capacity than a dense one',
    waterContentAt(TENSION.containerCapacity, 'Gritty / cactus')
      < waterContentAt(TENSION.containerCapacity, 'Dense / heavy'));
  prop(c, 'vg-retention-lever', VG, VG_SRC,
    'Calling a compost more retentive raises what it holds at every tension',
    waterContentAt(TENSION.easilyAvailable, 'Standard mix', 'very-retentive')
      > waterContentAt(TENSION.easilyAvailable, 'Standard mix', 'fast'));

  /* ── 4. DE BOODT & VERDONCK (1972): container water partitioning ─────────── */
  const DB = 'CC = θ(10 cm) · EAW = θ(10) − θ(50) · WBC = θ(50) − θ(100)';
  const DB_SRC = 'De Boodt & Verdonck (1972), Acta Hortic. 26:37 — still the growing-media standard';
  prop(c, 'deboodt-tensions', DB, DB_SRC,
    'The partition tensions are 10, 50 and 100 cm of water, in that order',
    TENSION.containerCapacity === 10 && TENSION.easilyAvailable === 50 && TENSION.wilting === 100);
  prop(c, 'deboodt-ordering', DB, DB_SRC,
    'Container capacity exceeds the refill point, which exceeds the stress point',
    MIXES.every((m) =>
      waterContentAt(10, m) > waterContentAt(50, m) && waterContentAt(50, m) > waterContentAt(100, m)));
  prop(c, 'deboodt-not-field', DB, DB_SRC,
    'A pot is treated as draining at a few centimetres, not at the 330 cm of field capacity',
    TENSION.containerCapacity < 50);

  /* ── 5. TOPP et al. (1980): permittivity → water content ───────────────────
   *
   * θ = −5.3e-2 + 2.92e-2·ε − 5.5e-4·ε² + 4.3e-6·ε³
   *
   * The classic dielectric calibration. Checked at the two ends where the answer
   * is known independently: pure water has a relative permittivity near 80 and
   * must come out near 100% water, and dry material near ε = 4 must come out in
   * single figures.
   */
  const TOPP = 'θ = −5.3e-2 + 2.92e-2·ε − 5.5e-4·ε² + 4.3e-6·ε³';
  const TOPP_SRC = 'Topp, Davis & Annan (1980), Water Resour. Res. 16:574';
  prop(c, 'topp-water', TOPP, TOPP_SRC,
    'A probe reading 100 — immersed in water — converts to essentially 100% water',
    waterContentFromDisplay(100) > 95);
  prop(c, 'topp-air', TOPP, TOPP_SRC,
    'A probe reading 0 — sitting in air — converts to near-zero water',
    waterContentFromDisplay(0) < 6);
  prop(c, 'topp-monotone', TOPP, TOPP_SRC,
    'Water content rises with the reading across the whole scale',
    Array.from({ length: 100 }, (_, i) => i).every(
      (p) => waterContentFromDisplay(p + 1) >= waterContentFromDisplay(p)));
  prop(c, 'topp-concave', TOPP, TOPP_SRC,
    'The curve is steepest when dry, so a point of movement is worth more water at the dry end',
    waterFractionBetween(10, 11) > waterFractionBetween(60, 61));

  /* ── 6. THE HORTICULTURAL ANCHOR ───────────────────────────────────────────
   *
   * Topp was fitted to mineral soils and taken literally says a dry pot needs
   * 45% of its volume to reach capacity, against the 25–30% every grower uses.
   * The curve supplies the shape and practice supplies the magnitude — so the
   * anchor itself is worth checking, since it is the single number standing
   * between a correct curve and a two-litre instruction.
   */
  prop(c, 'soak-fraction', 'thorough watering ≈ 0.27 × pot volume',
    'Container-nursery practice: 25–30% of medium volume for a thorough irrigation',
    'A full dry-to-capacity soak comes to 25–30% of the pot',
    waterFractionBetween(10, 70) >= 0.25 && waterFractionBetween(10, 70) <= 0.30);
  prop(c, 'no-negative-water', 'water needed = f(from, to)', 'Arithmetic',
    'Watering downwards never asks for a negative volume',
    waterFractionBetween(60, 20) === 0 && waterFractionBetween(40, 40) === 0);
  prop(c, 'ml-per-point-positive', 'ml per point per litre', 'Arithmetic',
    'A display point always costs a positive, finite amount of water',
    Array.from({ length: 101 }, (_, i) => i).every((p) => {
      const v = mlPerPointPerLiter(p);
      return Number.isFinite(v) && v > 0 && v < 1000;
    }));

  /* ── 7. POT GEOMETRY ───────────────────────────────────────────────────────
   *
   * V = π r² h, scaled by a shape factor for the taper. Elementary, and
   * therefore exactly the sort of thing that goes wrong by a factor of 1000 in
   * a unit conversion and is never noticed.
   */
  const GEO = 'V = π · (d/2)² · h · shapeFactor';
  const GEO_SRC = 'Volume of a cylinder; taper factors from nursery pot dimensions';
  const straight20 = potVolume({ potSize: 'M', potCm: 22, potHeightCm: 20, potShape: 'straight' });
  ref(c, 'volume-cylinder', GEO, GEO_SRC,
    'A straight 22 cm × 20 cm pot holds 7.6 litres',
    straight20.liters, (Math.PI * 11 * 11 * 20) / 1000, 0.001);
  prop(c, 'volume-radius-squared', GEO, GEO_SRC,
    'Doubling the diameter quadruples the volume',
    near(
      potVolume({ potSize: 'M', potCm: 40, potHeightCm: 20, potShape: 'straight' }).liters,
      4 * potVolume({ potSize: 'M', potCm: 20, potHeightCm: 20, potShape: 'straight' }).liters,
      1e-9));
  prop(c, 'volume-height-linear', GEO, GEO_SRC,
    'Doubling the depth doubles the volume',
    near(
      potVolume({ potSize: 'M', potCm: 22, potHeightCm: 40, potShape: 'straight' }).liters,
      2 * potVolume({ potSize: 'M', potCm: 22, potHeightCm: 20, potShape: 'straight' }).liters,
      1e-9));
  prop(c, 'volume-taper-order', GEO, GEO_SRC,
    'A tapered pot holds less than a straight one of the same rim and depth',
    potVolume({ potSize: 'M', potCm: 22, potHeightCm: 20, potShape: 'very-tapered' }).liters
      < potVolume({ potSize: 'M', potCm: 22, potHeightCm: 20, potShape: 'tapered' }).liters
    && potVolume({ potSize: 'M', potCm: 22, potHeightCm: 20, potShape: 'tapered' }).liters
      < straight20.liters);
  prop(c, 'volume-finite', GEO, GEO_SRC,
    'Absurd or missing dimensions fall back to a sane bucket instead of an infinite pot',
    [
      potVolume({ potSize: 'M', potCm: 1e9, potHeightCm: 1e9 }),
      potVolume({ potSize: 'M', potCm: Number.POSITIVE_INFINITY, potHeightCm: 20 }),
      potVolume({ potSize: 'M', potCm: null, potHeightCm: null }),
      potVolume({ potSize: 'M', potCm: -5, potHeightCm: -5 }),
    ].every((v) => Number.isFinite(v.liters) && v.liters > 0 && v.liters < 500));

  /* ── 8. WALLER'S IRRIGATION RULE ───────────────────────────────────────────
   *
   * Volume in litres × 0.1 = litres to apply. A field-tested rule of thumb for
   * container irrigation, and a genuinely independent check on the sensor-driven
   * dose: it uses only the pot's size, so it cannot be wrong in the same way the
   * moisture chain can. Checked here for internal consistency — that it agrees
   * with the physics to within the factor the two methods can honestly differ by.
   */
  const WALLER = 'apply ≈ 0.10 × pot volume';
  const WALLER_SRC = 'Waller, University of Arizona — container irrigation rule of thumb';
  prop(c, 'waller-units', WALLER, WALLER_SRC,
    'A 7.6 litre pot asks for about 760 ml, not 76 or 7 600',
    near(straight20.liters * 0.1 * 1000, 760, 0.02));
  prop(c, 'waller-within-physics', WALLER, WALLER_SRC,
    'The 10% rule sits between a routine top-up and a full soak, as it should',
    0.1 > waterFractionBetween(45, 55) && 0.1 < waterFractionBetween(10, 70));

  /* ── 9. INVERSES MUST INVERT ───────────────────────────────────────────────
   *
   * `probeReads` maps a water-table depth to what the probe shows;
   * `inferWaterTableDepth` goes back the other way, and `containerThresholds`
   * binary-searches through both. If they disagree, every threshold in the app
   * is quietly displaced — and nothing would look wrong.
   */
  const INV = 'probeReads ∘ inferWaterTableDepth = identity';
  const INV_SRC = 'Internal consistency — an inverse that does not invert is a silent error';
  const geo = { potHeightCm: 20, soilMix: 'Standard mix' as const, soilRetention: null, probeDepthCm: null };
  /*
   * The first run of this checker failed here, and the failure was worth having.
   *
   * A 20 cm standard-mix pot can only read 18.2%–33.1% AT HYDROSTATIC
   * EQUILIBRIUM — that is the entire range the retention curve can produce when
   * the water has finished settling. Ask the inverse for 45% and there is no
   * water-table depth that answers, so it clamps, and the round-trip cannot
   * close. The inverse is right; the original check was simply asking it for
   * readings that do not exist in its domain.
   *
   * That equilibrium range being so narrow is not an artefact either. It is
   * exactly why the app never trusts the modelled capacity on its own: a real
   * watering does not leave a pot at equilibrium, it leaves it draining, and the
   * probe reads far higher while that lasts. Hence `capacityAt` letting an
   * observed ceiling outrank the model.
   *
   * So the property worth asserting is the true one — exact inside the domain,
   * clamped and finite outside it — which is both stronger and honest about
   * where the model stops applying.
   */
  const equilibriumLow = probeReads(geo, geo.potHeightCm);
  const equilibriumHigh = probeReads(geo, 0);
  prop(c, 'roundtrip-water-table', INV, INV_SRC,
    'Inside the range the curve can actually produce, reading → depth → reading is exact',
    [0.05, 0.25, 0.5, 0.75, 0.95].every((f) => {
      const r = equilibriumLow + (equilibriumHigh - equilibriumLow) * f;
      return near(probeReads(geo, inferWaterTableDepth(r, geo)), r, 0.01);
    }));
  prop(c, 'roundtrip-clamps-outside', INV, INV_SRC,
    'Outside that range the inverse clamps to a finite depth instead of diverging',
    [0, 5, 45, 70, 100].every((r) => {
      const d = inferWaterTableDepth(r, geo);
      return Number.isFinite(d) && d >= 0 && Number.isFinite(probeReads(geo, d));
    }));
  prop(c, 'equilibrium-range-known', INV, INV_SRC,
    'The app knows the equilibrium range is narrow, which is why an observed ceiling can outrank it',
    equilibriumHigh > equilibriumLow && equilibriumHigh - equilibriumLow < 40);
  prop(c, 'thresholds-ordered', 'containerThresholds', INV_SRC,
    'A pot always refills below its capacity, and stresses below that again',
    [10, 16, 24, 32].every((h) => {
      const th = containerThresholds({ ...geo, potHeightCm: h });
      return th.capacityReading > th.refillReading && th.refillReading >= th.stressReading;
    }));
  prop(c, 'thresholds-finite', 'containerThresholds', INV_SRC,
    'Every threshold is a real number on the 0–100 scale for every pot depth',
    Array.from({ length: 40 }, (_, i) => i + 4).every((h) => {
      const th = containerThresholds({ ...geo, potHeightCm: h });
      return [th.capacityReading, th.refillReading, th.stressReading].every(
        (v) => Number.isFinite(v) && v >= 0 && v <= 100);
    }));

  /* ── 10. NO SILENT NON-NUMBERS ─────────────────────────────────────────────
   *
   * The app has shipped "Soil is Infinity%" before. A NaN that reaches a screen
   * is a formatting bug; a NaN that reaches a dose is a dead plant.
   */
  prop(c, 'no-nan-anywhere', 'all of the above', 'Defensive arithmetic',
    'No formula returns NaN or Infinity for any input on its scale',
    [
      ...Array.from({ length: 101 }, (_, i) => waterContentFromDisplay(i)),
      ...Array.from({ length: 101 }, (_, i) => mlPerPointPerLiter(i)),
      ...Array.from({ length: 60 }, (_, i) => saturationVaporPressureKpa(i - 10)),
      ...MIXES.map((m) => waterContentAt(TENSION.containerCapacity, m)),
    ].every((v) => Number.isFinite(v)));
  prop(c, 'garbage-in-not-nan-out', 'all of the above', 'Defensive arithmetic',
    'Malformed inputs return zero or a fallback, never a non-number',
    [
      waterContentFromDisplay(NaN),
      waterContentFromDisplay(Number.POSITIVE_INFINITY),
      saturationVaporPressureKpa(NaN),
      waterFractionBetween(NaN, 40),
    ].every((v) => Number.isFinite(v)));

  const failures = c.filter((x) => !x.passed);
  return {
    checks: c,
    passed: c.length - failures.length,
    failed: failures.length,
    sound: failures.length === 0,
    failures,
  };
}

/** One line for a status row. */
export function formulaCheckLine(report = runFormulaChecks()): string {
  return report.sound
    ? `All ${report.checks.length} checks pass — every formula matches its published reference and holds its invariants.`
    : `${report.failed} of ${report.checks.length} checks FAILED: ${report.failures.map((f) => f.id).join(', ')}.`;
}

/** The checks grouped by the formula they test, for display. */
export function checksByFormula(report = runFormulaChecks()): { formula: string; source: string; checks: FormulaCheck[] }[] {
  const groups = new Map<string, { formula: string; source: string; checks: FormulaCheck[] }>();
  for (const check of report.checks) {
    const g = groups.get(check.formula);
    if (g) g.checks.push(check);
    else groups.set(check.formula, { formula: check.formula, source: check.source, checks: [check] });
  }
  return [...groups.values()];
}
