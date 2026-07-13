import type { Reading } from './devices';
import { idealsFor } from './plantStatus';

/**
 * Daylight averaging done properly. Two failure modes of a naive average:
 *   1. Every reading counted equally — unevenly spaced readings (a cluster in
 *      one hour, then a gap) skew the mean toward whenever readings happened to
 *      bunch up, not toward what the day was actually like.
 *   2. Night readings included — light is ~0 everywhere at 2 AM, which says
 *      nothing about the spot but drags the average down.
 * Fix: TIME-WEIGHTED average over DAYTIME ONLY (07:00–19:00 local). Each pair
 * of consecutive readings covers the span between them, clipped to daytime;
 * offline gaps (> 4.5 h) aren't bridged. Requires ≥ 5 h of observed daytime
 * before saying anything.
 */
const DAY_START_H = 7;
const DAY_END_H = 19;
const MS_H = 3600000;

/** Milliseconds of [a, b] that fall inside any 07:00–19:00 local window. */
function daytimeOverlap(a: number, b: number): number {
  if (b <= a) return 0;
  let total = 0;
  const d = new Date(a);
  d.setHours(0, 0, 0, 0);
  for (let day = d.getTime(); day < b; day += 86400000) {
    const s = day + DAY_START_H * MS_H;
    const e = day + DAY_END_H * MS_H;
    total += Math.max(0, Math.min(b, e) - Math.max(a, s));
  }
  return total;
}

export interface DaytimeLight {
  /** time-weighted daytime average, 0–100 index */
  avg: number;
  /** hours of daytime actually observed in the window */
  coveredH: number;
}

/** Time-weighted daytime light average over the last ~26 h. Null until ≥5 h of daytime is covered. */
export function daytimeLightAvg(history: Reading[], now = Date.now()): DaytimeLight | null {
  const pts = history
    .filter((r) => r.light_lux != null)
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.light_lux as number }))
    .filter((p) => now - p.t < 26 * MS_H)
    .sort((x, y) => x.t - y.t);
  if (pts.length < 3) return null;

  let weighted = 0;
  let weight = 0;
  for (let i = 1; i < pts.length; i++) {
    const gap = pts[i].t - pts[i - 1].t;
    if (gap > 4.5 * MS_H) continue; // sensor was offline — don't invent hours
    const ov = daytimeOverlap(pts[i - 1].t, pts[i].t);
    if (ov <= 0) continue;
    weighted += ((pts[i - 1].v + pts[i].v) / 2) * ov;
    weight += ov;
  }
  // The latest reading stands in for the stretch since it reported (≤ 3.5 h).
  const last = pts[pts.length - 1];
  const tailEnd = Math.min(now, last.t + 3.5 * MS_H);
  const tailOv = daytimeOverlap(last.t, tailEnd);
  if (tailOv > 0) {
    weighted += last.v * tailOv;
    weight += tailOv;
  }

  const coveredH = weight / MS_H;
  if (coveredH < 5) return null;
  return { avg: weighted / weight, coveredH };
}

/* ───────────────────── Multi-day accumulating light ─────────────────────
 * A single day's light is noisy: one cloudy day, or a day the sensor was mostly
 * offline, shouldn't swing the verdict. So instead of judging "in the moment",
 * Greenr snapshots each day's daytime average into storage and BLENDS the recent
 * days together. The more days observed, the steadier and more trustworthy the
 * number — accuracy compounds over time. */

export interface DayLight {
  /** local calendar day, YYYY-MM-DD */
  day: string;
  /** that day's time-weighted daytime average (0–100) */
  avg: number;
  /** daytime hours actually observed that day */
  hours: number;
}

/** Local calendar-day key (YYYY-MM-DD) for a timestamp. */
export function localDayKey(ms = Date.now()): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Time-weighted daytime light average for ONE local calendar day. Same weighting
 * as {@link daytimeLightAvg} but clipped to a single day, so it can be snapshotted
 * into storage as that day's contribution. Null until ≥2 h of daytime is covered.
 */
