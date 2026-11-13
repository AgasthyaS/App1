import { useEffect, useRef } from 'react';

import { useAuth } from './auth';
import { applyCalibration, calibrationFor } from './calibration';
import { recommendationFor } from './recommendation';
import { logRecommendation, resetRecords, syncCalibrations, syncObservations, syncPlantRecords } from './records';
import { activePlants, useGreenr } from './store';
import { useAllLiveReadings, useAllReadingHistories } from './useLiveReading';

/**
 * Keeps the per-plant record in the account current (lib/records.ts).
 *
 * Mounted once beside the research sync. It runs shortly after the app settles
 * and then every ten minutes, and each writer inside skips whatever it has
 * already sent, so a garden at rest sends nothing. Demo gardens are never
 * written: they are test data and do not belong in anyone's history.
 */
const INTERVAL_MS = 10 * 60 * 1000;
const FIRST_DELAY_MS = 30 * 1000;

export function useRecordsSync(): void {
  const { user } = useAuth();
  const { plants, calibrations, hydrated, demo } = useGreenr();
  const readings = useAllLiveReadings();
  const histories = useAllReadingHistories();
  const latest = useRef({ plants, calibrations, hydrated, demo, readings, histories });
  latest.current = { plants, calibrations, hydrated, demo, readings, histories };

  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    resetRecords(); // a different account must not inherit the last one's "already sent"
    const push = async () => {
      const s = latest.current;
      if (!alive || !s.hydrated || s.demo) return;
      await syncPlantRecords(user.id, s.plants);
      await syncCalibrations(s.calibrations);
      await syncObservations(user.id, s.plants);
      for (const p of activePlants(s.plants)) {
        const raw = s.readings.get(p.id) ?? null;
        if (!raw) continue; // advice for a plant with no sensor is a schedule, not a reading-based decision
        const hist = s.histories.get(p.id) ?? [];
        const cal = calibrationFor(s.calibrations, raw.device_id, p.sensorId);
        const rec = recommendationFor({
          plant: p,
          reading: cal ? applyCalibration(raw, cal) : raw,
          history: cal ? hist.map((h) => applyCalibration(h, cal)) : hist,
          calibration: cal,
        });
        await logRecommendation(user.id, p.id, rec);
      }
    };
    const first = setTimeout(() => { void push(); }, FIRST_DELAY_MS);
    const iv = setInterval(() => { void push(); }, INTERVAL_MS);
    return () => { alive = false; clearTimeout(first); clearInterval(iv); };
  }, [user?.id]);
}
