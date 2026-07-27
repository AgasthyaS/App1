import type { GrowthEntry } from './types';

/**
 * Growth-journal analytics. Sensors measure the environment and the care score
 * measures behaviour; this measures the OUTCOME — is the plant actually getting
 * bigger? All from the user's own dated photos and measurements, so nothing is
 * invented. Height/leaf trends use a least-squares slope (per 30 days) so a
 * single odd measurement can't swing the read.
 */

export interface Series {
  t: number; // epoch ms
  v: number;
}

export interface GrowthSummary {
  /** all entries, oldest → newest */
  entries: GrowthEntry[];
  /** entries that carry a photo, oldest → newest */
  photos: GrowthEntry[];
  latestHeight: number | null;
  firstHeight: number | null;
  /** latest − first height, cm */
  heightDeltaCm: number | null;
  /** least-squares height change per 30 days, cm */
  heightPerMonth: number | null;
  latestLeaves: number | null;
  leavesDelta: number | null;
  /** days between first and last dated entry */
  daysTracked: number | null;
  heightSeries: Series[];
  leavesSeries: Series[];
}

function slopePerDay(points: Series[]): number | null {
  if (points.length < 2) return null;
  const t0 = points[0].t;
  const xs = points.map((p) => (p.t - t0) / 86400000);
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

/** Takes just the growth log, so callers can pass a not-yet-loaded plant safely. */
export function growthSummary(plant: { growth?: GrowthEntry[] } | null | undefined): GrowthSummary {
  const entries = [...(plant?.growth ?? [])].sort((a, b) => +new Date(a.at) - +new Date(b.at));
  const photos = entries.filter((e) => e.photoUri);

  const heightSeries: Series[] = entries
    .filter((e) => e.heightCm != null)
    .map((e) => ({ t: +new Date(e.at), v: e.heightCm as number }));
  const leavesSeries: Series[] = entries
    .filter((e) => e.leaves != null)
    .map((e) => ({ t: +new Date(e.at), v: e.leaves as number }));

  const firstHeight = heightSeries.length ? heightSeries[0].v : null;
  const latestHeight = heightSeries.length ? heightSeries[heightSeries.length - 1].v : null;
  const heightDeltaCm = firstHeight != null && latestHeight != null ? Math.round((latestHeight - firstHeight) * 10) / 10 : null;
  const slope = slopePerDay(heightSeries);
  const heightPerMonth = slope != null ? Math.round(slope * 30 * 10) / 10 : null;

  const latestLeaves = leavesSeries.length ? leavesSeries[leavesSeries.length - 1].v : null;
  const leavesDelta = leavesSeries.length >= 2 ? leavesSeries[leavesSeries.length - 1].v - leavesSeries[0].v : null;

  const daysTracked = entries.length >= 2 ? Math.round((+new Date(entries[entries.length - 1].at) - +new Date(entries[0].at)) / 86400000) : null;

  return {
    entries,
    photos,
    latestHeight,
    firstHeight,
    heightDeltaCm,
    heightPerMonth,
    latestLeaves,
    leavesDelta,
    daysTracked,
    heightSeries,
    leavesSeries,
  };
}

/** Short human label for a growth trend, e.g. "+3.5 cm/mo · growing well". */
export function growthHeadline(s: GrowthSummary): string | null {
  if (s.heightPerMonth != null && s.heightSeries.length >= 2) {
    const r = s.heightPerMonth;
    const pace = r > 2 ? 'growing fast' : r > 0.3 ? 'growing steadily' : r < -0.3 ? 'losing height — check its care' : 'holding steady';
    return `${r > 0 ? '+' : ''}${r} cm/mo · ${pace}`;
  }
  if (s.leavesDelta != null && s.leavesDelta !== 0) {
    return `${s.leavesDelta > 0 ? '+' : ''}${s.leavesDelta} leaves since you started tracking`;
  }
  if (s.photos.length >= 2) return `${s.photos.length} progress photos`;
  return null;
}
