import * as Notifications from 'expo-notifications';

import type { Reminder } from './reminders';

/**
 * NATIVE implementation of care reminders (iOS / Android via expo-notifications).
 * These are true LOCAL notifications scheduled on-device: they fire at the
 * computed time even when the app is closed, and need no push server. The
 * scheduler cancels and re-lays the full set on every sync so it always matches
 * the current garden.
 */

export type PermissionStatus = 'granted' | 'denied' | 'undetermined';

/** Native local notifications DO deliver in the background. */
export const backgroundDelivery = true;

let handlerSet = false;
function ensureHandler() {
  if (handlerSet) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  handlerSet = true;
}

export function isSupported(): boolean {
  return true;
}

function map(status: Notifications.PermissionStatus): PermissionStatus {
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
}

export async function getPermission(): Promise<PermissionStatus> {
  const { status } = await Notifications.getPermissionsAsync();
  return map(status);
}

export async function ensurePermission(): Promise<PermissionStatus> {
  ensureHandler();
  const current = await Notifications.getPermissionsAsync();
  if (current.status === 'granted') return 'granted';
  const req = await Notifications.requestPermissionsAsync();
  return map(req.status);
}

export async function cancelAll(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function syncReminders(reminders: Reminder[]): Promise<void> {
  ensureHandler();
  if ((await getPermission()) !== 'granted') return;
  await cancelAll();
  const now = Date.now();
  for (const r of reminders) {
    // Anything already due goes out shortly; the rest fire at their exact time.
    const when = r.fireAt <= now ? new Date(now + 10000) : new Date(r.fireAt);
    await Notifications.scheduleNotificationAsync({
      identifier: r.id,
      content: { title: r.title, body: r.body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
    });
  }
}

export async function sendTest(): Promise<void> {
  if ((await ensurePermission()) !== 'granted') return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '🌿 Greenr reminders are on',
      body: "You'll get a nudge when a plant needs watering, moving, or feeding.",
    },
    trigger: null,
  });
}
