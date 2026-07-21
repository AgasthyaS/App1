import type { SensorCalibration } from './calibration';
import { deriveCareTasks, type DerivedTask } from './careTasks';
import type { Reading } from './devices';
import { eventDaysAgo } from './format';
import type { DayLight } from './insights';
import { computeReminders, type Reminder } from './reminders';
import { activePlants } from './store';
import type { Plant, Settings, Spot } from './types';

/**
 * The Notification Center feed — assembled from data the app already has, so
 * nothing is invented or separately persisted:
 *   • NOW      — things that need action (the live care tasks)
 *   • UPCOMING — scheduled reminders with their fire times
 *   • RECENT   — the last handful of real logged events
 * Muted plants are filtered out everywhere.
 */

export interface FeedItem {
  id: string;
  plantId: string;
  plantName: string;
  title: string;
  body: string;
  /** epoch ms — when it fires (upcoming) or happened (recent); null for "now" */
  at: number | null;
  tone: 'action' | 'scheduled' | 'past';
  icon: string;
}

const KIND_ICON: Record<DerivedTask['kind'], string> = {
  water: 'water',
  'water-check': 'water-outline',
  hold: 'hand-left-outline',
  light: 'sunny',
  humidity: 'rainy',
  feed: 'flask',
};

export interface NotificationFeed {
  now: FeedItem[];
  upcoming: FeedItem[];
  recent: FeedItem[];
  /** count that would badge the bell */
  actionCount: number;
}

export function buildNotificationFeed(opts: {
  plants: Plant[];
  spots: Spot[];
  readings: Map<string, Reading | null>;
  histories?: Map<string, Reading[]>;
  calibrations: Record<string, SensorCalibration>;
  lightDaily?: Record<string, DayLight[]>;
  settings: Settings;
  now?: number;
}): NotificationFeed {
  const { plants, settings, now = Date.now() } = opts;
  const muted = new Set(settings.mutedPlantIds ?? []);
  const nameOf = (id: string) => plants.find((p) => p.id === id)?.name ?? 'A plant';

  // NOW — live care tasks (skip pure "hold" no-ops and muted plants).
  const tasks = deriveCareTasks({
    plants,
    spots: opts.spots,
    readings: opts.readings,
    histories: opts.histories,
    calibrations: opts.calibrations,
    lightDaily: opts.lightDaily,
  });
  const nowItems: FeedItem[] = tasks
    .filter((t) => !muted.has(t.plantId))
    .map((t) => ({
      id: `now-${t.id}`,
      plantId: t.plantId,
      plantName: t.plantName,
      title: t.title,
      body: t.why,
      at: null,
      tone: 'action' as const,
      icon: KIND_ICON[t.kind] ?? 'alert-circle',
    }));

  // UPCOMING — scheduled reminders (deduped by plant+kind already), soonest first.
  const reminders: Reminder[] = computeReminders({
    plants,
    spots: opts.spots,
    readings: opts.readings,
    histories: opts.histories,
    calibrations: opts.calibrations,
    lightDaily: opts.lightDaily,
    settings,
    now,
  });
  const upcoming: FeedItem[] = reminders
    .filter((r) => !muted.has(r.plantId) && r.fireAt > now)
    .slice(0, 8)
    .map((r) => ({
      id: `soon-${r.id}`,
      plantId: r.plantId,
      plantName: nameOf(r.plantId),
      title: r.title.replace(/^\S+\s/, ''), // drop the leading emoji, we render an icon
      body: r.body,
      at: r.fireAt,
      tone: 'scheduled' as const,
      icon: r.kind === 'water' ? 'water' : r.kind === 'move' ? 'sunny' : r.kind === 'feed' ? 'flask' : r.kind === 'humidity' ? 'rainy' : 'battery-half',
    }));

  // RECENT — real logged events across active, non-muted plants.
  const recent: FeedItem[] = activePlants(plants)
    .filter((p) => !muted.has(p.id))
    .flatMap((p) =>
      p.timeline.map((e) => ({
        id: `past-${p.id}-${e.id}`,
        plantId: p.id,
        plantName: p.name,
        title: e.text,
        body: '',
        at: now - eventDaysAgo(e, now) * 86400000,
        tone: 'past' as const,
        icon: e.kind === 'photo' ? 'camera-outline' : e.kind === 'care' ? 'checkmark-circle-outline' : e.kind === 'diagnosis' ? 'medkit-outline' : 'analytics-outline',
      })),
    )
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, 12);

  return { now: nowItems, upcoming, recent, actionCount: nowItems.length };
}
