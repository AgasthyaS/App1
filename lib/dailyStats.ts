import { bridgeGapH, type Reading } from './devices';
import { localDayKey } from './insights';

/**
 * Day-level averages for every metric, not just light.
 *
 * A single reading is a snapshot: soil right after watering, temperature at the
 * moment the afternoon sun hit the shelf, humidity while the kitchen was steamy.
 * Judging a plant on snapshots makes the app twitchy and, worse, misleading. A
 * DAY is the honest unit — it smooths the spikes while still reflecting real
 * conditions, and it gets more trustworthy the longer a sensor runs.
 *
 * Readings are TIME-WEIGHTED (each pair covers the span between them), so an
 * unevenly spaced trace — a burst of readings in one hour, then a gap — doesn't
 * skew the average toward whenever readings happened to bunch up. Offline gaps
 * longer than MAX_GAP_H aren't bridged, because we genuinely don't know what
 * happened while the sensor was dark.
 */

const MS_H = 3600000;

export type MetricKey = 'soil' | 'temp' | 'humidity' | 'light';

const FIELD: Record<MetricKey, keyof Reading> = {
  soil: 'soil_pct',
  temp: 'temp_c',
  humidity: 'humidity_pct',
  light: 'light_lux',
};

export interface DayStat {
  /** local calendar day, YYYY-MM-DD */
  day: string;
  avg: number;
  min: number;
  max: number;
  /** hours of the day actually covered by readings */
  hours: number;
}

/** Time-weighted daily averages for one metric, oldest day first. */
export function dailyStats(history: Reading[], metric: MetricKey, maxDays = 14): DayStat[] {
  const field = FIELD[metric];
  const pts = history
    .filter((r) => r[field] != null)
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: Number(r[field]) }))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return [];

  const byDay = new Map<string, { weighted: number; weight: number; min: number; max: number }>();
  const add = (day: string, value: number, hours: number) => {
    const d = byDay.get(day) ?? { weighted: 0, weight: 0, min: value, max: value };
    d.weighted += value * hours;
    d.weight += hours;
    d.min = Math.min(d.min, value);
    d.max = Math.max(d.max, value);
    byDay.set(day, d);
  };

  /*
   * HOW BIG A GAP COUNTS AS THE SENSOR BEING OFFLINE — and it cannot be a constant.
   *
   * This was a flat 4.5 hours, which is the right allowance for a sensor
   * reporting every three: one interval plus slack. It is catastrophically wrong
   * for any other cadence. A sensor set to report every SIX hours has every
   * single one of its gaps rejected as an outage, so no interval is ever
   * counted, every day weighs zero, and this function returns an EMPTY ARRAY.
   * Not wrong numbers — no numbers.
   *
   * That went from theoretical to live the moment the app grew a control for the
   * reporting interval: choosing "Every 6 hours" or "Once a day" silently
   * emptied the daily averages, the multi-day light verdict, and the whole
   * day-and-season record, with nothing anywhere to say why.
   *
   * So the allowance is measured from what this sensor actually does. The median
   * gap is its real cadence — robust to the odd missed report, unlike a mean —
   * and anything up to half again as long is a normal interval rather than an
   * outage. The 4.5-hour floor is kept so a fast-reporting sensor still bridges
   * a short hiccup.
   */
  const maxGapH = bridgeGapH(pts.map((p) => p.t));

  for (let i = 1; i < pts.length; i++) {
    const gapH = (pts[i].t - pts[i - 1].t) / MS_H;
    if (gapH > maxGapH) continue;                   // sensor was offline — don't invent hours
    // Attribute the span to the day it started in; spans are short relative to a
    // day, so this stays accurate without splitting across midnight.
    add(localDayKey(pts[i - 1].t), (pts[i - 1].v + pts[i].v) / 2, gapH);
  }

  return [...byDay.entries()]
    .map(([day, d]) => ({
      day,
      avg: d.weighted / d.weight,
      min: d.min,
      max: d.max,
      hours: d.weight,
    }))
    // A day with only minutes of data says nothing. A daily-reporting sensor
    // legitimately attributes a whole span to the day it started in, so this bar
    // stays low rather than excluding that cadence altogether.
    .filter((d) => d.hours >= 1)
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .slice(-maxDays);
}

export interface MetricSummary {
  /** blended average across the observed days */
  avg: number;
  /** how many days contributed — confidence grows with this */
  days: number;
  /** coldest/driest and warmest/wettest day averages seen */
  low: number;
  high: number;
  /** true once there's enough history to trust the number */
  reliable: boolean;
}

/**
 * Blend recent days into one figure, weighting each day by how well it was
 * covered and leaning slightly toward recent days (rooms and seasons change).
 * Null until at least one day has real data.
 */
export function summarize(days: DayStat[]): MetricSummary | null {
  if (!days.length) return null;
  const n = days.length;
  let weighted = 0;
  let weight = 0;
  days.forEach((d, i) => {
    const recency = 0.6 + 0.4 * (n === 1 ? 1 : i / (n - 1));
    const w = d.hours * recency;
    weighted += d.avg * w;
    weight += w;
  });
  return {
    avg: weighted / weight,
    days: n,
    low: Math.min(...days.map((d) => d.avg)),
    high: Math.max(...days.map((d) => d.avg)),
    reliable: n >= 3,
  };
}

/** Convenience: the multi-day summary for one metric straight from history. */
export function metricSummary(history: Reading[], metric: MetricKey, maxDays = 14): MetricSummary | null {
  return summarize(dailyStats(history, metric, maxDays));
}

/** How today compares with the recent norm — the useful part of an average. */
export function compareToNorm(today: number, norm: MetricSummary | null): string | null {
  if (!norm || !norm.reliable) return null;
  const diff = today - norm.avg;
  const pct = Math.abs(diff);
  if (pct < 3) return 'about the same as its usual';
  return diff > 0
    ? `${Math.round(pct)} higher than its ${norm.days}-day average`
    : `${Math.round(pct)} lower than its ${norm.days}-day average`;
}
