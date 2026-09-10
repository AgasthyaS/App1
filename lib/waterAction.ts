import type { Reading } from './devices';
import { buildHydrationModel } from './hydration';
import { idealsFor } from './plantStatus';
import { soilDynamics, wateredSinceLastReading, wateringDidNotRegister } from './soilDynamics';
import { withMeasuredRetention } from './soilRetention';
import { perPointFor, poursAndCeiling } from './waterBalance';
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
   * `strong` is the flag that means what is needed: two or more waterings of
   * MATERIALLY DIFFERENT VOLUMES that all ended at the same reading. A 300 ml
   * pour and a 900 ml pour both landing at 38% is not a pot nobody has filled —
   * it is a pot that was offered three times the water and put it in the saucer.
   * That is a physical ceiling wherever it sits, above the band or below it, and
   * it is the one honest way to tell a low ceiling from an un-watered one.
   *
   * It was already being computed on every call, and read by nothing.
   */
  const { ceiling } = history.length ? poursAndCeiling(plant, history, now) : { ceiling: null };
  const bandMid = Math.round((lo + hi) / 2);
  const cappedByCeiling = ceiling?.strong === true && ceiling.pct < bandMid;
  const target = cappedByCeiling ? Math.round(ceiling!.pct) : bandMid;
  const ceilingNote = cappedByCeiling
    ? ` Different-sized waterings have all topped this pot out at ${Math.round(ceiling!.pct)}%, so Greenr aims there rather than at ${bandMid}% — the rest would run straight out of the base.`
    : '';

  // The pot's own measured millilitres-per-point, once its pours agree. Built
  // here rather than per-surface so every screen quotes the same figure.
  const hydration = history.length
    ? buildHydrationModel(history, plant.waterLog, { size: plant.potSize, material: plant.potMaterial, cm: plant.potCm }, ideal.band)
    : null;
  const calibration = hydration && hydration.fit.n >= 2
    ? { mlPerPoint: hydration.fit.k, pairs: hydration.fit.n, r2: hydration.fit.r2 }
    : null;

  // What a millilitre actually does in THIS pot, reconciled from its geometry,
  // every logged pour, and the ceiling it has been shown to top out at.
  const balance = history.length ? perPointFor(plant, history, soil, now) : null;

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
        ? `Soil is ${Math.round(soil)}%, below ${plant.species}'s ${lo}% floor. ${step.note}${ceilingNote}`
        : `Soil is ${Math.round(soil)}%, below ${plant.species}'s ${lo}% floor.${ceilingNote}`,
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
