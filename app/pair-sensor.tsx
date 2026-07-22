import { Redirect } from 'expo-router';
import React from 'react';

/**
 * Legacy route. The old simulated pairing demo lived here (see git history);
 * real sensor pairing is /pair-device (QR → in-app Wi-Fi → assign). Any stale
 * link or bookmark lands on the real flow instead of a dead demo.
 */
export default function PairSensorLegacyRedirect() {
  return <Redirect href={'/pair-device' as any} />;
}
