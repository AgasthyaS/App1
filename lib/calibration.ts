import type { Reading } from './devices';

/**
 * Sensor calibration (§8). A sensor's raw output drifts from truth — capacitive
 * soil probes read differently in different soils, cheap DHT temp/RH sensors
 * carry a bias, and the LDR light index isn't absolute. Calibration stores a
 * per-metric OFFSET (reference − measured) with the date it was set and a
 * history of past calibrations, then applies those offsets to every reading so
 * health and watering are judged on corrected values (feeding §6 accuracy).
 *
 * Offsets are the user's own measurements, so they are honest corrections, not
 * guesses. An un-calibrated metric has offset 0 and simply passes through.
 */

export type CalMetricKey = 'moisture' | 'temperature' | 'humidity' | 'light';

export interface CalPoint {
  at: string; // ISO timestamp
  offset: number;
  /** the reference + measured values that produced this offset, for the log */
  reference: number;
  measured: number;
}

export interface CalMetric {
  /** added to the raw reading to correct it (in the metric's own units) */
  offset: number;
  calibratedAt: string | null;
  history: CalPoint[];
}

export interface SensorCalibration {
  moisture: CalMetric; // % points
  temperature: CalMetric; // °C
  humidity: CalMetric; // % points
  light: CalMetric; // index points (0–100)
}

/** How often each metric drifts enough to warrant re-checking. */
export const RECOMMENDED_DAYS: Record<CalMetricKey, number> = {
  moisture: 90,
  temperature: 180,
  humidity: 180,
  light: 365,
};

export const METRIC_LABELS: Record<CalMetricKey, { label: string; unit: string }> = {
  moisture: { label: 'Moisture sensor', unit: '%' },
  temperature: { label: 'Temperature sensor', unit: '°C' },
  humidity: { label: 'Humidity sensor', unit: '%' },
  light: { label: 'Light sensor', unit: '/100' },
};

const emptyMetric = (): CalMetric => ({ offset: 0, calibratedAt: null, history: [] });

export function emptyCalibration(): SensorCalibration {
  return {
    moisture: emptyMetric(),
    temperature: emptyMetric(),
    humidity: emptyMetric(),
    light: emptyMetric(),
  };
}

/** offset = what it SHOULD read − what it DID read, rounded to 1 dp. */
export function computeOffset(reference: number, measured: number): number {
  return Math.round((reference - measured) * 10) / 10;
}

/** Days since a metric was calibrated, or null if never. */
export function daysSince(calibratedAt: string | null, now = Date.now()): number | null {
  if (!calibratedAt) return null;
  return Math.floor((now - new Date(calibratedAt).getTime()) / 86400000);
}

/** True when a metric has never been calibrated or is past its recommended interval. */
export function isOverdue(metric: CalMetric, key: CalMetricKey, now = Date.now()): boolean {
  const d = daysSince(metric.calibratedAt, now);
  if (d == null) return false; // never calibrated ≠ overdue; it's just uncalibrated
  return d > RECOMMENDED_DAYS[key];
}

/** Apply calibration offsets to a reading, correcting each measured value. */
export function applyCalibration(reading: Reading, cal?: SensorCalibration | null): Reading {
  if (!cal) return reading;
  const clampPct = (v: number) => Math.max(0, Math.min(100, v));
  return {
    ...reading,
    soil_pct: reading.soil_pct == null ? reading.soil_pct : clampPct(reading.soil_pct + cal.moisture.offset),
    temp_c: reading.temp_c == null ? reading.temp_c : Math.round((reading.temp_c + cal.temperature.offset) * 10) / 10,
    humidity_pct:
      reading.humidity_pct == null ? reading.humidity_pct : clampPct(reading.humidity_pct + cal.humidity.offset),
    light_lux: reading.light_lux == null ? reading.light_lux : clampPct(reading.light_lux + cal.light.offset),
  };
}

/** Record a new calibration for one metric (immutably), keeping the history. */
export function withCalibration(
  cal: SensorCalibration,
  key: CalMetricKey,
  reference: number,
  measured: number,
  at: string = new Date().toISOString(),
): SensorCalibration {
  const offset = computeOffset(reference, measured);
  const prev = cal[key];
  return {
    ...cal,
    [key]: {
      offset,
      calibratedAt: at,
      history: [{ at, offset, reference, measured }, ...prev.history].slice(0, 20),
    },
  };
}

/** True if any offset is non-zero (i.e. the sensor has been calibrated at all). */
export function isCalibrated(cal?: SensorCalibration | null): boolean {
  if (!cal) return false;
  return (['moisture', 'temperature', 'humidity', 'light'] as CalMetricKey[]).some(
    (k) => cal[k].calibratedAt != null,
  );
}
