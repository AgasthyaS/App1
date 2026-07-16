import type { Reminder } from './reminders';

/**
 * WEB implementation of care reminders (this file is the default resolution;
 * native platforms use notifications.native.ts instead).
 *
 * The browser can show notifications via the Notification API, but — without a
 * push server and service worker — only while the site is open. So on web we:
 *   • fire anything already due once per session (deduped), and
 *   • set in-page timers for reminders coming up within the next 12 h.
 * The UI is honest about this: real background reminders need the phone app.
 */

export type PermissionStatus = 'granted' | 'denied' | 'undetermined';

const HORIZON_MS = 12 * 3600 * 1000;
/* eslint-disable @typescript-eslint/no-explicit-any */
const g: any = typeof globalThis !== 'undefined' ? globalThis : {};

let timers: any[] = [];
const shownThisSession = new Set<string>();

export function isSupported(): boolean {
  return typeof g.Notification !== 'undefined';
}

/** Real background delivery isn't possible on web — the UI uses this to say so. */
export const backgroundDelivery = false;

function map(p: string | undefined): PermissionStatus {
  return p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'undetermined';
}

export async function getPermission(): Promise<PermissionStatus> {
  if (!isSupported()) return 'denied';
  return map(g.Notification.permission);
}

export async function ensurePermission(): Promise<PermissionStatus> {
  if (!isSupported()) return 'denied';
  if (g.Notification.permission === 'granted') return 'granted';
  if (g.Notification.permission === 'denied') return 'denied';
  try {
    const res = await g.Notification.requestPermission();
    return map(res);
  } catch {
    return 'denied';
  }
}

function show(r: Reminder) {
  try {
    // eslint-disable-next-line no-new
    new g.Notification(r.title, { body: r.body, tag: r.id, icon: '/favicon.png' });
  } catch {
    // ignore — some browsers require a user gesture or a service worker
  }
}

export async function cancelAll(): Promise<void> {
  timers.forEach((t) => g.clearTimeout?.(t));
  timers = [];
}

export async function syncReminders(reminders: Reminder[]): Promise<void> {
  await cancelAll();
  if ((await getPermission()) !== 'granted') return;
  const now = Date.now();
  for (const r of reminders) {
    if (r.fireAt <= now + 60000) {
      // Already due — surface it once per session so opening the app nudges you.
      if (!shownThisSession.has(r.id)) {
        shownThisSession.add(r.id);
        show(r);
      }
    } else if (r.fireAt <= now + HORIZON_MS) {
      // Coming up soon — fire it if the tab is still open when it's time.
      const id = g.setTimeout?.(() => show(r), r.fireAt - now);
      if (id != null) timers.push(id);
    }
  }
}

export async function sendTest(): Promise<void> {
  if ((await ensurePermission()) !== 'granted') return;
  show({
    id: 'test',
    plantId: '',
    kind: 'water',
    title: '🌿 Greenr reminders are on',
    body: "You'll get a nudge when a plant needs watering, moving, or feeding.",
    fireAt: Date.now(),
  });
}
