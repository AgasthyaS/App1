import { dailyStats, type MetricKey } from './dailyStats';
import type { Reading } from './devices';
import { currentSeason, SEASON_LABEL, type Season } from './season';

/**
 * WHAT THIS PLANT HAS ACTUALLY LIVED THROUGH — by the day, and by the season.
 *
 * Everything else in this app answers "how is it right now". That is the urgent
 * question and it is not the only one. A grower wants to know what last July
 * looked like against this one, whether the radiator that comes on in November
 * is really drying the pot faster, whether the plant that sulked all winter was
 * cold or dark. Those are questions about a RECORD, and the app was not keeping
 * one.
 *
 * ─────────────────────────── WHY A SEPARATE STORE ────────────────────────────
 *
 * The reading snapshot holds thirty days. That is the right window for the
 * watering model — it needs two full dry-down cycles and no more — but it means
 * every reading older than a month is gone, so a seasonal comparison was not
 * merely missing, it was impossible. Thirty days cannot contain two summers.
 *
 * Raw readings are far too much to keep: a sensor reporting three-hourly
 * produces about 2 900 rows a year per plant, and a garden of ten plants would
 * be storing 29 000 rows on the device to answer a question about averages. So
 * what is kept is one row per plant per day — the time-weighted average, the
 * minimum and the maximum for each metric — which is ~365 rows a plant a year
 * and answers the question exactly as well.
 *
 * Daily averages are also the honest unit for this, for the same reason
 * `dailyStats` gives: a single reading is a snapshot of whenever the sensor
 * happened to wake. Soil measured right after watering, temperature measured
 * when the afternoon sun crossed the shelf. The day smooths that without
 * flattening anything real.
 *
 * ──────────────────────────── ON MISSING DAYS ────────────────────────────────
 *
 * `hours` records how much of each day the sensor actually covered, and it is
 * kept rather than discarded because a day with four hours of readings and a day
 * with twenty-four should not carry the same weight in a seasonal average. A
 * summer where the sensor was flat for three weeks is not a cool summer, and
 * without the coverage figure it would look like one.
 */

/** Two years, so this summer can be set against the last two. */
const KEEP_DAYS = 760;
/** A day covered by less than this many hours of readings is too thin to average. */
const MIN_HOURS_FOR_DAY = 4;
/** …and a season needs this many usable days before its average means anything. */
const MIN_DAYS_FOR_SEASON = 10;

export interface DayRecord {
  /** local calendar day, YYYY-MM-DD */
  day: string;
  soil?: number; soilMin?: number; soilMax?: number;
  temp?: number; tempMin?: number; tempMax?: number;
  humidity?: number;
  light?: number;
  /** hours of the day the sensor actually covered */
  hours: number;
}

