import type { Reading } from './devices';
import { weatherWateringImpact, type WeatherData } from './weather';

/**
 * Smart watering scheduling (§5). Turns soil-moisture history into an actual
 * predicted next-watering moment — "Check in 2 days 6 hours" or "Check Fri,
 * Jul 10 at 8:00 AM" — instead of a generic "check Friday". It estimates the
 * drying rate from recent readings and projects when soil crosses below the
 * species' ideal low. Every schedule states its basis (the WHY) and its
 * confidence, and can be exported as a calendar event.
 *
 * The sensor is ground truth; for OUTDOOR plants the live forecast then adjusts
 * the call (§10): a hot, dry, high-UV stretch speeds up drying and pulls the
 * date earlier, while incoming rain defers it (nature does the watering). So
 * device + weather produce one combined recommendation, not two.
 */

export interface ScheduleOpts {
  now?: number;
  weather?: WeatherData | null;
  outdoor?: boolean;
}

export interface WaterSchedule {
  status: 'overdue' | 'scheduled' | 'unknown';
  /** projected moment soil crosses below the ideal low (or now, if overdue) */
  nextWaterAt: Date | null;
  /** suggested check time: nextWaterAt pinned to 8:00 AM local of that day */
  checkAt: Date | null;
  /** drying speed, %/day (positive = drying that fast); null if not established */
  dryingRatePerDay: number | null;
  confidence: 'high' | 'low' | 'none';
  /** plain-language WHY, e.g. "Drying ~3%/day across your last 8 readings." */
  basis: string;
  /** "in 2 days 6 hours", "now", or "" when unknown */
  relativeLabel: string;
  /** the single action line, e.g. "Water today" / "Check Fri, Jul 10 at 8:00 AM" */
  whenLabel: string;
  /** how the forecast changed the call for an outdoor plant, if at all */
  weatherNote?: string;
}

const DAY = 86400000;

/** Least-squares slope of soil% vs time, in %/day. Null if too few points. */
function slopePerDay(points: { t: number; v: number }[]): number | null {
  if (points.length < 3) return null;
  const t0 = points[0].t;
  const xs = points.map((p) => (p.t - t0) / DAY);
  const ys = points.map((p) => p.v);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? null : num / den;
}

function relativeLabel(ms: number): string {
  if (ms <= 0) return 'now';
  const totalH = ms / 3600000;
  if (totalH < 1) return `in ${Math.max(5, Math.round(totalH * 60))} min`;
  if (totalH < 48) {
    const d = Math.floor(totalH / 24);
    const h = Math.round(totalH % 24);
    if (d >= 1) return `in ${d} day${d > 1 ? 's' : ''}${h ? ` ${h} hour${h > 1 ? 's' : ''}` : ''}`;
    const rh = Math.round(totalH);
    return `in ${rh} hour${rh > 1 ? 's' : ''}`;
  }
  const days = Math.round(totalH / 24);
  return `in ${days} days`;
}

/** nextWaterAt pinned to 08:00 local of that calendar day (a sensible check time). */
function pinToMorning(d: Date): Date {
  const c = new Date(d);
  c.setHours(8, 0, 0, 0);
  // If pinning moved it earlier than the projected crossing, that's fine —
  // checking a little early is safer than letting it dry past the low.
  return c;
}

