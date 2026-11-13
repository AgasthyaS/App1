import { Redirect } from 'expo-router';
import React, { useEffect, useState } from 'react';

import { useGreenr } from '@/lib/store';

/**
 * Development shortcut: /demo loads the sample garden as a guest and opens Home.
 * Demo data is never synced to an account (see persistedSlice in lib/store).
 * In a production build this route just redirects home.
 */
export default function Demo() {
  const { hydrated, setProfile, completeOnboarding, loadDemoGarden } = useGreenr();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!__DEV__ || !hydrated) return;
    setProfile({
      name: 'Sam', email: null, method: 'guest', experience: 'A few years',
      plantCount: '4–10', where: 'Indoors', struggle: 'Watering', joined: 'Nov 2026',
    });
    completeOnboarding();
    loadDemoGarden();
    setReady(true);
  }, [hydrated, setProfile, completeOnboarding, loadDemoGarden]);

  if (!__DEV__) return <Redirect href="/(tabs)" />;
  return ready ? <Redirect href="/(tabs)" /> : null;
}
