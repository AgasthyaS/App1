import { wateringsLogged } from './careLog';
import type { Plant } from './types';

/**
 * EARLY WINS. The first ten days are when someone decides whether the app is
 * worth keeping, and they are also the days it has the least to show them — no
 * score yet, no learned rhythm. So the things they HAVE done get acknowledged
 * once each, as they happen.
 */

export interface Milestone {
  id: 'first-watering' | 'first-photo' | 'first-week';
  icon: string;
  title: string;
  detail: string;
}

const DAY = 86400000;

/** Every milestone this garden has reached, in the order they usually happen. */
export function reachedMilestones(plants: Plant[], now = Date.now()): Milestone[] {
  const out: Milestone[] = [];
  if (!plants.length) return out;

  if (wateringsLogged(plants) >= 1) {
    out.push({
      id: 'first-watering',
      icon: 'water',
      title: 'First watering logged',
      detail: 'Every logged watering teaches Greenr this plant’s real rhythm.',
    });
  }

  const hasPhoto = plants.some(
    (p) => !!p.photoUri || (p.growth ?? []).some((g) => !!g.photoUri) || p.timeline.some((e) => e.kind === 'photo'),
  );
  if (hasPhoto) {
    out.push({
      id: 'first-photo',
      icon: 'camera',
      title: 'First photo added',
      detail: 'Photos over time are how you will see it grow.',
    });
  }

  const firstAdded = Math.min(
    ...plants.map((p) => (p.addedAt ? new Date(p.addedAt).getTime() : now - (p.addedDaysAgo ?? 0) * DAY)),
  );
  if (Number.isFinite(firstAdded) && now - firstAdded >= 7 * DAY && wateringsLogged(plants, 7, now) >= 1) {
    out.push({
      id: 'first-week',
      icon: 'ribbon',
      title: 'One week of care',
      detail: 'A full week of looking after your plants with Greenr.',
    });
  }
  return out;
}

/** The milestones reached but not yet shown. */
export function newMilestones(plants: Plant[], seen: string[] | undefined, now = Date.now()): Milestone[] {
  const done = new Set(seen ?? []);
  return reachedMilestones(plants, now).filter((m) => !done.has(m.id));
}
