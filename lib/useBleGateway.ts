import { useEffect } from 'react';

import { useAuth } from './auth';
import * as gateway from './bleGateway';
import { useGreenr } from './store';

/**
 * Runs the phone-as-BLE-gateway loop when the user has enabled it. On native it
 * periodically scans for nearby Greenr sensors and drains their buffers to the
 * cloud (saving the sensors' Wi-Fi battery). On web there is no background
 * scanning, so this is a no-op — the sensor's own Wi-Fi fallback covers it and
 * the Settings screen offers a manual sync instead. Mounted once at the app root.
 *
 * Requires a signed-in user: collected readings upload as the device's OWNER, so
 * scanning while signed out would burn radio for uploads that must fail.
 */
export function useBleGateway(): void {
  const { settings, hydrated } = useGreenr();
  const { user } = useAuth();

  useEffect(() => {
    if (!hydrated) return;
    if (!user || !settings.bleGatewayEnabled || !gateway.supportsBackground || !gateway.isSupported) {
      gateway.stopGateway();
      return;
    }
    gateway.startGateway();
    return () => gateway.stopGateway();
  }, [hydrated, user, settings.bleGatewayEnabled]);
}

/** Renders nothing — just runs the gateway loop at the app root. */
export function BleGatewaySync(): null {
  useBleGateway();
  return null;
}