export interface SeasonSummary {
  /** e.g. "2026-summer" */
  key: string;
  season: Season;
  year: number;
  label: string;
  days: number;
  soil: number | null; soilMin: number | null; soilMax: number | null;
  temp: number | null; tempMin: number | null; tempMax: number | null;
  humidity: number | null;
  light: number | null;
  /** true when the sensor covered too little of it to trust */
  thin: boolean;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Fold the reading window down to one row per day.
 *
 * Called with whatever the snapshot holds; the caller merges the result into
 * what is already stored, so days drop out of the window without being lost.
 */
export function buildDayRecords(history: Reading[]): DayRecord[] {
  if (!history.length) return [];
  const metrics: MetricKey[] = ['soil', 'temp', 'humidity', 'light'];
  const byDay = new Map<string, DayRecord>();

  for (const metric of metrics) {
    for (const d of dailyStats(history, metric, KEEP_DAYS)) {
      const row = byDay.get(d.day) ?? { day: d.day, hours: 0 };
      // Coverage is the best any metric managed that day: a sensor reporting
      // soil but not temperature still covered the day.
      row.hours = Math.max(row.hours, round1(d.hours));
      if (metric === 'soil') {
        row.soil = round1(d.avg); row.soilMin = round1(d.min); row.soilMax = round1(d.max);
      } else if (metric === 'temp') {
        row.temp = round1(d.avg); row.tempMin = round1(d.min); row.tempMax = round1(d.max);
      } else if (metric === 'humidity') {
        row.humidity = round1(d.avg);
      } else {
        row.light = round1(d.avg);
      }
      byDay.set(d.day, row);
    }
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

/**
 * Merge new day rows into the stored history.
 *
 * Incoming rows win for days they cover, because they are computed from more
 * readings than whatever was stored earlier the same day — a day recorded at
 * breakfast covers a few hours, and by midnight the same day covers a full one.
 */
export function mergeDayRecords(stored: DayRecord[], incoming: DayRecord[]): DayRecord[] {
  if (!incoming.length) return stored;
  const map = new Map(stored.map((d) => [d.day, d]));
  for (const row of incoming) map.set(row.day, row);
  return [...map.values()]
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .slice(-KEEP_DAYS);
}

/** True when the merge would change nothing — so callers can skip a write. */
export function sameDayRecords(a: DayRecord[], b: DayRecord[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.day !== y.day || x.soil !== y.soil || x.temp !== y.temp
      || x.humidity !== y.humidity || x.light !== y.light || x.hours !== y.hours) return false;
  }
  return true;
}

/** One day, or null when it was never recorded. */
export function dayRecord(records: DayRecord[], day: string): DayRecord | null {
  return records.find((d) => d.day === day) ?? null;
}

/** The season a YYYY-MM-DD belongs to, with the year it falls in. */
function seasonOf(day: string): { season: Season; year: number } {
  const [y, m] = day.split('-').map((n) => parseInt(n, 10));
  const date = new Date(y, (m || 1) - 1, 1);
  const season = currentSeason(date);
  /*
   * December belongs to the winter that ENDS the following year, so a single
   * winter does not get split across two rows with a month in one and two in
   * the other — which would make both look like thin, unusable samples.
   */
  const year = season === 'winter' && m === 12 ? y + 1 : y;
  return { season, year };
}

/**
 * Averages per season, newest first.
 *
 * Averaged over DAYS rather than over readings, and weighted by how much of each
 * day the sensor covered — so a fortnight of silence in August cannot quietly
 * pull the summer average toward whatever the sensor saw either side of it.
 */
export function seasonSummaries(records: DayRecord[]): SeasonSummary[] {
  const groups = new Map<string, DayRecord[]>();
  for (const d of records) {
    if (d.hours < MIN_HOURS_FOR_DAY) continue;
    const { season, year } = seasonOf(d.day);
    const key = `${year}-${season}`;
    const g = groups.get(key);
    if (g) g.push(d); else groups.set(key, [d]);
  }

  const out: SeasonSummary[] = [];
  for (const [key, days] of groups) {
    const [yearStr, season] = key.split('-') as [string, Season];
    const wavg = (pick: (d: DayRecord) => number | undefined): number | null => {
      let sum = 0;
      let w = 0;
      for (const d of days) {
        const v = pick(d);
        if (v == null || !Number.isFinite(v)) continue;
        sum += v * d.hours;
        w += d.hours;
      }
      return w > 0 ? round1(sum / w) : null;
    };
    const lo = (pick: (d: DayRecord) => number | undefined): number | null => {
      const vs = days.map(pick).filter((v): v is number => v != null && Number.isFinite(v));
      return vs.length ? round1(Math.min(...vs)) : null;
    };
    const hi = (pick: (d: DayRecord) => number | undefined): number | null => {
      const vs = days.map(pick).filter((v): v is number => v != null && Number.isFinite(v));
      return vs.length ? round1(Math.max(...vs)) : null;
    };

    out.push({
      key,
      season,
      year: parseInt(yearStr, 10),
      label: `${SEASON_LABEL[season]} ${yearStr}`,
      days: days.length,
      soil: wavg((d) => d.soil),
      soilMin: lo((d) => d.soilMin ?? d.soil),
      soilMax: hi((d) => d.soilMax ?? d.soil),
      temp: wavg((d) => d.temp),
      tempMin: lo((d) => d.tempMin ?? d.temp),
      tempMax: hi((d) => d.tempMax ?? d.temp),
      humidity: wavg((d) => d.humidity),
      light: wavg((d) => d.light),
      thin: days.length < MIN_DAYS_FOR_SEASON,
    });
  }

  return out.sort((a, b) => (b.year - a.year) || SEASON_ORDER[b.season] - SEASON_ORDER[a.season]);
}

const SEASON_ORDER: Record<Season, number> = { winter: 0, spring: 1, summer: 2, fall: 3 };

/**
 * The same season a year ago, when there is one — the comparison people actually
 * want. "Warmer than last summer" means something; "warmer than last month" in
 * April means only that April follows March.
 */
export function sameSeasonLastYear(
  summaries: SeasonSummary[],
  current: SeasonSummary,
): SeasonSummary | null {
  return summaries.find((s) => s.season === current.season && s.year === current.year - 1) ?? null;
}

/** A sentence comparing two seasons, or null when there is nothing to say. */
export function seasonComparison(now: SeasonSummary, then: SeasonSummary | null): string | null {
  if (!then || now.thin || then.thin) return null;
  const bits: string[] = [];
  if (now.temp != null && then.temp != null) {
    const d = now.temp - then.temp;
    if (Math.abs(d) >= 1) {
      bits.push(`${Math.abs(d).toFixed(1)} °C ${d > 0 ? 'warmer' : 'cooler'}`);
    }
  }
  if (now.soil != null && then.soil != null) {
    const d = now.soil - then.soil;
    if (Math.abs(d) >= 3) {
      bits.push(`the soil sitting ${Math.abs(Math.round(d))} points ${d > 0 ? 'wetter' : 'drier'}`);
    }
  }
  if (now.humidity != null && then.humidity != null) {
    const d = now.humidity - then.humidity;
    if (Math.abs(d) >= 5) {
      bits.push(`air ${Math.abs(Math.round(d))}% ${d > 0 ? 'more humid' : 'drier'}`);
    }
  }
  if (!bits.length) return `Much the same as ${then.label.toLowerCase()}.`;
  return `Against ${then.label.toLowerCase()}: ${bits.join(', ')}.`;
}
