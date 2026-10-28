import { getSpecies, type CategoryKey } from './plants';
import { currentSeason, SEASON_LABEL, seasonIntervalFactor } from './season';
import type { Plant } from './types';
import { soilLiters } from './watering';

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
  shrub: 7,
  bulb: 5,
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

/** One input to the estimated interval, in words — for the "Why this date" breakdown. */
export interface IntervalFactor {
  label: string;
  effect: string;
}

interface IntervalResult {
  days: number;
  learned: boolean;
  /** the species/pot/season interval before the owner's own rhythm is considered */
  baseline: number;
  factors: IntervalFactor[];
  /** waterings behind the learned rhythm */
  logs: number;
}

const pct = (f: number) => `${f > 1 ? '+' : '−'}${Math.round(Math.abs(f - 1) * 100)}%`;

function intervalFor(plant: Plant, now: Date): IntervalResult {
  const species = getSpecies(plant.species);
  const category = species?.category ?? 'tropical';
  let days = TYPICAL_DAYS[category];
  const factors: IntervalFactor[] = [
    { label: `${species?.common ?? 'This plant'} (${category})`, effect: `typically about every ${days} days` },
  ];

  // Pot: small pots dry faster, big ones slower; terracotta breathes. With a
  // measured diameter the soil volume drives it (same species, bigger pot =
  // longer between waterings), otherwise the S/M/L bucket.
  const liters = soilLiters(plant.potSize, plant.potCm);
  if (liters < 1.8) {
    days *= 0.8;
    factors.push({ label: 'Small pot', effect: `dries faster · ${pct(0.8)}` });
  } else if (liters > 4.5) {
    days *= 1.25;
    factors.push({ label: 'Large pot', effect: `holds more · ${pct(1.25)}` });
  }
  if (plant.potMaterial === 'Terracotta') {
    days *= 0.85;
    factors.push({ label: 'Terracotta', effect: `breathes through its walls · ${pct(0.85)}` });
  }
  if (plant.potMaterial === 'Plastic') {
    days *= 1.1;
    factors.push({ label: 'Plastic pot', effect: `holds moisture · ${pct(1.1)}` });
  }

  // Season reshapes the cycle year-round: winter dormancy stretches it (using
  // the species' own reduction when known), summer growth shortens it.
  const season = currentSeason(now);
  const f = season === 'winter'
    // Default 35% so a species with no figure of its own gets the same ×1.35
    // the season table gives every other path, not a slightly different ×1.30.
    ? 1 + Math.max(0, species?.care.moisture.winterReductionPct ?? 35) / 100
    : seasonIntervalFactor(season);
  if (f !== 1) {
    days *= f;
    factors.push({ label: SEASON_LABEL[season], effect: f > 1 ? `slower growth · ${pct(f)}` : `faster growth · ${pct(f)}` });
  }
  const baseline = Math.round(days * 10) / 10;

  // Learned rhythm: with ≥3 logged waterings, the user's own average gap takes
  // over — but only within a sane band around the baseline. The lower bound is
  // 0.6× rather than looser because watering far too often must not become the
  // schedule: that is how an over-watering habit would get "learned" and then
  // reinforced by the reminders. `overwateringCheck` reports it instead.
  const log = (plant.waterLog ?? [])
    .map((w) => new Date(w.at).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (log.length >= 3) {
    const gaps: number[] = [];
    for (let i = 1; i < log.length; i++) gaps.push((log[i] - log[i - 1]) / DAY);
    const recent = gaps.slice(-4);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    if (avg >= days * 0.6 && avg <= days * 3) {
      return {
        days: Math.round(avg * 10) / 10,
        learned: true,
        baseline,
        logs: log.length,
        factors: [...factors, { label: 'Your own rhythm', effect: `${log.length} logged waterings average every ${avg.toFixed(1)} days, so Greenr uses that` }],
      };
    }
  }

  return { days: baseline, learned: false, baseline, factors, logs: log.length };
}

export interface EstimateBreakdown {
  intervalDays: number;
  baselineDays: number;
  learned: boolean;
  factors: IntervalFactor[];
  lastWateredAt: Date | null;
  confidence: 'High' | 'Medium' | 'Low';
  confidenceWhy: string;
}

/**
 * WHY THIS DATE — the inputs behind a sensorless watering date, stated rather
 * than adjustable: the last watering, the species' interval, the pot and the
 * season, and how much to trust the result.
 */
export function estimateBreakdown(plant: Plant, nowMs: number = Date.now()): EstimateBreakdown {
  const r = intervalFor(plant, new Date(nowMs));
  const lastIso =
    plant.lastWateredAt ??
    (plant.waterLog?.length ? [...plant.waterLog].sort((a, b) => +new Date(b.at) - +new Date(a.at))[0].at : null);
  const last = lastIso ? new Date(lastIso) : null;
  const lastOk = last != null && Number.isFinite(last.getTime());
  const confidence: EstimateBreakdown['confidence'] = !lastOk ? 'Low' : r.learned ? 'High' : 'Medium';
  return {
    intervalDays: r.days,
    baselineDays: r.baseline,
    learned: r.learned,
    factors: r.factors,
    lastWateredAt: lastOk ? last : null,
    confidence,
    confidenceWhy:
      confidence === 'High'
        ? `Based on your own ${r.logs} logged waterings.`
        : confidence === 'Medium'
          ? 'Based on what this species usually needs. Three logged waterings switch it to your own rhythm.'
          : 'No watering logged yet, so there is no date to count from.',
  };
}

export interface OverwateringWarning {
  /** median days between recent waterings */
  gapDays: number;
  /** what the species, pot and season call for */
  intervalDays: number;
  waterings: number;
  text: string;
}

/**
 * WATERING FAR MORE OFTEN THAN THE PLANT NEEDS.
 *
 * Over-watering is the most common way houseplants die, and a sensorless plant
 * has no soil reading to raise the alarm. What it does have is the log: if the
 * recent gaps between waterings are under half the interval this species, pot
 * and season call for, the roots are very likely sitting wet.
 *
 * Duplicate taps within six hours count once, so a double-logged watering is not
 * mistaken for two.
 */
export function overwateringCheck(plant: Plant, nowMs: number = Date.now()): OverwateringWarning | null {
  const r = intervalFor(plant, new Date(nowMs));
  const windowMs = Math.max(14, r.baseline * 3) * DAY;
  const times = (plant.waterLog ?? [])
    .map((w) => new Date(w.at).getTime())
    .filter((t) => Number.isFinite(t) && nowMs - t <= windowMs)
    .sort((a, b) => a - b)
    .filter((t, i, a) => i === 0 || t - a[i - 1] > 6 * 3600000);
  if (times.length < 3) return null;
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) gaps.push((times[i] - times[i - 1]) / DAY);
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median >= r.baseline * 0.5) return null;
  const name = typeof plant.species === 'string' && plant.species.trim() ? plant.species.trim() : 'This plant';
  return {
    gapDays: Math.round(median * 10) / 10,
    intervalDays: r.baseline,
    waterings: times.length,
    text: `You have watered ${times.length} times recently, about every ${median < 1.5 ? 'day' : `${Math.round(median)} days`}. ${name} in this pot needs water about every ${Math.round(r.baseline)} days right now, so the roots are probably staying wet. Let the top of the soil dry out before the next drink.`,
  };
}

