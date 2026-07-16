import type { Reading } from './devices';
import { idealsFor } from './plantStatus';

/**
 * The metric rating system. Every sensor metric is judged two ways:
 *   • per DAY — "how did Tuesday go?" (tap a day to see it), and
 *   • on the AVERAGE across recent days — the plant's real rating, which gets
 *     steadier and more trustworthy the more days it accumulates.
 * A single reading is weather; the multi-day average is climate. Ranks come
 * from the species' own ideal ranges (lib/plants.ts), never generic numbers.
 */

export type Grade = 'excellent' | 'good' | 'fair' | 'poor';

export const GRADE_WORD: Record<Grade, string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
};

/** Higher is better (for averaging grades into an overall rank). */
export const GRADE_SCORE: Record<Grade, number> = { excellent: 4, good: 3, fair: 2, poor: 1 };

/** Distance outside the ideal → grade. `soft` = how far outside counts as fully bad. */
function gradeFromDelta(delta: number, soft: number): Grade {
  if (delta <= 0) return 'excellent';
  if (delta <= soft * 0.33) return 'good';
  if (delta <= soft * 0.66) return 'fair';
  return 'poor';
}

function gradeRange(v: number, lo: number, hi: number, soft: number): Grade {
  const d = v < lo ? lo - v : v > hi ? v - hi : 0;
  return gradeFromDelta(d, soft);
}

export interface DayRating {
  /** local calendar day, YYYY-MM-DD */
  day: string;
  /** short label, e.g. "Mon 14" */
  label: string;
  /** that day's average value (display units) */
  avg: number;
  grade: Grade;
  /** number of readings behind it */
  n: number;
}

export type MetricKey = 'soil' | 'light' | 'temperature' | 'humidity';

export interface MetricRating {
  key: MetricKey;
  label: string;
  unit: string;
  icon: string; // Ionicons name
  /** newest reading (display units), null if the sensor hasn't reported it */
  current: number | null;
  /** average across all rated days (display units) */
  average: number | null;
  /** the plant's real rating for this metric — the grade of the multi-day average */
  grade: Grade | null;
  /** per-day breakdown, oldest → newest */
  days: DayRating[];
  /** the ideal it's judged against, in words */
  idealText: string;
}

const DAY_MS = 86400000;

function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(key: string): string {
  const d = new Date(`${key}T12:00:00`);
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
}

/** Group readings of one metric into per-day averages (daytime-only for light). */
function perDay(
  history: Reading[],
  pick: (r: Reading) => number | null,
  opts: { daytimeOnly?: boolean; maxDays?: number } = {},
): { day: string; avg: number; n: number }[] {
  const byDay = new Map<string, { sum: number; n: number }>();
  for (const r of history) {
    const v = pick(r);
    if (v == null) continue;
    const t = new Date(r.created_at).getTime();
    if (opts.daytimeOnly) {
      const h = new Date(t).getHours();
      if (h < 7 || h >= 19) continue; // night light readings say nothing about the spot
    }
    const k = dayKey(t);
    const cur = byDay.get(k) ?? { sum: 0, n: 0 };
    cur.sum += v;
    cur.n += 1;
    byDay.set(k, cur);
  }
  return [...byDay.entries()]
    .map(([day, { sum, n }]) => ({ day, avg: sum / n, n }))
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .slice(-(opts.maxDays ?? 14));
}

/**
 * Rate all four metrics from real history. Light uses daytime readings only;
 * temperature respects the user's units. Each metric carries per-day grades
 * plus the average-of-days grade — the plant's real rating.
 */
export function rateMetrics(
  history: Reading[],
  species: string,
  band: [number, number],
  unitsF = true,
): MetricRating[] {
  const ideal = idealsFor(species, band);
  const [lo, hi] = ideal.band;
  const soilSoft = Math.max(8, hi - lo);
  const latest = history.length ? history[history.length - 1] : null;

  const toDisplayTemp = (c: number) => (unitsF ? (c * 9) / 5 + 32 : c);
  const tempLoF = ideal.temp[0];
  const tempHiF = ideal.temp[1];

  // light band on the relative 0–100 index, derived from the species' DLI wants
  const wantsHigh = ideal.dli[1] >= 10;
  const wantsLow = ideal.dli[1] <= 4;
  const lightLo = wantsHigh ? 55 : wantsLow ? 8 : 25;
  const lightHi = wantsLow ? 60 : wantsHigh ? 100 : 75;

  const build = (
    key: MetricKey,
    label: string,
    unit: string,
    icon: string,
    pick: (r: Reading) => number | null,
    gradeOf: (v: number) => Grade,
    idealText: string,
    opts: { daytimeOnly?: boolean; toDisplay?: (v: number) => number } = {},
  ): MetricRating => {
    const disp = opts.toDisplay ?? ((v: number) => v);
    const raw = perDay(history, pick, { daytimeOnly: opts.daytimeOnly });
    const days: DayRating[] = raw.map((d) => ({
      day: d.day,
      label: dayLabel(d.day),
      avg: Math.round(disp(d.avg) * 10) / 10,
      grade: gradeOf(d.avg),
      n: d.n,
    }));
    // Average of the day-averages (each day counts once — a burst of readings
    // in one hour can't outvote a whole other day).
    const average = raw.length
      ? raw.reduce((a, d) => a + d.avg, 0) / raw.length
      : null;
    const cur = latest ? pick(latest) : null;
    return {
      key,
      label,
      unit,
      icon,
      current: cur != null ? Math.round(disp(cur) * 10) / 10 : null,
      average: average != null ? Math.round(disp(average) * 10) / 10 : null,
      grade: average != null ? gradeOf(average) : null,
      days,
      idealText,
    };
  };

  return [
    build(
      'soil', 'Soil moisture', '%', 'water',
      (r) => r.soil_pct,
      (v) => gradeRange(v, lo, hi, soilSoft),
      `${species} wants ${lo}–${hi}% soil moisture`,
    ),
    build(
      'light', 'Light', '/100', 'sunny',
      (r) => r.light_lux,
      (v) => gradeRange(v, lightLo, lightHi, 30),
      wantsHigh
        ? `${species} wants strong daytime light (55+/100)`
        : wantsLow
          ? `${species} is happy in gentle light (8–60/100)`
          : `${species} wants bright indirect daylight (25–75/100)`,
      { daytimeOnly: true },
    ),
    build(
      'temperature', 'Temperature', unitsF ? '°F' : '°C', 'thermometer',
      (r) => r.temp_c,
      (v) => gradeRange((v * 9) / 5 + 32, tempLoF, tempHiF, 12),
      `${species} is comfortable at ${tempLoF}–${tempHiF}°F`,
      { toDisplay: toDisplayTemp },
    ),
    build(
      'humidity', 'Humidity', '%', 'rainy',
      (r) => r.humidity_pct,
      (v) => gradeRange(v, ideal.rhFloor, 85, 25),
      `${species} wants at least ${ideal.rhFloor}% humidity`,
    ),
  ];
}

/** One overall rank across the rated metrics (null until something is rated). */
export function overallGrade(ratings: MetricRating[]): { grade: Grade; word: string } | null {
  const graded = ratings.filter((r) => r.grade != null) as (MetricRating & { grade: Grade })[];
  if (!graded.length) return null;
  const score = graded.reduce((a, r) => a + GRADE_SCORE[r.grade], 0) / graded.length;
  const grade: Grade = score >= 3.5 ? 'excellent' : score >= 2.75 ? 'good' : score >= 1.75 ? 'fair' : 'poor';
  return { grade, word: GRADE_WORD[grade] };
}
