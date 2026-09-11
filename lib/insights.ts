import { bridgeGapH, OFFLINE_GAP_H, type Reading } from './devices';
import { plantLabel } from './format';
import { idealsFor } from './plantStatus';

/**
 * Daylight averaging done properly. Two failure modes of a naive average:
 *   1. Every reading counted equally — unevenly spaced readings (a cluster in
 *      one hour, then a gap) skew the mean toward whenever readings happened to
 *      bunch up, not toward what the day was actually like.
 *   2. Dark hours included — light is ~0 at 2 AM, which says nothing about the
 *      spot but drags the average down.
 * Fix: TIME-WEIGHTED average over hours the plant was actually LIT. Daylight
 * always counts (using the real local sunrise/sunset); dark hours count only
 * when a lamp or grow light is bright enough to feed the plant — see
 * USEFUL_LIGHT_MIN. Offline gaps aren't bridged, and a verdict needs enough
 * observed hours before it says anything.
 */
/**
 * When daylight actually starts and ends, for THIS user's location and date.
 *
 * A fixed 07:00–19:00 window is wrong nearly everywhere. In midwinter it counts
 * two hours of darkness as "daytime", dragging the average down and making a
 * decent spot look hopeless; in midsummer it misses real morning light. Both
 * errors grow the further you live from the equator.
 *
 * Set from the weather service's real sunrise/sunset for the user's coordinates
 * (see setDaylightWindow). Until that's known we fall back to 07:00–19:00, which
 * is a fair equinox approximation.
 */
let DAY_START_H = 7;
let DAY_END_H = 19;
const MS_H = 3600000;
/** Reading gaps beyond this (hours) mean the sensor was offline — derived from
 *  the reporting cadence, not a magic number. */
const GAP_H = OFFLINE_GAP_H;

/** Feed in today's real sunrise/sunset (ISO datetimes) from the weather data. */
export function setDaylightWindow(sunriseIso?: string | null, sunsetIso?: string | null): void {
  if (!sunriseIso || !sunsetIso) return;
  const a = new Date(sunriseIso);
  const b = new Date(sunsetIso);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return;
  const start = a.getHours() + a.getMinutes() / 60;
  const end = b.getHours() + b.getMinutes() / 60;
  if (end - start < 4 || end - start > 22) return; // guard polar day/night + bad parses
  DAY_START_H = start;
  DAY_END_H = end;
}

/** The daylight window in use, in local hours — daylight LENGTH matters as much
 *  as intensity, since a plant's daily light is intensity × hours. */
export function daylightWindow(): { start: number; end: number; hours: number } {
  return { start: DAY_START_H, end: DAY_END_H, hours: DAY_END_H - DAY_START_H };
}

/** True when this moment is after dark — never judge a spot's light at night. */
export function isNight(ms: number = Date.now()): boolean {
  const d = new Date(ms);
  const h = d.getHours() + d.getMinutes() / 60;
  return h < DAY_START_H || h >= DAY_END_H;
}

/**
 * Light bright enough to actually FEED the plant, on the 0–100 index.
 *
 * Above a plant's light compensation point, photosynthesis outpaces respiration
 * and the plant gains energy; below it, it slowly runs at a loss. For shade-
 * tolerant houseplants that point is roughly 200–500 lux. That matters at night,
 * because artificial light is real light: a grow light or a bright nearby lamp
 * genuinely feeds a plant after dark and should be counted.
 *
 * But ordinary evening room lighting (~50–150 lux) sits BELOW the compensation
 * point and contributes essentially nothing — counting it would inflate the
 * average and hide a spot that's genuinely too dark. So night-time light is
 * counted only when it clears this bar, which on our index is around the level
 * of a bright lamp or a grow light rather than ambient glow.
 */
export const USEFUL_LIGHT_MIN = 20;

/**
 * Milliseconds of [a, b] that count toward a plant's light, given the reading
 * over that span. Daylight always counts; darkness counts only when something
 * is genuinely lighting the plant (see USEFUL_LIGHT_MIN).
 */
function litOverlap(a: number, b: number, value: number): number {
  if (b <= a) return 0;
  if (value >= USEFUL_LIGHT_MIN) return b - a; // lit — real light, whatever the hour
  return daytimeOverlap(a, b);
}

/** True when this span was lit after dark — i.e. artificial light was in use. */
function isArtificial(a: number, b: number, value: number): boolean {
  return value >= USEFUL_LIGHT_MIN && litOverlap(a, b, value) > daytimeOverlap(a, b);
}