export function estimateWaterSchedule(plant: Plant, nowMs: number = Date.now()): EstimateSchedule {
  /*
   * A plant can reach here without a species — mid-add, or restored from an
   * older store — and the name goes straight into prose. Interpolated raw it
   * read "48 days past what undefined typically needs", which is the kind of
   * sentence that destroys trust in every other number on the screen.
   */
  const speciesName = typeof plant.species === 'string' && plant.species.trim()
    ? plant.species.trim()
    : 'this plant';
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
      detail: `${speciesName} typically wants water about every ${Math.round(intervalDays)} days — log a watering and Greenr will time it from there.`,
    };
  }

  const last = new Date(lastIso);
  /*
   * A corrupt `waterLog[].at` makes this NaN, and NaN survives `Math.max` and
   * `Math.floor` untouched — so it reached the owner as "Last watered NaN days
   * ago". An unparseable date is not a date: fall back to the no-history answer.
   */
  if (!Number.isFinite(last.getTime())) {
    return {
      status: 'unknown',
      intervalDays,
      learned,
      lastWateredAt: null,
      daysSinceWater: null,
      dueAt: null,
      whenLabel: 'Log a watering to start timing',
      detail: `${speciesName} typically wants water about every ${Math.round(intervalDays)} days — log a watering and Greenr will time it from there.`,
    };
  }
  const daysSince = Math.max(0, Math.floor((nowMs - last.getTime()) / DAY));
  const dueAt = new Date(last.getTime() + intervalDays * DAY);
  const msUntil = dueAt.getTime() - nowMs;
  const basis = learned
    ? `your own rhythm (~every ${Math.round(intervalDays)} days from your logs)`
    : `what ${speciesName} typically needs (~every ${Math.round(intervalDays)} days)`;

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
    detail: `Last watered ${daysSince === 0 ? 'today' : `${daysSince} day${daysSince === 1 ? '' : 's'} ago`}; based on ${basis}.`,
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
