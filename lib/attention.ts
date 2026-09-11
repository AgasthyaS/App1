import { applyCalibration, type SensorCalibration } from './calibration';
import type { Reading } from './devices';
import { confidentVerdicts } from './environment';
import type { DayLight } from './insights';
import { idealsFor } from './plantStatus';
import { probeInsertion } from './probeInsertion';
import { probeResolution, timeBasedSchedule } from './probeResolution';
import { salinityAssessment } from './salinity';
import { setupCompleteness } from './setupGaps';
import { mixVerdict } from './soilRecipe';
import { sensorSilence, soilDynamics } from './soilDynamics';
import type { Plant } from './types';
import { pendingWateringQuestion } from './unloggedWatering';
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

  /*
   * A SILENT SENSOR IS NOT A HEALTHY PLANT. Every branch below judges "the latest
   * reading", and until now nothing asked how old that was — so a sensor that had
   * been dead for six days produced a confident "Fine" while the plant went dry.
   * Silence has to read as not-knowing, never as reassurance.
   */
  const silence = sensorSilence(history, now);

  /*
   * IS THE PROBE EVEN IN THE SOIL? Asked before every other question, including
   * whether the pot needs water, because this is the one fault that makes the
   * reading itself meaningless rather than merely imprecise.
   *
   * A blade half out of the pot averages air at a permittivity of 1 against soil
   * at 80, so it reports close to bone-dry however wet the pot is. Judged on that
   * reading, the app tells someone to water a plant that is already drowning —
   * and keeps telling them, because the water never moves the number. Ranked
   * above waterlogging for that reason: everything below this line is derived
   * from a number this test can show to be fictional.
   */
  const insertion = history.length ? probeInsertion(plant, history, now) : null;
  if (insertion?.verdict === 'likely-shallow') {
    return {
      level: 'urgent', priority: 97, label: 'Check the probe',
      reason: `${insertion.headline} — every reading below is suspect until it is pushed in.`,
      daysUntilWater: null,
    };
  }

  /*
   * CAN THIS PROBE READ THIS POT AT ALL? Asked before anything is judged on the
   * reading, because in a gritty mix or a very deep pot the entire moisture range
   * is smaller than the sensor's own jitter — and every branch below would then
   * be reading noise with total confidence.
   */
  const probe = probeResolution(plant, history, ideal.band);
  /*
   * …but a plant actively being harmed outranks any limitation of the
   * instrument. The timing fallback used to short-circuit everything below it,
   * including the waterlogging check — so a pot whose water was demonstrably not
   * draining got "Fine, about 4 days to go" because the probe had been judged
   * unable to resolve its range. The reading being coarse does not make the
   * standing water go away, and `soilDynamics` reaches its verdict from the
   * SHAPE of the trace rather than from fine gradations in it, so it is still
   * trustworthy exactly where this branch is not.
   */
  const earlyDyn = history.length ? soilDynamics(plant, history, ideal.band, now) : null;
  if (probe?.mode === 'time-based' && earlyDyn?.drainageProblem) {
    return {
      level: 'urgent', priority: 100, label: 'Waterlogged',
      reason: earlyDyn.headline,
      daysUntilWater: null,
    };
  }
  if (probe?.mode === 'time-based') {
    const t = timeBasedSchedule(plant, history, probe, now);
    const due = t.dueInDays != null && t.dueInDays <= 0;
    return {
      level: due ? 'soon' : t.intervalDays == null ? 'unknown' : 'fine',
      priority: due ? 66 : t.intervalDays == null ? 28 : 18,
      label: due ? 'Water (by timing)' : t.intervalDays == null ? 'Learning rhythm' : 'Fine',
      reason: `${t.headline} — the probe can't read moisture in this pot, so Greenr goes by timing.`,
      daysUntilWater: t.dueInDays,
    };
  }

  const act = waterAction({ plant, reading, history, now });
  const dyn = earlyDyn;
  const schedule = history.length ? wateringSchedule(plant, history, ideal.band, now) : null;
  const daysUntilWater = schedule?.daysUntilDue ?? null;

  // A stale reading can still show a problem — a plant that was already dry when
  // the sensor died is still dry — so a genuine alarm is kept and merely dated.
  // What must never survive staleness is the all-clear.
  /*
   * Staleness cuts both ways, and the first version of this only handled one.
   *
   * A stale all-clear is a lie — that was the original fix. But a stale ALARM is
   * also wrong in its own way: in simulation a Monstera whose sensor had been
   * silent for 159 hours was reported "water now, ~250 ml" off a week-old 28.8%
   * reading while the pot was in fact sitting at its ceiling, because somebody
   * had watered it in the meantime. Acting on that advice would over-water a full
   * pot.
   *
   * The alarm is still worth showing — a plant that was dry when the sensor died
   * is probably still dry — so it is kept and dated rather than suppressed. What
   * it loses is PRECEDENCE: a problem we can currently see must always sort above
   * one we are inferring from week-old data.
   */
  const STALE_PRIORITY_CAP = 65;
  const dated = (a: Attention): Attention =>
    silence?.stale
      ? {
          ...a,
          level: a.level === 'fine' ? 'unknown' : a.level === 'urgent' ? 'soon' : a.level,
          label: a.level === 'fine' ? 'Sensor quiet' : a.label,
          priority: a.level === 'fine' ? 42 : Math.min(a.priority, STALE_PRIORITY_CAP),
          reason: a.level === 'fine'
            ? `No reading for ${silence.hoursSince < 48 ? `${Math.round(silence.hoursSince)} h` : `${Math.round(silence.hoursSince / 24)} days`} — this plant has not been checked, not confirmed healthy.`
            : `${a.reason} (from a reading ${silence.hoursSince < 48 ? `${Math.round(silence.hoursSince)} h` : `${Math.round(silence.hoursSince / 24)} days`} old)`,
        }
      : a;

  // 1 — actively being harmed.
  if (dyn?.drainageProblem) {
    return dated({ level: 'urgent', priority: 100, label: 'Waterlogged', reason: dyn.headline, daysUntilWater });
  }
  if (act.kind === 'retry') {
    return dated({ level: 'urgent', priority: 95, label: 'Retry water', reason: 'A watering was logged but the soil never moved.', daysUntilWater });
  }
  // 2 — needs water. How urgent depends on how far past its floor it is, which is
  // already species-weighted by `soilDynamics` through the drought tolerance.
  if (act.kind === 'water') {
    const below = Math.max(0, ideal.band[0] - (reading.soil_pct ?? 0));
    const serious = dyn?.tone === 'bad';
    return dated({
      level: serious ? 'urgent' : 'soon',
      priority: serious ? 90 : 70,
      label: serious ? 'Water now' : 'Water soon',
      reason: `Soil ${Math.round(reading.soil_pct)}%, ${Math.round(below)} below its floor · ~${act.ml} ml`,
      daysUntilWater: 0,
    });
  }
  if (act.kind === 'waiting') {
    return dated({ level: 'fine', priority: 10, label: 'Watered', reason: 'Waiting for the sensor to confirm.', daysUntilWater });
  }
  if (act.kind === 'hold') {
    return dated({ level: 'watch', priority: 45, label: 'Too wet', reason: act.line, daysUntilWater });
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
    return dated({
      level: 'watch', priority: 50, label: worst.relocate ? 'Move it' : 'Fix the air',
      reason: worst.headline, daysUntilWater,
    });
  }

  /*
   * 3b — salt building up. Weeks-to-months scale, so it never outranks a plant
   * that needs water today, but it is ahead of the housekeeping items below
   * because it gets worse on its own and it is quietly corrupting the readings
   * the rest of this file depends on.
   */
  const salt = history.length ? salinityAssessment(plant, history, now) : null;
  if (salt?.risk === 'likely') {
    return dated({
      level: 'watch', priority: 44, label: 'Salt build-up',
      reason: salt.leachingBlocked
        ? 'Readings are drifting the way a salting pot drifts, and this pot has no drainage to flush it through.'
        : `Readings are drifting the way a salting pot drifts — a flush of about ${salt.leachMl} ml would clear it.`,
      daysUntilWater,
    });
  }

  /*
   * 4 — a watering the sensor saw that nobody recorded. Ranked here on purpose:
   * it is not a problem with the PLANT, so it must never outrank one, but it is
   * the cheapest thing on the list and the only item that makes every future
   * answer for this pot more accurate. Left unasked the measurement is lost.
   */
  const ask = pendingWateringQuestion(plant, history, now);
  if (ask) {
    return dated({
      level: 'watch', priority: 38, label: 'Did you water?',
      reason: `Soil jumped ${Math.round(ask.fromPct)}% → ${Math.round(ask.settledPct ?? ask.peakPct)}% — tell Greenr how much and this pot gets measured.`,
      daysUntilWater,
    });
  }

  /*
   * 5 — the app is missing something it needs. Ranked here because it is not a
   * problem with the plant, but it IS the reason this plant's numbers are rough,
   * and unlike everything above it costs a ruler and ten seconds.
   */
  const setup = setupCompleteness(plant);
  if (setup.degraded && setup.worst) {
    return dated({
      level: 'watch', priority: 36, label: `Missing ${setup.worst.label.toLowerCase()}`,
      reason: setup.headline,
      daysUntilWater,
    });
  }

  // 5b — the probe MIGHT not be seated. Not certain enough to lead with, but
  // cheap to check and it would explain a lot if true.
  if (insertion?.verdict === 'suspect') {
    return dated({
      level: 'watch', priority: 37, label: 'Probe reading oddly',
      reason: insertion.headline,
      daysUntilWater,
    });
  }

  // 6 — wrong soil. Only actionable at a repot, so it never outranks anything live.
  const mix = mixVerdict(plant.species, plant.soilMix ?? null);
  if (mix.severity === 'major') {
    return dated({ level: 'watch', priority: 35, label: 'Wrong soil', reason: mix.headline, daysUntilWater });
  }

  // 6 — fine. The rating still carries the schedule, because "fine for 6 days" and
  // "fine until tomorrow" are different kinds of fine.
  if (daysUntilWater != null) {
    const soon = daysUntilWater <= 1.5;
    return dated({
      level: soon ? 'soon' : 'fine',
      // Rounded: the priority is a sort key AND a number a caller may show, and
      // a raw 19.24335113017426 is neither more accurate nor presentable.
      priority: soon ? 60 : Math.round(Math.max(5, 30 - daysUntilWater * 2)),
      label: soon ? 'Due soon' : 'Fine',
      reason: soon
        ? `Water in about ${daysUntilWater < 1 ? 'a day' : `${Math.round(daysUntilWater)} days`} · ~${schedule?.ml} ml`
        : `Next water in about ${Math.round(daysUntilWater)} days`,
      daysUntilWater,
    });
  }
  return dated({ level: 'fine', priority: 15, label: 'Fine', reason: 'Nothing needs doing.', daysUntilWater: null });
}
