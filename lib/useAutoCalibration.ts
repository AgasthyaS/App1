import { useEffect } from 'react';

import { autoSoilEndpoints } from './sensing/autoCalibration';
import { useGreenr } from './store';
import { useDeviceHistories } from './useLiveReading';

/**
 * Keeps every sensor's AUTOMATIC soil endpoints up to date (lib/sensing/
 * autoCalibration). Mounted once, at the root, so it runs whichever screen is
 * open. Works on the RAW counts — the histories here are not calibration-
 * corrected — and writes only when the result has changed enough to matter
 * (`autoEndpointsChanged`), so it does not churn state on every refresh.
 */
export function useAutoCalibration(): void {
  const histories = useDeviceHistories();
  const { calibrations, setAutoSoilEndpoints } = useGreenr();

  useEffect(() => {
    histories.forEach((history, deviceId) => {
      const prior = calibrations[deviceId]?.soilEndpointsAuto ?? null;
      const next = autoSoilEndpoints(history, prior);
      if (next) setAutoSoilEndpoints(deviceId, next);
    });
    // `calibrations` is read for the prior only; the store's own change check
    // stops a write from re-triggering this with an identical result.
  }, [histories, calibrations, setAutoSoilEndpoints]);
}

/** Renders nothing; exists so the hook can sit inside the providers. */
export function AutoCalibration(): null {
  useAutoCalibration();
  return null;
}
