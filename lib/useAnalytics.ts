import { useSegments } from 'expo-router';
import { useEffect } from 'react';

import { setAnalyticsEnabled, setAnalyticsUser, trackScreen } from './analytics';
import { useAuth } from './auth';
import { useGreenr } from './store';

/**
 * Keeps the analytics module in step with the app: the user's consent, who is
 * signed in, and one `screen:` event per route shown. Mounted once, at the app
 * root. Nothing is recorded until the store has hydrated, so an opted-out user
 * is never counted in the frames before their setting loads.
 */
export function AnalyticsSync(): null {
  const { settings, hydrated } = useGreenr();
  const { user } = useAuth();
  const segments = useSegments();
  const route = segments.join('/');

  useEffect(() => {
    if (hydrated) setAnalyticsEnabled(settings.analyticsOptIn);
  }, [hydrated, settings.analyticsOptIn]);

  useEffect(() => {
    setAnalyticsUser(user?.id ?? null);
  }, [user?.id]);

  useEffect(() => {
    trackScreen(route.split('/'));
  }, [route]);

  return null;
}
