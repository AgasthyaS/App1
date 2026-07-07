import type { Reading } from './devices';
import { idealsFor } from './plantStatus';
import { weatherWateringImpact, type WeatherData } from './weather';

/**
 * The notification engine (§11). Produces alerts ONLY when real data justifies
 * one — each alert names the measurement and the ideal it breached, so nothing
 * fires "just because". No reading → no alerts (never fabricated). Battery
 * alerts only fire when the sensor actually reports a level (the firmware sends
 * −1 when it doesn't measure battery, so we stay silent rather than guess).
 *
 * This is the notification *content*; true background push delivery arrives with
 * the native app (device push tokens + a server to send them). Today these
 * surface in-app on the dashboard and plant detail.
 */

export type AlertLevel = 'bad' | 'warn' | 'info';

export interface Alert {
  level: AlertLevel;
  /** stable key for de-duplication / once-per-window throttling */
  key: string;
  title: string;
  /** the justified body, citing the measurement and the ideal */
  text: string;
}

export interface NotifyContext {
  plantName: string;
  species: string;
  band: [number, number];
  reading: Reading | null;
  /** recent readings, needed for the sustained-low-light check */
  history?: Reading[];
  outdoor?: boolean;
  weather?: WeatherData | null;
}

const DAY = 86400000;
const rank: Record<AlertLevel, number> = { bad: 0, warn: 1, info: 2 };

export function notificationsFor(ctx: NotifyContext): Alert[] {
  const { plantName, species, band, reading, history = [], outdoor = false, weather = null } = ctx;
  if (!reading) return [];
  const ideal = idealsFor(species, band);
  const [lo, hi] = band;
  const span = Math.max(8, hi - lo);
  const out: Alert[] = [];

  // Soil moisture — below the recommended minimum.
  if (reading.soil_pct != null && reading.soil_pct < lo) {
    out.push({
      level: 'bad',
      key: 'soil-low',
      title: `Water ${plantName}`,
      text: `Soil moisture has fallen to ${Math.round(reading.soil_pct)}%, below ${plantName}'s recommended minimum (${lo}%).`,
    });
  } else if (reading.soil_pct != null && reading.soil_pct > hi + span * 0.4) {
    out.push({
      level: 'warn',
      key: 'soil-high',
      title: `${plantName} is over-watered`,
      text: `Soil is ${Math.round(reading.soil_pct)}%, above ${plantName}'s ${hi}% ideal — hold off watering so the roots don't sit wet.`,
    });
  }

  // Temperature — outside the comfort band by a clear margin.
  if (reading.temp_c != null) {
    const f = (reading.temp_c * 9) / 5 + 32;
    if (f < ideal.temp[0] - 6) {
      out.push({
        level: 'warn',
        key: 'temp-cold',
        title: `It's cold around ${plantName}`,
        text: `Temperature is ${Math.round(f)}°F, below ${plantName}'s ${ideal.temp[0]}°F comfort floor — move it off cold windowsills.`,
      });
    } else if (f > ideal.temp[1] + 6) {
      out.push({
        level: 'warn',
        key: 'temp-hot',
        title: `It's hot around ${plantName}`,
        text: `Temperature is ${Math.round(f)}°F, above ${plantName}'s ${ideal.temp[1]}°F comfort ceiling — soil will dry faster.`,
      });
    }
  }

  // Humidity — well below the species floor.
  if (reading.humidity_pct != null && reading.humidity_pct < ideal.rhFloor - 15) {
    out.push({
      level: 'warn',
      key: 'humidity-low',
      title: `Dry air around ${plantName}`,
      text: `Humidity is ${Math.round(reading.humidity_pct)}%, well below ${plantName}'s ${ideal.rhFloor}% comfort — a pebble tray or humidifier helps.`,
    });
  }

  // Sustained low light — needs history to prove it's been low, not a blip.
  const now = Date.now();
  const recentLight = history
    .filter((r) => r.light_lux != null && now - new Date(r.created_at).getTime() < 2 * DAY)
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.light_lux as number }));
  if (recentLight.length >= 3) {
    const spanCovered = recentLight[0] && (now - Math.min(...recentLight.map((p) => p.t))) >= 1.5 * DAY;
    if (spanCovered && recentLight.every((p) => p.v < 15)) {
      out.push({
        level: 'warn',
        key: 'light-low-48h',
        title: `${plantName} needs more light`,
        text: `Light has stayed below the recommended range for the last 48 hours — move ${plantName} to a brighter spot.`,
      });
    }
  }

  // Battery — only when the sensor actually reports a level (−1 = unmeasured).
  if (reading.battery_pct != null && reading.battery_pct >= 0 && reading.battery_pct < 15) {
    out.push({
      level: 'warn',
      key: 'battery-low',
      title: 'Sensor battery low',
      text: `${plantName}'s sensor battery is at ${Math.round(reading.battery_pct)}% — recharge or replace it soon.`,
    });
  }

  // Rain ahead — for outdoor plants that aren't already critically dry, suggest
  // holding off rather than double-watering.
  const notDry = reading.soil_pct == null || reading.soil_pct >= lo;
  if (outdoor && notDry) {
    const impact = weatherWateringImpact(weather, true);
    if (impact.effect === 'delay') {
      out.push({
        level: 'info',
        key: 'rain-delay',
        title: `Rain expected — hold off on ${plantName}`,
        text: impact.note,
      });
    }
  }

  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

/** Backward-compatible wrapper (latest reading only, no history/weather). */
export function alertsFor(
  plantName: string,
  species: string,
  band: [number, number],
  reading: Reading | null,
): Alert[] {
  return notificationsFor({ plantName, species, band, reading });
}
