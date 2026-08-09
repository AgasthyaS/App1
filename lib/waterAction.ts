import type { Reading } from './devices';
import { buildHydrationModel } from './hydration';
import { idealsFor } from './plantStatus';
import { soilDynamics, wateredSinceLastReading, wateringDidNotRegister } from './soilDynamics';
import { withMeasuredRetention } from './soilRetention';
import { perPointFor } from './waterBalance';
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
  const target = Math.round((lo + hi) / 2);

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
        ? `Soil is ${Math.round(soil)}%, below ${plant.species}'s ${lo}% floor. ${step.note}`
        : `Soil is ${Math.round(soil)}%, below ${plant.species}'s ${lo}% floor.`,
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
