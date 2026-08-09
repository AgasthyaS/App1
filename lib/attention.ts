import { applyCalibration, type SensorCalibration } from './calibration';
import type { Reading } from './devices';
import { confidentVerdicts } from './environment';
import type { DayLight } from './insights';
import { idealsFor } from './plantStatus';
import { mixVerdict } from './soilRecipe';
import { soilDynamics } from './soilDynamics';
import type { Plant } from './types';
import { waterAction } from './waterAction';
import { wateringSchedule } from './waterBalance';

/**
 * ONE RATING PER PLANT, so a list can be triaged without opening anything.
 *
 * The garden list answered a question nobody asks. "No watering needed" is true
 * and useless: it says what is NOT wrong, for one factor, on one plant at a time,
 * which leaves the owner to open every card in turn to find the one that matters.
 * With a handful of plants that is tedious; with twenty it means the plant in
 * trouble is found last, or not at all.
 *
 * So every plant resolves to a single 0–100 priority and a one-word rating. The
 * number is for SORTING — the list puts what needs doing at the top — and the
 * word plus its short reason is for reading at a glance.
 *
 * The rating deliberately spans everything the app knows, not just water: a plant
 * can be perfectly watered and still be dying in a dark corner, and the old line
 * would have called it fine. Ranked by how fast harm arrives:
 *
 *   1. WATERLOGGED / a pour that never landed — days matter, roots are rotting.
 *   2. NEEDS WATER NOW — hours to days depending on the species' drought tolerance.
 *   3. DUE SOON — a scheduling nudge, not a problem.
 *   4. WRONG SPOT — real, but weeks-scale, and only once several days agree.
 *   5. WRONG SOIL — real, but only fixable at the next repot, so never urgent.
 *
 * Everything here is DERIVED from decisions that already exist elsewhere —
 * `waterAction`, `confidentVerdicts`, `mixVerdict`. Nothing new is judged. That
 * matters: if this file made its own judgement, the list and the plant screen
 * would eventually disagree, which is the bug this codebase keeps re-learning.
 */

export type AttentionLevel = 'urgent' | 'soon' | 'watch' | 'fine' | 'unknown';

export interface Attention {
  level: AttentionLevel;
  /** 0–100. Higher means it needs you sooner. Sort descending. */
  priority: number;
  /** the rating word shown in the list */
  label: string;
  /** why, in a few words — enough to decide whether to open it */
  reason: string;
  /** days until the next watering is due, when it can be measured */
  daysUntilWater: number | null;
}

const LEVEL_ORDER: Record<AttentionLevel, number> = { urgent: 0, soon: 1, watch: 2, unknown: 3, fine: 4 };

/** Sort helper: most in need first, then by priority within a level. */
export function byAttention(a: Attention, b: Attention): number {
  const d = LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
  return d !== 0 ? d : b.priority - a.priority;
}

export function attentionFor(opts: {
  plant: Plant;
  reading: Reading | null;
  history?: Reading[];
  calibration?: SensorCalibration | null;
  /** per-day light from the store — remembers far longer than the reading window */
  lightDaily?: DayLight[] | null;
  hasSensor: boolean;
  now?: number;
}): Attention {
  const { plant, hasSensor, now = Date.now() } = opts;
  const cal = opts.calibration ?? null;
  const reading = opts.reading && cal ? applyCalibration(opts.reading, cal) : opts.reading;
  const history = (opts.history ?? []).map((h) => (cal ? applyCalibration(h, cal) : h));
  const ideal = idealsFor(plant.species, plant.comfortBand);

  if (!hasSensor) {
    return {
      level: 'unknown', priority: 20, label: 'No sensor',
      reason: 'Judged from your watering log rather than measured.',
      daysUntilWater: null,
    };
  }
  if (!reading || reading.soil_pct == null) {
    return {
      level: 'unknown', priority: 25, label: 'Awaiting',
      reason: 'Sensor paired but nothing reported yet.',
      daysUntilWater: null,
    };
  }

  const act = waterAction({ plant, reading, history, now });
  const dyn = history.length ? soilDynamics(plant, history, ideal.band, now) : null;
  const schedule = history.length ? wateringSchedule(plant, history, ideal.band, now) : null;
  const daysUntilWater = schedule?.daysUntilDue ?? null;

  // 1 — actively being harmed.
  if (dyn?.drainageProblem) {
    return { level: 'urgent', priority: 100, label: 'Waterlogged', reason: dyn.headline, daysUntilWater };
  }
  if (act.kind === 'retry') {
    return { level: 'urgent', priority: 95, label: 'Retry water', reason: 'A watering was logged but the soil never moved.', daysUntilWater };
  }
  // 2 — needs water. How urgent depends on how far past its floor it is, which is
  // already species-weighted by `soilDynamics` through the drought tolerance.
  if (act.kind === 'water') {
    const below = Math.max(0, ideal.band[0] - (reading.soil_pct ?? 0));
    const serious = dyn?.tone === 'bad';
    return {
      level: serious ? 'urgent' : 'soon',
      priority: serious ? 90 : 70,
      label: serious ? 'Water now' : 'Water soon',
      reason: `Soil ${Math.round(reading.soil_pct)}%, ${Math.round(below)} below its floor · ~${act.ml} ml`,
      daysUntilWater: 0,
    };
  }
  if (act.kind === 'waiting') {
    return { level: 'fine', priority: 10, label: 'Watered', reason: 'Waiting for the sensor to confirm.', daysUntilWater };
  }
  if (act.kind === 'hold') {
    return { level: 'watch', priority: 45, label: 'Too wet', reason: act.line, daysUntilWater };
  }

  // 3 — a confidently wrong spot. Weeks-scale, so it ranks below water but it is
  // the thing people never notice on their own.
  const verdicts = history.length
    ? confidentVerdicts({
        species: plant.species,
        plantName: plant.name,
        history,
        ideal,
        lightDaily: opts.lightDaily ?? null,
        soilDyn: dyn,
      })
    : [];
  const worst = verdicts[0];
  if (worst) {
    return {
      level: 'watch', priority: 50, label: worst.relocate ? 'Move it' : 'Fix the air',
      reason: worst.headline, daysUntilWater,
    };
  }

  // 4 — wrong soil. Only actionable at a repot, so it never outranks anything live.
  const mix = mixVerdict(plant.species, plant.soilMix ?? null);
  if (mix.severity === 'major') {
    return { level: 'watch', priority: 35, label: 'Wrong soil', reason: mix.headline, daysUntilWater };
  }

  // 5 — fine. The rating still carries the schedule, because "fine for 6 days" and
  // "fine until tomorrow" are different kinds of fine.
  if (daysUntilWater != null) {
    const soon = daysUntilWater <= 1.5;
    return {
      level: soon ? 'soon' : 'fine',
      priority: soon ? 60 : Math.max(5, 30 - daysUntilWater * 2),
      label: soon ? 'Due soon' : 'Fine',
      reason: soon
        ? `Water in about ${daysUntilWater < 1 ? 'a day' : `${Math.round(daysUntilWater)} days`} · ~${schedule?.ml} ml`
        : `Next water in about ${Math.round(daysUntilWater)} days`,
      daysUntilWater,
    };
  }
  return { level: 'fine', priority: 15, label: 'Fine', reason: 'Nothing needs doing.', daysUntilWater: null };
}