function absoluteLabel(d: Date): string {
  const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date} at ${time}`;
}

export function computeSchedule(
  history: Reading[],
  band: [number, number],
  speciesName: string,
  opts: ScheduleOpts = {},
): WaterSchedule {
  const now = opts.now ?? Date.now();
  const impact = opts.outdoor ? weatherWateringImpact(opts.weather ?? null, true) : null;

  const soils = history
    .filter((r) => r.soil_pct != null && Number.isFinite(r.soil_pct))
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.soil_pct as number }))
    .sort((a, b) => a.t - b.t);

  const none: WaterSchedule = {
    status: 'unknown',
    nextWaterAt: null,
    checkAt: null,
    dryingRatePerDay: null,
    confidence: 'none',
    basis: 'Not enough readings yet to predict a watering date — this sharpens over a few days.',
    relativeLabel: '',
    whenLabel: 'Learning the drying cycle',
  };
  if (soils.length === 0) return none;

  const latest = soils[soils.length - 1];
  const [lo, hi] = band;

  // Already below the ideal low → overdue. Rain ahead can change even this call.
  if (latest.v < lo) {
    if (impact?.effect === 'delay') {
      return {
        status: 'overdue',
        nextWaterAt: new Date(now),
        checkAt: new Date(now),
        dryingRatePerDay: null,
        confidence: 'high',
        basis: `Soil is ${Math.round(latest.v)}% — below ${speciesName}'s ${lo}% low.`,
        relativeLabel: 'now',
        whenLabel: 'Water lightly, or let the rain do it',
        weatherNote: impact.note,
      };
    }
    return {
      status: 'overdue',
      nextWaterAt: new Date(now),
      checkAt: new Date(now),
      dryingRatePerDay: null,
      confidence: 'high',
      basis: `Soil is ${Math.round(latest.v)}% — already below ${speciesName}'s ${lo}% ideal low.`,
      relativeLabel: 'now',
      whenLabel: 'Water today',
      weatherNote: impact?.note,
    };
  }

  // Estimate drying speed from the last 3 days of readings.
  const recent = soils.filter((s) => now - s.t < 3 * DAY);
  const slope = slopePerDay(recent.length >= 3 ? recent : soils);

  if (slope == null || slope >= -0.2) {
    // Not drying meaningfully (flat or rising) — no firm date.
    return {
      ...none,
      status: 'unknown',
      basis:
        soils.length < 3
          ? 'Not enough readings yet to predict a watering date — this sharpens over a few days.'
          : `Soil is holding steady at ${Math.round(latest.v)}% — no drying trend to project from yet.`,
      whenLabel: 'No watering needed yet',
      weatherNote: impact?.effect === 'delay' ? impact.note : undefined,
    };
  }

  /*
   * A rate derived from unusable timestamps is not a slow rate, it is no rate.
   *
   * Every reading in a batch carrying the same (or an unparseable) `created_at`
   * gives a zero or NaN time span, so the slope comes out non-finite — and it
   * reached the screen as "Drying about NaN%/day", together with a projected
   * watering date of "in NaN days". Bail to the honest "no trend yet" answer
   * that already exists a few lines above rather than projecting from it.
   */
  if (!Number.isFinite(slope)) {
    return {
      ...none,
      status: 'unknown',
      basis: 'These readings are not timestamped consistently enough to project a drying trend from.',
      whenLabel: 'Learning the drying cycle',
    };
  }

  // Sensor drying rate is ground truth; hot/dry weather speeds it up (§10).
  const baseRate = -slope; // %/day drying
  const accelerated = impact?.effect === 'accelerate';
  const rate = accelerated ? baseRate * 1.4 : baseRate;
  const readingsUsed = recent.length >= 3 ? recent.length : soils.length;

  const daysToLow = (latest.v - lo) / rate;
  if (!Number.isFinite(daysToLow) || !Number.isFinite(latest.t)) {
    return {
      ...none,
      status: 'unknown',
      basis: 'These readings are not timestamped consistently enough to project a drying trend from.',
      whenLabel: 'Learning the drying cycle',
    };
  }
  const nextWaterAt = new Date(latest.t + daysToLow * DAY);
  const msUntil = nextWaterAt.getTime() - now;
  const checkAt = pinToMorning(nextWaterAt);
  const rel = relativeLabel(msUntil);
  const confidence: WaterSchedule['confidence'] = recent.length >= 4 ? 'high' : 'low';

  // Incoming rain within the next couple of days, on a plant due to be watered
  // then, means holding off — the forecast overrides the "check" call.
  const rainDefers = impact?.effect === 'delay' && msUntil < 2 * DAY;

  const whenLabel = rainDefers
    ? 'Hold off — rain is coming'
    : msUntil <= 0
      ? 'Water today'
      : msUntil < 2 * DAY
        ? `Check ${rel}`
        : `Check ${absoluteLabel(checkAt)}`;

  const basis =
    `Drying about ${Math.max(1, Math.round(rate))}%/day across your last ${readingsUsed} readings; projected to reach the ${lo}% low then.` +
    (accelerated ? ' Sped up for the hot, dry forecast.' : '');

  return {
    status: 'scheduled',
    nextWaterAt,
    checkAt,
    dryingRatePerDay: Math.round(rate * 10) / 10,
    confidence,
    basis,
    relativeLabel: rel,
    whenLabel,
    weatherNote: impact?.applies ? impact.note : undefined,
  };
}

/** Build an iCalendar (.ics) event for a scheduled watering, for calendar sync. */
export function wateringIcs(plantName: string, at: Date): string {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const end = new Date(at.getTime() + 15 * 60000);
  const safeName = plantName.replace(/[,;\\]/g, ' ');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Greenr//Watering Schedule//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:greenr-${at.getTime()}-${safeName.replace(/\s+/g, '')}@greenr.app`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(at)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:Water ${safeName}`,
    `DESCRIPTION:Greenr predicts ${safeName} will be ready for water around now. Check the soil before watering.`,
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    `DESCRIPTION:Water ${safeName} soon`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