export function dayLight(history: Reading[], within = Date.now()): DayLight | null {
  const start = new Date(within);
  start.setHours(0, 0, 0, 0);
  const from = start.getTime();
  const to = from + 86400000;
  const pts = history
    .filter((r) => r.light_lux != null)
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.light_lux as number }))
    // include a point just before midnight so the morning span has a left edge
    .filter((p) => p.t >= from - 4.5 * MS_H && p.t < to)
    .sort((x, y) => x.t - y.t);
  if (pts.length < 2) return null;

  let weighted = 0;
  let weight = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].t - pts[i - 1].t > 4.5 * MS_H) continue; // offline gap — don't bridge
    const a = Math.max(pts[i - 1].t, from);
    const b = Math.min(pts[i].t, to);
    const ov = daytimeOverlap(a, b);
    if (ov <= 0) continue;
    weighted += ((pts[i - 1].v + pts[i].v) / 2) * ov;
    weight += ov;
  }
  // Latest reading stands for the stretch after it, bounded to today and to now.
  const last = pts[pts.length - 1];
  const tailEnd = Math.min(to, last.t + 3.5 * MS_H, Date.now());
  const tailOv = daytimeOverlap(Math.max(last.t, from), tailEnd);
  if (tailOv > 0) {
    weighted += last.v * tailOv;
    weight += tailOv;
  }

  const hours = weight / MS_H;
  if (hours < 2) return null;
  return { day: localDayKey(from), avg: weighted / weight, hours };
}

export interface LightAverage {
  /** blended multi-day daytime average (0–100) */
  avg: number;
  /** distinct days contributing */
  days: number;
  /** total daytime hours behind it */
  hours: number;
}

/**
 * Blend stored per-day light into one accumulating average. Each day is weighted
 * by the daylight hours it observed (a well-covered day counts more) and gently
 * by recency (recent days matter a little more — furniture moves, seasons turn).
 * `today` is the still-accumulating current day, folded in if provided. Returns
 * null until at least one day has data.
 */
export function recentLightAvg(
  daily: DayLight[],
  today?: DayLight | null,
  maxDays = 14,
): LightAverage | null {
  const byDay = new Map<string, DayLight>();
  for (const d of daily) if (d.hours > 0) byDay.set(d.day, d);
  if (today && today.hours > 0) byDay.set(today.day, today);
  const days = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)).slice(-maxDays);
  if (!days.length) return null;

  const n = days.length;
  let weighted = 0;
  let weight = 0;
  let hours = 0;
  days.forEach((d, i) => {
    const recency = 0.6 + 0.4 * (n === 1 ? 1 : i / (n - 1)); // 0.6 → 1.0 oldest→newest
    const w = d.hours * recency;
    weighted += d.avg * w;
    weight += w;
    hours += d.hours;
  });
  if (weight <= 0) return null;
  return { avg: weighted / weight, days: n, hours };
}

/**
 * Light benchmark: is this spot's DAYLIGHT right for this plant? Judged from
 * the time-weighted daytime average against what the species needs — including
 * "too bright" for shade plants, not just "too dim".
 */
export interface LightVerdict {
  tone: 'good' | 'warn' | 'bad';
  headline: string; // e.g. "Right spot — plenty of light"
  detail: string; // the numbers behind it, in words
  /** the daytime average behind the verdict (0–100) */
  avg: number;
}
export type LightBenchmark = LightVerdict;

/**
 * Turn a daytime light average (single- or multi-day) into a species-aware
 * verdict. `ctx` carries how much evidence is behind it so the wording can grow
 * more confident with more days.
 */
export function lightVerdict(
  avg0: number,
  species: string,
  dliBand: [number, number],
  ctx?: { days?: number; hours?: number },
): LightVerdict {
  const avg = Math.round(avg0);
  const wantsHigh = dliBand[1] >= 10; // sun-lovers
  const wantsLow = dliBand[1] <= 4; // shade plants

  let tone: LightVerdict['tone'];
  let headline: string;
  let needs: string;
  if (wantsHigh) {
    needs = 'strong, direct light';
    tone = avg >= 55 ? 'good' : avg >= 30 ? 'warn' : 'bad';
    headline =
      tone === 'good'
        ? 'Right spot — strong light through the day'
        : tone === 'warn'
          ? 'Borderline — it wants more direct light'
          : 'Too dim here for a sun-lover';
  } else if (wantsLow) {
    needs = 'low to medium light';
    tone = avg < 8 ? 'bad' : avg <= 60 ? 'good' : 'warn';
    headline =
      tone === 'bad'
        ? 'Very dark — even shade plants need some light'
        : tone === 'good'
          ? 'Right spot — gentle light suits it'
          : 'Brighter than it needs — watch for scorch';
  } else {
    needs = 'bright indirect light';
    tone = avg < 15 ? 'bad' : avg < 28 ? 'warn' : avg <= 75 ? 'good' : 'warn';
    headline =
      tone === 'bad'
        ? 'Too dim here for this plant'
        : tone === 'good'
          ? 'Right spot — bright enough through the day'
          : avg > 75
            ? 'Very intense — some midday shade would help'
            : 'A bit dim — a brighter spot would help';
  }

  const span =
    ctx?.days && ctx.days >= 2
      ? `across ${ctx.days} days of daylight`
      : ctx?.hours != null
        ? `across ~${Math.round(ctx.hours)} h of daylight`
        : 'so far';
  return {
    tone,
    headline,
    avg,
    detail: `Daytime light has averaged ${avg}/100 ${span} (nights excluded, readings weighted by the time they cover) — ${species} wants ${needs}.`,
  };
}

