import type { Reading } from './devices';
import type { DayLight } from './insights';
import { storedLightAvg } from './insights';
import type { Plant } from './types';
import { waterAction } from './waterAction';
import { waterPlan } from './watering';

/**
 * The amount a list row quotes for "water this plant" — the SAME rule the plant
 * screen uses for its Water button: the measured deficit when the sensor says
 * the plant needs water now, otherwise the plant's calculated routine drink.
 *
 * Lists used to quote `waterAmount` (pot size alone), so Today could say 300 ml
 * while the plant screen recommended 175 ml for the same plant.
 *
 * `reading` and `history` must already be calibration-corrected.
 */
export function listPourMl(
  plant: Plant,
  reading: Reading | null,
  history: Reading[],
  lightDaily: DayLight[] | undefined,
): number {
  const act = waterAction({ plant, reading, history });
  if (act.ml > 0) return act.ml;
  return waterPlan({
    species: plant.species,
    potSize: plant.potSize,
    potMaterial: plant.potMaterial,
    potCm: plant.potCm,
    tempC: reading?.temp_c,
    humidityPct: reading?.humidity_pct,
    lightAvg: storedLightAvg(lightDaily)?.avg ?? null,
  }).ml;
}
