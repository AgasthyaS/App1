import { getSpecies, type CategoryKey } from './plants';
import type { Plant } from './types';

/**
 * The sensorless estimate engine. Without a sensor Greenr refuses to invent
 * measurements — instead it works from things that are actually known:
 *   • when the user last watered (asked at registration, updated by logs),
 *   • the species' typical drying cadence (category baseline, adjusted for
 *     pot size/material and season),
 *   • the user's own logged watering rhythm (once ≥3 logs, the learned gap
 *     outweighs the baseline).
 * Everything it returns is explicitly an estimate and says why.
 */

/** Typical days between waterings, per category, for a medium indoor pot. */
const TYPICAL_DAYS: Record<CategoryKey, number> = {
  tropical: 7,
  fern: 4,
  palm: 8,
  succulent: 14,
  cactus: 21,
  vine: 7,
  tree: 9,
  herb: 3,
  vegetable: 2,
  flowering: 5,
  orchid: 7,
  grass: 5,
  carnivorous: 4,
};

const DAY = 86400000;

export interface EstimateSchedule {
  status: 'unknown' | 'due' | 'scheduled';
  /** days between waterings this plant is expected to want */
  intervalDays: number;
  /** true once the interval comes from the user's own logged rhythm */
  learned: boolean;
  lastWateredAt: Date | null;
  daysSinceWater: number | null;
  dueAt: Date | null;
  /** "Likely due now" / "Likely due Sat, Jul 12" / "Log a watering to start" */
  whenLabel: string;
  /** the WHY, in plain words */
  detail: string;
}

function intervalFor(plant: Plant, now: Date): { days: number; learned: boolean } {
  const species = getSpecies(plant.species);
  const category = species?.category ?? 'tropical';
  let days = TYPICAL_DAYS[category];

  // Pot: small pots dry faster, big ones slower; terracotta breathes.
  if (plant.potSize === 'S') days *= 0.8;
  if (plant.potSize === 'L') days *= 1.25;
  if (plant.potMaterial === 'Terracotta') days *= 0.85;
  if (plant.potMaterial === 'Plastic') days *= 1.1;

  // Winter dormancy stretches the gap (species-specific reduction).
  const month = now.getMonth(); // 0-based
  const winter = month === 10 || month === 11 || month === 0 || month === 1;
  const reduction = species?.care.moisture.winterReductionPct ?? 30;
  if (winter && reduction > 0) days *= 1 + reduction / 100;

  // Learned rhythm: with ≥3 logged waterings, the user's own average gap
  // (clamped to a sane multiple of the baseline) takes over.
  const log = (plant.waterLog ?? [])
    .map((w) => new Date(w.at).getTime())
    .sort((a, b) => a - b);
  if (log.length >= 3) {
    const gaps: number[] = [];
    for (let i = 1; i < log.length; i++) gaps.push((log[i] - log[i - 1]) / DAY);
    const recent = gaps.slice(-4);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    if (avg >= days * 0.35 && avg <= days * 3) {
      return { days: Math.round(avg * 10) / 10, learned: true };
    }
  }

  return { days: Math.round(days * 10) / 10, learned: false };
}

export function estimateWaterSchedule(plant: Plant, nowMs: number = Date.now()): EstimateSchedule {
  const now = new Date(nowMs);
  const { days: intervalDays, learned } = intervalFor(plant, now);

  const lastIso =
    plant.lastWateredAt ??
    (plant.waterLog?.length
      ? [...plant.waterLog].sort((a, b) => +new Date(b.at) - +new Date(a.at))[0].at
      : null);

  if (!lastIso) {
    return {
      status: 'unknown',
      intervalDays,
      learned,
      lastWateredAt: null,
      daysSinceWater: null,
      dueAt: null,
      whenLabel: 'Log a watering to start',
      detail: `${plant.species} typically wants water about every ${Math.round(intervalDays)} days — log a watering and Greenr will time it from there.`,
    };
  }

  const last = new Date(lastIso);
  const daysSince = Math.max(0, Math.floor((nowMs - last.getTime()) / DAY));
  const dueAt = new Date(last.getTime() + intervalDays * DAY);
  const msUntil = dueAt.getTime() - nowMs;
  const basis = learned
    ? `your own rhythm (~every ${Math.round(intervalDays)} days from your logs)`
    : `what ${plant.species} typically needs (~every ${Math.round(intervalDays)} days)`;

  if (msUntil <= 0) {
    const overdueDays = Math.floor(-msUntil / DAY);
    return {
      status: 'due',
      intervalDays,
      learned,
      lastWateredAt: last,
      daysSinceWater: daysSince,
      dueAt,
      whenLabel: 'Likely due now',
      detail: `Last watered ${daysSince} day${daysSince === 1 ? '' : 's'} ago${overdueDays >= 1 ? ` — ${overdueDays} day${overdueDays === 1 ? '' : 's'} past` : ' — right at'} ${basis}. Check the soil: if the top feels dry, water.`,
    };
  }

  const dueDays = msUntil / DAY;
  const whenLabel =
    dueDays < 1.5
      ? 'Likely due tomorrow'
      : `Likely due ${dueAt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`;
  return {
    status: 'scheduled',
    intervalDays,
    learned,
    lastWateredAt: last,
    daysSinceWater: daysSince,
    dueAt,
    whenLabel,
    detail: `Last watered ${daysSince === 0 ? 'today' : `${daysSince} day${daysSince === 1 ? '' : 's'} ago`}; based on ${basis}. Estimate — a sensor makes this exact.`,
  };
}

export interface QualitativeNeed {
  icon: string; // Ionicons name
  text: string;
}

/**
 * What a sensorless plant needs, in honest words — light/humidity/temperature
 * described the way a person can act on them, never as fake measurements
 * ("wants humid air", not "keep RH at 55%"). Only lines that matter for THIS
 * species are included.
 */
export function qualitativeNeeds(speciesCommon: string): QualitativeNeed[] {
  const s = getSpecies(speciesCommon);
  if (!s) return [];
  const out: QualitativeNeed[] = [];

  // Light — from the profile's own label, phrased as placement advice.
  const lightLabel = s.care.light.label.toLowerCase();
  out.push({
    icon: 'sunny-outline',
    text: lightLabel.includes('full sun') || lightLabel.includes('direct')
      ? `Wants ${lightLabel} — the brightest window you have, or outdoors in season.`
      : lightLabel.includes('low')
        ? `Happy in ${lightLabel} — fine away from windows.`
        : `Likes ${lightLabel} — near a window, out of harsh midday sun.`,
  });

  // Humidity — only when the species actually cares.
  if (s.rhFloor >= 60) {
    out.push({ icon: 'water-outline', text: 'Wants humid air — bathrooms and kitchens suit it, or group plants / use a pebble tray.' });
  } else if (s.rhFloor >= 50) {
    out.push({ icon: 'water-outline', text: 'Prefers slightly humid air — keep it away from heaters and vents.' });
  } else if (s.rhFloor <= 30) {
    out.push({ icon: 'water-outline', text: 'Tolerates dry air — normal rooms are fine.' });
  }

  // Cold sensitivity — only when it's a real constraint.
  if (s.care.temperature.minF >= 55) {
    out.push({ icon: 'thermometer-outline', text: 'Cold-sensitive — keep it off chilly windowsills and away from drafts in winter.' });
  }

  return out.slice(0, 3);
}
