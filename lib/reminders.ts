import { calibrationFor, type SensorCalibration } from './calibration';
import { deriveCareTasks } from './careTasks';
import type { Reading } from './devices';
import { estimateWaterSchedule } from './estimate';
import type { DayLight } from './insights';
import { activePlants } from './store';
import type { Plant, Settings, Spot } from './types';
import type { WeatherData } from './weather';

/**
 * Turns the same care intelligence every screen uses (watering schedules, "move
 * to a brighter spot", seasonal feeding) into concrete, time-stamped reminders
 * the OS can deliver. Pure logic — no platform APIs — so it's identical on iOS,
 * Android, and web; the platform notifications module just schedules whatever
 * this returns.
 */

export type ReminderKind = 'water' | 'move' | 'feed' | 'humidity' | 'battery';

export interface Reminder {
  /** stable per plant+kind so re-syncs replace rather than duplicate */
  id: string;
  plantId: string;
  kind: ReminderKind;
  title: string;
  body: string;
  /** when to fire, epoch ms */
  fireAt: number;
}

const MIN = 60000;
const DAY = 86400000;

const EMOJI: Record<ReminderKind, string> = { water: '💧', move: '☀️', feed: '🧪', humidity: '💨', battery: '🔋' };
/** Warn once the sensor battery drops below this. */
const LOW_BATTERY_PCT = 20;

/** Parse "9:00" → minutes since midnight. */
function hmToMin(hm: string): number {
  const [h, m] = hm.split(':').map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

/** Is `date` inside the quiet-hours window (which may wrap past midnight)? */
function inQuiet(date: Date, quiet: [string, string]): boolean {
  const mins = date.getHours() * 60 + date.getMinutes();
  const start = hmToMin(quiet[0]);
  const end = hmToMin(quiet[1]);
  return start <= end ? mins >= start && mins < end : mins >= start || mins < end;
}

/** Set a date's clock time to "H:MM", same calendar day. */
function atTime(base: Date, hm: string): Date {
  const [h, m] = hm.split(':').map((x) => parseInt(x, 10));
  const d = new Date(base);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

/** Push a fire time out of quiet hours to the moment quiet hours end. */
function outOfQuiet(date: Date, quiet: [string, string]): Date {
  if (!inQuiet(date, quiet)) return date;
  const end = atTime(date, quiet[1]);
  // If quiet wraps midnight and we're before the end time, end is later today;
  // otherwise it's tomorrow morning.
  if (end.getTime() <= date.getTime()) end.setDate(end.getDate() + 1);
  return end;
}

/**
 * The next civilised slot to deliver a "due now" nudge: today's reminder time
 * if it's still ahead, else tomorrow's — always outside quiet hours.
 */
function nextSlot(now: Date, settings: Settings): Date {
  let slot = atTime(now, settings.briefingTime);
  if (slot.getTime() <= now.getTime() + 2 * MIN) slot = new Date(slot.getTime() + DAY);
  return outOfQuiet(slot, settings.quietHours);
}

export function computeReminders(opts: {
  plants: Plant[];
  spots: Spot[];
  readings: Map<string, Reading | null>;
  histories?: Map<string, Reading[]>;
  calibrations: Record<string, SensorCalibration>;
  lightDaily?: Record<string, DayLight[]>;
  weather?: WeatherData | null;
  settings: Settings;
  now?: number;
}): Reminder[] {
  const { plants, spots, readings, settings, now = Date.now() } = opts;
  const nowDate = new Date(now);
  const out: Reminder[] = [];
  const seen = new Set<string>();
  const muted = new Set(settings.mutedPlantIds ?? []);

  const push = (r: Reminder) => {
    if (seen.has(r.id) || muted.has(r.plantId)) return; // muted plants never notify
    seen.add(r.id);
    out.push(r);
  };

  // Current, live-derived tasks (water / move / feed / humidity, due now).
  const tasks = deriveCareTasks({
    plants,
    spots,
    readings,
    histories: opts.histories,
    calibrations: opts.calibrations,
    lightDaily: opts.lightDaily,
    weather: opts.weather ?? null,
  });

  const slot = nextSlot(nowDate, settings).getTime();
  const plantWithWaterTaskNow = new Set<string>();

  for (const t of tasks) {
    if (t.kind === 'water' || t.kind === 'water-check') {
      plantWithWaterTaskNow.add(t.plantId);
      push({ id: `${t.plantId}-water`, plantId: t.plantId, kind: 'water', title: `${EMOJI.water} Water ${t.plantName}`, body: t.why, fireAt: slot });
    } else if (t.kind === 'light') {
      push({ id: `${t.plantId}-move`, plantId: t.plantId, kind: 'move', title: `${EMOJI.move} Move ${t.plantName} to better light`, body: t.why, fireAt: slot });
    } else if (t.kind === 'humidity') {
      push({ id: `${t.plantId}-humidity`, plantId: t.plantId, kind: 'humidity', title: `${EMOJI.humidity} Raise humidity for ${t.plantName}`, body: t.why, fireAt: slot });
    } else if (t.kind === 'feed') {
      push({ id: `${t.plantId}-feed`, plantId: t.plantId, kind: 'feed', title: `${EMOJI.feed} Feed ${t.plantName}`, body: t.why, fireAt: slot });
    }
    // 'hold' (don't water) intentionally doesn't push a reminder.
  }

  // Low sensor battery — a dead sensor means no readings, so nudge to recharge.
  readings.forEach((r, plantId) => {
    if (r?.battery_pct != null && r.battery_pct >= 0 && r.battery_pct < LOW_BATTERY_PCT) {
      const p = plants.find((x) => x.id === plantId);
      push({
        id: `${plantId}-battery`,
        plantId,
        kind: 'battery',
        title: `${EMOJI.battery} ${p?.name ?? 'Sensor'} battery is low`,
        body: `The sensor is at ${Math.round(r.battery_pct)}% — recharge or swap batteries so it keeps reporting.`,
        fireAt: slot,
      });
    }
  });

  // Future watering: for plants not already flagged as due now, schedule the
  // next watering from the honest estimate cycle, at the reminder hour on that
  // day, kept out of quiet hours.
  for (const p of activePlants(plants)) {
    if (plantWithWaterTaskNow.has(p.id)) continue;
    const est = estimateWaterSchedule(p, now);
    if (est.dueAt && est.dueAt.getTime() > now + 30 * MIN) {
      // Aim for the reminder hour on the due day — but if that hour has already
      // passed (a watering due later today), fire at the due time itself instead
      // of scheduling into the past (which would deliver immediately).
      let fireDate = outOfQuiet(atTime(est.dueAt, settings.briefingTime), settings.quietHours);
      if (fireDate.getTime() <= now) fireDate = outOfQuiet(est.dueAt, settings.quietHours);
      const fire = fireDate.getTime();
      push({
        id: `${p.id}-water`,
        plantId: p.id,
        kind: 'water',
        title: `${EMOJI.water} Water ${p.name}`,
        body: est.detail.split('.')[0] + '.',
        fireAt: fire,
      });
    }
  }

  // Nearest first, and cap so a big garden can't blow the OS scheduling budget.
  return out.sort((a, b) => a.fireAt - b.fireAt).slice(0, 32);
}

// Re-exported so the notifications modules can share one calibration resolver.
export { calibrationFor };
