import type { Reading } from './devices';
import { buildHydrationModel } from './hydration';
import { idealsFor } from './plantStatus';
import { soilDynamics, wateredSinceLastReading, wateringDidNotRegister } from './soilDynamics';
import { withMeasuredRetention } from './soilRetention';
import { insertionBlocksLearning, probeInsertion } from './probeInsertion';
import { perPointFor, poursAndCeiling, wateringSchedule } from './waterBalance';
import type { Plant } from './types';
import { pourStep, type PourStep } from './watering';

/**
 * THE water decision — one function, used by every surface.
 *
 * Home, the plant screen, Care Mode and the alert engine each used to re-derive
 * "does this plant need water, and how much" from the raw reading. They drifted
 * apart three separate times: Home once quoted a routine soak while the plant
 * screen quoted a deficit; Home later rebuilt the pot without its shape or mix
 * and differed by 126%; and most recently the plant screen moved to trial dosing
 * while Home stayed on the full amount, so one said "fine" while the other said
 * "add a litre".
 *
 * The cause was never the arithmetic — it was having the decision in four places.
 * So the ranking, the amount, and the wording all live here now, and a surface
 * can only choose how much of it to show.
 *
 * Order matters and is deliberate:
 *   1. RETRY   — a logged pour the sensor never saw. Ranked above "needs water"
 *                because the soil IS dry, but repeating the same instruction
 *                would just repeat the failure.
 *   2. WAITING — watered, sensor hasn't reported yet. Never nag in this window.
 *   3. WATER   — genuinely below the species floor.
 *   4. HOLD    — wetter than ideal, or not draining.
 *   5. OK      — nothing to do.
 */
export type WaterActionKind = 'retry' | 'waiting' | 'water' | 'hold' | 'ok';

export interface WaterAction {
  kind: WaterActionKind;
  /** ml to pour now — 0 unless kind is 'water' or 'retry' */
  ml: number;
  /** predicted soil rise for that dose, when a testable claim is being made */
  predictedRisePts: number | null;
  /** one short line, for Home's per-plant row */
  line: string;
  /** the fuller explanation, for the plant screen */
  detail: string;
  urgent: boolean;
  /** the underlying dose decision (trial vs measured vs modelled) */
  step: PourStep | null;
}

/** The same insertion test, callable before `insertion` is in scope. */
function probeUnreliableEarly(
  plant: Parameters<typeof probeInsertion>[0],
  history: Parameters<typeof probeInsertion>[1],
  now: number,
): boolean {
  return insertionBlocksLearning(probeInsertion(plant, history, now));
}