/** Milliseconds of [a, b] that fall inside the local daylight window. */
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
    .filter((r) => r.light_lux != null && Number.isFinite(r.light_lux))
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.light_lux as number }))
    .filter((p) => now - p.t < 26 * MS_H)
    .sort((x, y) => x.t - y.t);
  if (pts.length < 2) return null;

  // Measured from this sensor rather than assumed — see `bridgeGapH`.
  const gapLimitH = bridgeGapH(pts.map((p) => p.t));

  let weighted = 0;
  let weight = 0;
  for (let i = 1; i < pts.length; i++) {
    const gap = pts[i].t - pts[i - 1].t;
    if (gap > gapLimitH * MS_H) continue; // sensor was offline — don't invent hours
    const v = (pts[i - 1].v + pts[i].v) / 2;
    const ov = litOverlap(pts[i - 1].t, pts[i].t, v);
    if (ov <= 0) continue;
    weighted += v * ov;
    weight += ov;
  }
  // The latest reading stands in for the stretch since it reported (≤ 3.5 h).
  const last = pts[pts.length - 1];
  const tailEnd = Math.min(now, last.t + 3.5 * MS_H);
  const tailOv = litOverlap(last.t, tailEnd, last.v);
  if (tailOv > 0) {
    weighted += last.v * tailOv;
    weight += tailOv;
  }

  const coveredH = weight / MS_H;
  // 3 h of observed daylight is enough to say something — at a 3-hourly cadence
  // demanding 5 h meant the very first day produced nothing, which is what left
  // the Light metric reading "Awaiting daytime" indefinitely.
  if (coveredH < 3) return null;
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
  /** hours of usable light observed that day (daylight + bright artificial) */
  hours: number;
  /** true when some of that light came from lamps after dark */
  artificial?: boolean;
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
  // The whole trace decides the cadence, not just the slice inside this day —
  // a single day can hold too few readings to measure a median from.
  const windowGapH = bridgeGapH(
    history
      .map((r) => new Date(r.created_at).getTime())
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b),
  );
  const pts = history
    .filter((r) => r.light_lux != null && Number.isFinite(r.light_lux))
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.light_lux as number }))
    // include a point just before midnight so the morning span has a left edge
    .filter((p) => p.t >= from - windowGapH * MS_H && p.t < to)
    .sort((x, y) => x.t - y.t);
  if (pts.length < 2) return null;

  let weighted = 0;
  let weight = 0;
  let artificial = false;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].t - pts[i - 1].t > windowGapH * MS_H) continue; // offline gap — don't bridge
    const a = Math.max(pts[i - 1].t, from);
    const b = Math.min(pts[i].t, to);
    const v = (pts[i - 1].v + pts[i].v) / 2;
    const ov = litOverlap(a, b, v);
    if (ov <= 0) continue;
    if (isArtificial(a, b, v)) artificial = true;
    weighted += v * ov;
    weight += ov;
  }
  // Latest reading stands for the stretch after it, bounded to today and to now.
  const last = pts[pts.length - 1];
  const tailEnd = Math.min(to, last.t + 3.5 * MS_H, Date.now());
  const tailA = Math.max(last.t, from);
  const tailOv = litOverlap(tailA, tailEnd, last.v);
  if (tailOv > 0) {
    if (isArtificial(tailA, tailEnd, last.v)) artificial = true;
    weighted += last.v * tailOv;
    weight += tailOv;
  }

  const hours = weight / MS_H;
  if (hours < 2) return null;
  return { day: localDayKey(from), avg: weighted / weight, hours, artificial };
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
/**
 * The light index below which this species is genuinely under-lit (and above
 * which it's over-lit). Exposed so the confidence maths can test a real
 * threshold rather than re-deriving the verdict wording.
 */
export function lightThresholds(dliBand: [number, number]): { tooDark: number; tooBright: number } {
  const wantsHigh = dliBand[1] >= 10;
  const wantsLow = dliBand[1] <= 4;
  if (wantsHigh) return { tooDark: 30, tooBright: 101 }; // sun-lovers can't really get too much
  if (wantsLow) return { tooDark: 8, tooBright: 60 };
  return { tooDark: 15, tooBright: 75 };
}

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
    detail: `Daytime light has averaged ${avg}/100 ${span} (nights excluded, readings weighted by the time they cover) — ${plantLabel(species)} wants ${needs}.`,
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
    else if (a < 25) out.push({ icon: 'moon', text: `Daytime here averages only ${a}/100 — ${plantLabel(species)} may prefer brighter.` });
    else out.push({ icon: 'partly-sunny', text: `Daylight here is moderate and steady (daytime average ${a}/100).` });
  }

  // Watering cycle — detect refill events (soil jumps up) and measure the gap.
  const soils = history
    .filter((r) => r.soil_pct != null && Number.isFinite(r.soil_pct))
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.soil_pct as number }));
  const refills: number[] = [];
  for (let i = 1; i < soils.length; i++) {
    if (soils[i].v - soils[i - 1].v > 12) refills.push(soils[i].t);
  }
  if (refills.length >= 2) {
    const gaps = refills.slice(1).map((t, i) => (t - refills[i]) / 864e5);
    const days = Math.round(avg(gaps));
    if (days >= 1) out.push({ icon: 'water', text: `You water ${plantLabel(species)} about every ${days} day${days > 1 ? 's' : ''} — I'll time reminders to that.` });
  }

  // Temperature vs ideal
  // A non-finite temperature passes `!= null` and then poisons the average, which
  // reached the screen as "Runs warm here (avg Infinity°F)".
  const temps = history.map((r) => r.temp_c).filter((v): v is number => v != null && Number.isFinite(v));
  if (temps.length >= 6) {
    const aF = (avg(temps) * 9) / 5 + 32;
    if (aF < ideal.temp[0]) out.push({ icon: 'thermometer', text: `Runs cooler than ${plantLabel(species)} likes (avg ${Math.round(aF)}°F).` });
    else if (aF > ideal.temp[1]) out.push({ icon: 'thermometer', text: `Runs warm here (avg ${Math.round(aF)}°F) — watch for faster drying.` });
  }

  // Humidity vs ideal
  const hums = history.map((r) => r.humidity_pct).filter((v): v is number => v != null && Number.isFinite(v));
  if (hums.length >= 6) {
    const a = avg(hums);
    if (a < ideal.rhFloor - 8) out.push({ icon: 'rainy', text: `Humidity averages ${Math.round(a)}% — below ${plantLabel(species)}'s comfort; grouping plants or a humidifier helps.` });
  }

  return out;
}
