import type { Reading } from './devices';
import { sensorSilence } from './soilDynamics';

/**
 * IS THIS SENSOR ACTUALLY WORKING?
 *
 * The live project has nine registered devices. Three are reporting. Five have
 * never sent a single reading, and one has been silently orphaned for over a
 * month with no plant attached. None of that was visible anywhere in the app —
 * a device that never worked and a device working perfectly looked identical
 * from the outside.
 *
 * There is also a quieter failure. Of the newest five hundred readings, 79% carry
 * no battery value at all. So the one warning that would prevent a sensor dying
 * mid-summer — "this battery is nearly flat" — cannot be given, and the first
 * sign of a dead battery is silence, which is exactly when it is too late.
 *
 * This module names all of it. It deliberately distinguishes NEVER WORKED from
 * STOPPED WORKING, because they have completely different fixes: one is a setup
 * problem (never flashed, wrong credentials, never paired to a plant), the other
 * is a field problem (battery, Wi-Fi, knocked out of the soil).
 */

export type SensorFault =
  | 'never-reported'
  | 'unpaired'
  | 'silent'
  | 'no-battery-telemetry'
  | 'battery-low'
  | 'partial-telemetry'
  | 'healthy';

export interface SensorHealth {
  fault: SensorFault;
  /** 0 = fine, 100 = needs attention now */
  severity: number;
  headline: string;
  detail: string;
  /** the concrete next step, not a restatement of the problem */
  action: string | null;
  hoursSinceReading: number | null;
  batteryPct: number | null;
  /** share of recent readings missing temperature/humidity, 0–1 */
  missingClimateShare: number;
}

/** Below this the sensor will die within weeks, and it dies by going silent. */
const BATTERY_LOW_PCT = 20;
/** Above this share of readings missing temp/RH, the demand correction suffers. */
const CLIMATE_GAP_TOLERANCE = 0.25;

export function sensorHealth(opts: {
  history: Reading[];
  /** true when this device is attached to a plant */
  paired: boolean;
  /** the device's last_seen, when the reading history is empty */
  lastSeenAt?: string | null;
  now?: number;
}): SensorHealth {
  const { history, paired, now = Date.now() } = opts;
  const base = {
    hoursSinceReading: null as number | null,
    batteryPct: null as number | null,
    missingClimateShare: 0,
  };

  if (!history.length) {
    const everSeen = opts.lastSeenAt ? new Date(opts.lastSeenAt).getTime() : null;
    if (!everSeen || !Number.isFinite(everSeen)) {
      return {
        ...base,
        fault: 'never-reported',
        severity: paired ? 90 : 40,
        headline: 'This sensor has never sent a reading',
        detail:
          'It is registered but nothing has ever arrived from it. That is almost always setup rather than hardware: the board was never flashed with its own device id and key, or it has never joined Wi-Fi.',
        action: 'Re-run the Wi-Fi setup, and check this board was provisioned with its OWN credentials — flashing the same sketch onto several boards makes them all upload as one device.',
      };
    }
    return {
      ...base,
      fault: 'silent',
      severity: paired ? 85 : 30,
      hoursSinceReading: (now - everSeen) / 3600000,
      headline: 'No readings in the window',
      detail: `This device last checked in ${Math.round((now - everSeen) / 86400000)} days ago and has sent nothing since.`,
      action: 'Check it is powered and in Wi-Fi range.',
    };
  }

  const withBattery = history.filter((r) => r.battery_pct != null);
  const batteryPct = withBattery.length ? (withBattery[withBattery.length - 1].battery_pct as number) : null;
  const missingClimate = history.filter((r) => r.temp_c == null || r.humidity_pct == null).length;
  const missingClimateShare = missingClimate / history.length;
  const silence = sensorSilence(history, now);
  const hoursSinceReading = silence?.hoursSince ?? null;

  const common = { hoursSinceReading, batteryPct, missingClimateShare };

  if (!paired) {
    return {
      ...common,
      fault: 'unpaired',
      severity: 35,
      headline: 'Reporting, but not attached to a plant',
      detail:
        'This sensor is sending data that goes nowhere — no plant is reading it, so none of it is being used. It also does not count towards any plant’s history.',
      action: 'Pair it to a plant, or forget the device if it is no longer in use.',
    };
  }

  if (silence?.stale) {
    return {
      ...common,
      fault: 'silent',
      severity: 95,
      headline: 'This sensor has gone quiet',
      detail: silence.text,
      action:
        batteryPct != null && batteryPct < 40
          ? `Battery was ${Math.round(batteryPct)}% at the last reading — most likely flat. Recharge or replace it.`
          : 'Check power and Wi-Fi, and that the probe is still in the soil.',
    };
  }

  if (batteryPct != null && batteryPct <= BATTERY_LOW_PCT) {
    return {
      ...common,
      fault: 'battery-low',
      severity: 70,
      headline: `Battery at ${Math.round(batteryPct)}%`,
      detail:
        'A sensor does not warn you when it dies — it simply stops reporting, and the app then has nothing but a stale reading to go on. Charging it now avoids a gap in the history.',
      action: 'Recharge or replace the battery.',
    };
  }

  if (!withBattery.length) {
    return {
      ...common,
      fault: 'no-battery-telemetry',
      severity: 30,
      headline: 'This sensor never reports its battery',
      detail:
        'Readings are arriving normally, but none of them carry a battery level, so Greenr cannot warn you before it goes flat — the first sign will be silence. This is a firmware setting rather than a fault with the plant.',
      action: 'Update the sensor firmware so it includes battery in each reading.',
    };
  }

  if (missingClimateShare > CLIMATE_GAP_TOLERANCE) {
    return {
      ...common,
      fault: 'partial-telemetry',
      severity: 25,
      headline: 'Temperature and humidity are often missing',
      detail:
        `${Math.round(missingClimateShare * 100)}% of recent readings arrived without air temperature or humidity. Soil readings still work, but Greenr uses those two to correct for how thirsty the air is — without them, drying looks faster in winter and slower in summer than it really is.`,
      action: 'Check the DHT/climate sensor wiring on the board.',
    };
  }

  return {
    ...common,
    fault: 'healthy',
    severity: 0,
    headline: 'Reporting normally',
    detail: `Last reading ${hoursSinceReading != null && hoursSinceReading < 2 ? 'just now' : `${Math.round(hoursSinceReading ?? 0)} h ago`}${batteryPct != null ? `, battery ${Math.round(batteryPct)}%` : ''}.`,
    action: null,
  };
}