export function lightBenchmark(
  history: Reading[],
  species: string,
  dliBand: [number, number],
  now = Date.now(),
): LightBenchmark | null {
  const day = daytimeLightAvg(history, now);
  if (!day) return null;
  return lightVerdict(day.avg, species, dliBand, { hours: day.coveredH });
}

/**
 * The stored multi-day light average for a plant, shaped for the health engine's
 * `lightAvg` input (null when no days are recorded yet → health falls back to the
 * live reading). Aggregate screens use this so a plant's score is judged on the
 * same accumulating average the plant screen shows.
 */
export function storedLightAvg(daily: DayLight[] | undefined): { avg: number; days: number } | null {
  const a = recentLightAvg(daily ?? []);
  return a ? { avg: a.avg, days: a.days } : null;
}

/**
 * Learns from a plant's reading history and turns patterns into plain-language
 * insights ("This spot is consistently bright", "You water about every 4 days").
 * Returns [] until there's enough data — insight quality grows with history.
 */
export interface Insight {
  icon: string;
  text: string;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function insightsFor(history: Reading[], species: string, band: [number, number]): Insight[] {
  const out: Insight[] = [];
  if (history.length < 6) return out;
  const ideal = idealsFor(species, band);

  // Light pattern — daytime-only, time-weighted (nights excluded; sparse and
  // burst readings weighted by the hours they actually cover).
  const day = daytimeLightAvg(history);
  if (day) {
    const a = Math.round(day.avg);
    if (a >= 70) out.push({ icon: 'sunny', text: `This spot gets strong daylight (daytime average ${a}/100).` });
    else if (a < 25) out.push({ icon: 'moon', text: `Daytime here averages only ${a}/100 — ${species} may prefer brighter.` });
    else out.push({ icon: 'partly-sunny', text: `Daylight here is moderate and steady (daytime average ${a}/100).` });
  }

  // Watering cycle — detect refill events (soil jumps up) and measure the gap.
  const soils = history
    .filter((r) => r.soil_pct != null)
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.soil_pct as number }));
  const refills: number[] = [];
  for (let i = 1; i < soils.length; i++) {
    if (soils[i].v - soils[i - 1].v > 12) refills.push(soils[i].t);
  }
  if (refills.length >= 2) {
    const gaps = refills.slice(1).map((t, i) => (t - refills[i]) / 864e5);
    const days = Math.round(avg(gaps));
    if (days >= 1) out.push({ icon: 'water', text: `You water ${species} about every ${days} day${days > 1 ? 's' : ''} — I'll time reminders to that.` });
  }

  // Temperature vs ideal
  const temps = history.map((r) => r.temp_c).filter((v): v is number => v != null);
  if (temps.length >= 6) {
    const aF = (avg(temps) * 9) / 5 + 32;
    if (aF < ideal.temp[0]) out.push({ icon: 'thermometer', text: `Runs cooler than ${species} likes (avg ${Math.round(aF)}°F).` });
    else if (aF > ideal.temp[1]) out.push({ icon: 'thermometer', text: `Runs warm here (avg ${Math.round(aF)}°F) — watch for faster drying.` });
  }

  // Humidity vs ideal
  const hums = history.map((r) => r.humidity_pct).filter((v): v is number => v != null);
  if (hums.length >= 6) {
    const a = avg(hums);
    if (a < ideal.rhFloor - 8) out.push({ icon: 'rainy', text: `Humidity averages ${Math.round(a)}% — below ${species}'s comfort; grouping plants or a humidifier helps.` });
  }

  return out;
}