export function waterAction(opts: {
  plant: Plant;
  /** calibration-corrected latest reading */
  reading: Reading | null;
  /** calibration-corrected history, oldest → newest */
  history?: Reading[];
  now?: number;
}): WaterAction {
  const { plant: statedPlant, reading, history = [], now = Date.now() } = opts;
  // How fast this pot ACTUALLY dries, measured from the sensor's own dry-down
  // curve, replaces the owner's recollection of it wherever the evidence is good
  // enough. Applied here rather than per-surface for the same reason the dose is:
  // retention feeds the leaching fraction and the depth correction, so two
  // screens using different values would quote different millilitres again.
  const plant = history.length ? withMeasuredRetention(statedPlant, history) : statedPlant;
  /*
   * A plant can reach here with no species — mid-add, or restored from an older
   * store — and the name goes into the sentence the owner reads. Interpolated
   * raw it produced "Soil is 0%, below null's 30% floor".
   */
  const speciesName = typeof plant.species === 'string' && plant.species.trim()
    ? plant.species.trim()
    : 'this plant';
  const ideal = idealsFor(plant.species, plant.comfortBand);
  const [lo, hi] = ideal.band;
  const none = (kind: WaterActionKind, line: string, detail: string, urgent = false): WaterAction => ({
    kind, ml: 0, predictedRisePts: null, line, detail, urgent, step: null,
  });

  if (!reading || reading.soil_pct == null || !Number.isFinite(reading.soil_pct)) {
    return none('ok', 'Awaiting first reading', 'No soil reading yet.');
  }
  const soil = reading.soil_pct;

  /*
   * AIM AT WHAT THE POT CAN ACTUALLY HOLD, not at the middle of the book band.
   *
   * The target used to be `(lo + hi) / 2` unconditionally, and that is where the
   * "it said 900 ml and 400 ml was plenty" complaint came from. Some pots simply
   * never reach the middle of their species' band: a fast, gritty, well-drained
   * mix tops out several points lower, and the water asked for above that point
   * does not enter the soil at all — it runs through and stands in the saucer,
   * which is the condition that rots roots rather than the one that prevents it.
   *
   * This clamp already existed — in `doseFor`, which nothing has ever called.
   * The live path is `waterAction → pourStep`, and while that caps the pour by
   * VOLUME (a quarter of the pot, an absolute maximum), no cap in reading-space
   * existed, so the deficit itself was overstated before any of those applied.
   *
   * ─────────────────── WHICH FLAG, AND WHY NOT THE OBVIOUS ONE ───────────────
   *
   * `ceiling.confirmed` is the wrong test here and using it produced a clamp
   * that could never once fire. Read what it means: with a band present it
   * requires `max >= band[1] + 8`, i.e. it answers "is this pot being FLOODED",
   * topping out well above where the plant wants to sit. A ceiling satisfying
   * that is by definition above the band midpoint, so `confirmed && pct <
   * bandMid` is a contradiction. It type-checked, read sensibly, and was dead.
   *
   * `strong` — two or more waterings of MATERIALLY DIFFERENT VOLUMES all ending
   * at the same reading — was the first attempt at that evidence, and it is good
   * evidence, but it is too narrow to be the only test. Somebody who waters
   * 300 ml every time produces no volume spread at all, so `strong` never fires,
   * and their pot can demonstrably top out at 33% while this went on asking it
   * to reach 42%.
   *
   * ──────────────── AND WHY IT ASKS THE SCHEDULE, NOT THE CEILING ─────────────
   *
   * Because the app already has a definition of where a pot tops out, and having
   * a second one here is precisely how two screens end up quoting different
   * millilitres. `wateringSchedule.capacityAt` is that definition: the observed
   * ceiling and the modelled capacity reconciled, then capped at the species'
   * own ceiling. An audit found this surface asking for 1 540 ml on a pot whose
   * schedule was quoting 350 — a four-fold disagreement between two cards in the
   * same app, neither of them obviously wrong on its own.
   *
   * They still answer different questions — "you are at 8%, here is a drink"
   * against "routinely, this much this often" — and it is right that the numbers
   * differ. What is not right is disagreeing about how full the pot can get.
   */
  const { ceiling } = history.length ? poursAndCeiling(plant, history, now) : { ceiling: null };
  const bandMid = Math.round((lo + hi) / 2);
  const reachable = history.length
    ? wateringSchedule(plant, history, ideal.band, now)?.capacityAt ?? null
    : null;
  const cappedByCeiling = reachable != null && reachable < bandMid - 1;
  const target = cappedByCeiling && reachable != null ? Math.round(reachable) : bandMid;
  const ceilingNote = cappedByCeiling
    ? ` This pot tops out around ${Math.round(reachable!)}%, so Greenr aims there rather than at ${bandMid}% — the difference would run straight out of the base.${
        ceiling?.strong ? ' Waterings of different sizes have all ended at the same reading, which is what shows it is a real ceiling rather than a pot nobody has filled.' : ''
      }`
    : '';

  // The pot's own measured millilitres-per-point, once its pours agree. Built
  // here rather than per-surface so every screen quotes the same figure.
  const hydration = history.length && !probeUnreliableEarly(plant, history, now)
    ? buildHydrationModel(history, plant.waterLog, { size: plant.potSize, material: plant.potMaterial, cm: plant.potCm }, ideal.band)
    : null;
  const calibration = hydration && hydration.fit.n >= 2
    ? { mlPerPoint: hydration.fit.k, pairs: hydration.fit.n, r2: hydration.fit.r2 }
    : null;

  /*
   * WHAT A MILLILITRE DOES IN THIS POT — reconciled from its geometry, every
   * logged pour, and the ceiling it has been shown to top out at.
   *
   * Unless the probe is not in the soil, in which case none of that evidence is
   * evidence. A blade sitting in air under-reports every rise, so `ml ÷ rise`
   * comes out enormous: in simulation a pot needing about 300 ml was measured at
   * 123 ml per point and told to take 1 540 ml — five times what it wanted,
   * poured into a plant that was probably already wet. The measurement is not
   * merely noisy there, it is systematically and dangerously wrong in one
   * direction, so it is discarded rather than blended, and the geometric prior
   * stands alone until the probe is seated.
   */
  const insertion = history.length ? probeInsertion(plant, history, now) : null;
  const probeUnreliable = insertion != null && insertionBlocksLearning(insertion);
  const balance = history.length && !probeUnreliable ? perPointFor(plant, history, soil, now) : null;
  const probeNote = probeUnreliable
    ? ' This amount is from the pot\'s size alone: the probe looks like it is not pushed far enough into the soil, so the readings cannot be used to size a watering until it is.'
    : '';

  const step = pourStep(plant, {
    soilPct: soil,
    targetPct: target,
    tempC: reading.temp_c,
    humidityPct: reading.humidity_pct,
  }, calibration, balance);

  // 1. A pour that never reached the soil — but ONLY while the plant still needs
  // water. A logged watering that never landed stops mattering the moment the
  // soil is back inside its comfortable band: the pour is moot, and demanding a
  // retry there tells someone to water a plant that is already fine. That was the
  // lily bug — a phantom log from when it WAS dry kept asking for a litre long
  // after the soil had recovered to 31% in a 30–55% band.
  const miss = history.length ? wateringDidNotRegister(plant, history, ideal.band, now) : null;
  if (miss) {
    return {
      kind: 'retry',
      ml: step.ml,
      predictedRisePts: step.predictedRisePts,
      line: `Watering didn't reach the soil — try again with ${step.ml} ml`,
      detail: miss.text,
      urgent: true,
      step,
    };
  }

  // 2. Watered, waiting on the sensor.
  if (wateredSinceLastReading(plant, reading, now)) {
    return none(
      'waiting',
      'Watered — waiting for the sensor',
      'You logged a watering. The sensor reports every few hours, so the reading above is from before you poured.',
    );
  }

  // 3/4. What the soil actually says.
  const dyn = history.length ? soilDynamics(plant, history, ideal.band, now) : null;
  if (soil < lo) {
    return {
      kind: 'water',
      ml: step.ml,
      predictedRisePts: step.predictedRisePts,
      line: `Water now — soil ${Math.round(soil)}% · add ~${step.ml} ml`,
      detail: step.isTrial
        ? `Soil is ${Math.round(soil)}%, below ${speciesName}'s ${lo}% floor. ${step.note}${ceilingNote}${probeNote}`
        : `Soil is ${Math.round(soil)}%, below ${speciesName}'s ${lo}% floor.${ceilingNote}${probeNote}`,
      urgent: true,
      step,
    };
  }
  if (dyn?.drainageProblem) {
    return none('hold', `Not draining — soil ${Math.round(soil)}%`, dyn.detail, true);
  }
  if (soil > hi && !dyn?.draining) {
    return none('hold', `Let it dry — soil ${Math.round(soil)}%`, `Soil is ${Math.round(soil)}%, above the ${hi}% ceiling.`);
  }
  return none('ok', '', '');
}
