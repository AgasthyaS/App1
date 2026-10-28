import { eventDaysAgo } from './format';
import type { Plant } from './types';

/**
 * ONE COUNT OF CARE, read from one place.
 *
 * The account page used to count "waterings logged" from timeline care events
 * (which also include misting, feeding and repotting) while the briefing showed
 * "minutes of care this week" from a separate task list — so the same week could
 * read "8 waterings logged" and "0 min of care". Every surface now counts from
 * the watering log itself, with double-taps within a minute counted once.
 */

const DAY = 86400000;

/** Watering timestamps for one plant, de-duplicated (a double tap counts once). */
export function wateringTimes(plant: Plant): number[] {
  return (plant.waterLog ?? [])
    .map((w) => new Date(w.at).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)
    .filter((t, i, a) => i === 0 || t - a[i - 1] > 60000);
}

/** Waterings logged across these plants, optionally only within the last `days`. */
export function wateringsLogged(plants: Plant[], days?: number, now = Date.now()): number {
  return plants.reduce(
    (n, p) => n + wateringTimes(p).filter((t) => days == null || now - t <= days * DAY).length,
    0,
  );
}

/** Other care (feeding, misting, pruning, repotting) logged within the last `days`. */
export function otherCareLogged(plants: Plant[], days: number): number {
  return plants.reduce(
    (n, p) =>
      n +
      p.timeline.filter(
        (e) => e.kind === 'care' && eventDaysAgo(e) <= days && !/water/i.test(e.text),
      ).length,
    0,
  );
}

/** "3 waterings and 1 other task logged this week" — or null when nothing was. */
export function careThisWeekLine(plants: Plant[], now = Date.now()): string | null {
  const w = wateringsLogged(plants, 7, now);
  const o = otherCareLogged(plants, 7);
  if (!w && !o) return null;
  const parts = [
    w ? `${w} watering${w === 1 ? '' : 's'}` : null,
    o ? `${o} other task${o === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  return `${parts.join(' and ')} logged this week`;
}
