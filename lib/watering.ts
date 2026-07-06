import type { Reading } from './devices';

/**
 * Turns soil-moisture history into a direct watering call — no "check if the
 * top inch is dry." Estimates the drying rate from recent readings and projects
 * when soil will fall below the plant's ideal low. Low confidence when there
 * isn't enough history yet (the learning phase fills that in).
 */
export interface Watering {
  verdict: string;
  detail: string;
  confidence: 'high' | 'low';
  tone: 'good' | 'warn' | 'bad';
}

/** Least-squares slope of soil% vs time, in %/day. Null if too few points. */
function slopePerDay(points: { t: number; v: number }[]): number | null {
  if (points.length < 3) return null;
  const t0 = points[0].t;
  const xs = points.map((p) => (p.t - t0) / 864e5); // days
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

export function wateringAdvice(
  history: Reading[],
  band: [number, number],
  speciesName: string,
): Watering | null {
  const soils = history
    .filter((r) => r.soil_pct != null)
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.soil_pct as number }));
  if (soils.length === 0) return null;

  const latest = soils[soils.length - 1].v;
  const [lo, hi] = band;

  // Already dry → act now.
  if (latest < lo) {
    return {
      verdict: 'Water today',
      detail: `Soil is ${Math.round(latest)}% — below ${speciesName}'s ideal ${lo}–${hi}%.`,
      confidence: 'high',
      tone: 'bad',
    };
  }
  // Wetter than ideal → let it dry.
  if (latest > hi + (hi - lo) * 0.4) {
    return {
      verdict: 'No water needed',
      detail: `Soil ${Math.round(latest)}% — wetter than ideal; let it dry out.`,
      confidence: 'high',
      tone: 'good',
    };
  }

  const now = Date.now();
  const recent = soils.filter((s) => now - s.t < 3 * 864e5);
  const slope = slopePerDay(recent);

  if (slope != null && slope < -0.8) {
    const rate = Math.abs(Math.round(slope));
    const daysToDry = (latest - lo) / -slope;
    if (daysToDry <= 1)
      return { verdict: 'Water today', detail: `Drying ~${rate}%/day — it reaches its low today.`, confidence: 'high', tone: 'warn' };
    if (daysToDry <= 2)
      return { verdict: 'Water tomorrow', detail: `Drying ~${rate}%/day — it reaches its low in about a day.`, confidence: 'high', tone: 'warn' };
    return {
      verdict: 'No water needed',
      detail: `About ${Math.round(daysToDry)} days until it needs water, at the current drying pace.`,
      confidence: 'high',
      tone: 'good',
    };
  }

  // In range, not enough drying signal yet.
  if (latest >= (lo + hi) / 2) {
    return {
      verdict: 'Soil still moist',
      detail: `Soil ${Math.round(latest)}% — comfortably in range.`,
      confidence: recent.length >= 3 ? 'high' : 'low',
      tone: 'good',
    };
  }
  return {
    verdict: 'No water needed yet',
    detail: 'Learning your plant’s drying cycle — a firm prediction appears after a few days of readings.',
    confidence: 'low',
    tone: 'good',
  };
}
