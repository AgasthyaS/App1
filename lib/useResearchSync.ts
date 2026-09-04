import { useEffect, useRef } from 'react';

import { useAuth } from './auth';
import { zoneFromMinC } from './areaClimate';
import { applyCalibration, calibrationFor } from './calibration';
import { primeEmpiricalBands } from './empirical';
import { buildResearchPayload, syncResearch } from './research';
import { activePlants, useGreenr } from './store';
import { useAllReadingHistories } from './useLiveReading';
import { useWeather } from './useWeather';

/**
 * The one place that feeds the "how plants thrive" database.
 *
 * Mounted once, high in the tree, because it needs two things that live apart:
 * the garden (from the store) and the sensor histories (from the readings
 * snapshot). Neither knows about the other, so a component that sees both has to
 * be the one to do it.
 *
 * Deliberately slow. This is research data with a horizon of years, not
 * something anyone is waiting on, so it runs a few times a day and never on a
 * user action. Everything it does is best-effort: a failure here must never be
 * visible to someone who opened the app to look after a plant.
 */

/** How often to consider pushing. The writers inside enforce their own spacing. */
const SYNC_INTERVAL_MS = 60 * 60 * 1000;
/** Give the app time to hydrate and the first readings to land before the first push. */
const FIRST_SYNC_DELAY_MS = 45 * 1000;

export function useResearchSync(): void {
  const { user } = useAuth();
  const { plants: allPlants, settings, calibrations, hydrated, rememberMeasurements } = useGreenr();
  const histories = useAllReadingHistories();
  const weather = useWeather();

  // Read through a ref so the interval never has to be torn down and rebuilt as
  // readings arrive — otherwise it would restart every few minutes and never fire.
  const latest = useRef({ allPlants, settings, calibrations, histories, weather, hydrated, rememberMeasurements });
  latest.current = { allPlants, settings, calibrations, histories, weather, hydrated, rememberMeasurements };

  // Pull the measured per-species bands once so `idealsFor` can consult them.
  // Fire-and-forget: every screen works from book values until it lands, and
  // forever if the backend is not there.
  useEffect(() => { void primeEmpiricalBands(); }, []);

  useEffect(() => {
    if (!user?.id) return;
    let alive = true;

    const push = async () => {
      const s = latest.current;
      if (!alive || !s.hydrated) return;

      const plants = activePlants(s.allPlants);
      if (!plants.length) return;

      // The coldest night of the year is what defines a hardiness zone, and the
      // forecast is the only source of it the app has. Absent that, send nothing
      // rather than a guess — a wrong zone is worse than no zone, because the
      // regional view would silently attribute results to the wrong climate.
      const minC = s.weather.weather?.daily?.reduce<number | null>(
        (lo, d) => (typeof d.tempMinC === 'number' ? (lo == null ? d.tempMinC : Math.min(lo, d.tempMinC)) : lo),
        null,
      ) ?? null;

      const payload = buildResearchPayload({
        // Local measurement memory is not research data — it is how this device
        // remembers its own pots — so it is built regardless of the opt-in, and
        // only the UPLOAD below is gated on consent.
        forceBuild: true,
        plants: plants.map((p) => {
          const raw = s.histories.get(p.id) ?? [];
          const cal = calibrationFor(s.calibrations, raw[0]?.device_id, p.sensorId);
          return {
            plant: p,
            history: cal ? raw.map((r) => applyCalibration(r, cal)) : raw,
            hasSensor: raw.length > 0,
          };
        }),
        settings: s.settings,
        climateZone: minC != null ? zoneFromMinC(minC).zone : null,
        hemisphere: null,
      });

      await syncResearch(user.id, payload);

      /*
       * Persist the same figures locally, so the model's conclusions outlive the
       * 30-day reading window they were derived from. Done here rather than on a
       * timer of its own because this pass has already computed them — and the
       * store action no-ops when nothing meaningful changed, so a garden at rest
       * costs nothing.
       */
      for (const m of payload.measurements) {
        const key = String(m.plant_key);
        s.rememberMeasurements(key, {
          mlPerPoint: (m.ml_per_point as number) ?? null,
          mlPerPointBasis: (m.ml_per_point_basis as string) ?? null,
          cleanPours: (m.clean_pours as number) ?? null,
          ceilingPct: (m.ceiling_pct as number) ?? null,
          retentionClass: (m.retention_class as string) ?? null,
          dryDownDays: (m.dry_down_days as number) ?? null,
        });
      }
    };

    const first = setTimeout(() => { void push(); }, FIRST_SYNC_DELAY_MS);
    const iv = setInterval(() => { void push(); }, SYNC_INTERVAL_MS);
    return () => { alive = false; clearTimeout(first); clearInterval(iv); };
  }, [user?.id]);
}
