import { useEffect } from 'react';

import * as notifications from './notifications';
import { computeReminders } from './reminders';
import { useGreenr } from './store';
import { useAllLiveReadings, useAllReadingHistories } from './useLiveReading';

/**
 * Keeps the OS's scheduled care reminders in sync with the garden. Whenever the
 * plants, their readings, or the reminder settings change, it recomputes the
 * full reminder set and re-lays it (cancel + reschedule). Does nothing unless
 * the user has enabled reminders and granted permission. Mounted once, at the
 * app root. Deliberately does NOT pull weather/location, to avoid a startup
 * permission prompt — the rain-delay nuance isn't worth that cost here.
 */
export function useReminders() {
  const { plants, spots, settings, calibrations, lightDaily, hydrated } = useGreenr();
  const readings = useAllLiveReadings();
  const histories = useAllReadingHistories();

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;

    (async () => {
      if (!settings.remindersEnabled) {
        await notifications.cancelAll();
        return;
      }
      const status = await notifications.getPermission();
      if (status !== 'granted') return;
      const reminders = computeReminders({
        plants,
        spots,
        readings,
        histories,
        calibrations,
        lightDaily,
        weather: null,
        settings,
      });
      if (!cancelled) await notifications.syncReminders(reminders);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hydrated,
    settings.remindersEnabled,
    settings.briefingTime,
    settings.quietHours,
    plants,
    spots,
    readings,
    histories,
    calibrations,
    lightDaily,
  ]);
}

/** Renders nothing — just runs the sync effect at the app root. */
export function ReminderSync(): null {
  useReminders();
  return null;
}
