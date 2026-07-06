import type { Reading } from './devices';
import { idealsFor } from './plantStatus';

/**
 * Personalized alerts from a plant's latest reading vs. its species ideals.
 * This is the notification *content* — surfaced in-app now; true background
 * push delivery arrives with the native app (needs device push tokens + a
 * server to send them).
 */
export interface Alert {
  level: 'good' | 'warn' | 'bad';
  text: string;
}

export function alertsFor(
  plantName: string,
  species: string,
  band: [number, number],
  reading: Reading | null,
): Alert[] {
  if (!reading) return [];
  const ideal = idealsFor(species, band);
  const out: Alert[] = [];

  if (reading.soil_pct != null && reading.soil_pct < band[0]) {
    out.push({ level: 'bad', text: `Water your ${plantName} — soil dropped below its ideal range.` });
  }
  if (reading.light_lux != null && reading.light_lux < 15) {
    out.push({ level: 'warn', text: `${plantName} has had very little light.` });
  }
  if (reading.temp_c != null) {
    const f = (reading.temp_c * 9) / 5 + 32;
    if (f > ideal.temp[1] + 6) out.push({ level: 'warn', text: `High temperature around ${plantName}.` });
    else if (f < ideal.temp[0] - 6) out.push({ level: 'warn', text: `It's cold around ${plantName}.` });
  }
  if (reading.humidity_pct != null && reading.humidity_pct < ideal.rhFloor - 15) {
    out.push({ level: 'warn', text: `Humidity is low for ${plantName}.` });
  }

  if (out.length === 0) out.push({ level: 'good', text: `${plantName} looks healthy — everything's in range.` });
  return out;
}
