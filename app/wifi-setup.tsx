import { useRouter } from 'expo-router';
import React from 'react';

import { Screen } from '@/components/greenr/UI';
import { WifiSetupFlow } from '@/components/greenr/WifiSetupFlow';

/**
 * Standalone sensor Wi-Fi setup (e.g. after moving house or changing routers).
 * New-sensor onboarding runs the same flow inside /pair-device instead.
 */
export default function WifiSetup() {
  const router = useRouter();
  const leave = () => {
    try { if (router.canDismiss()) { router.dismiss(); return; } } catch {}
    router.replace('/(tabs)');
  };
  return (
    <Screen mode="light">
      <WifiSetupFlow onDone={leave} doneCta="Done" onSkip={leave} skipLabel="Cancel" />
    </Screen>
  );
}
