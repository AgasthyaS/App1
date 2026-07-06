import type { Reading } from './devices';
import { idealsFor } from './plantStatus';

/**
 * Learns from a plant's reading history and turns patterns into plain-language
 * insights ("This spot is consistently bright", "You water about every 4 days").
 * Returns [] until there's enough data — insight quality grows with history.
 */
export interface Insight {
  icon: string;
  text: string;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function insightsFor(history: Reading[], species: string, band: [number, number]): Insight[] {
  const out: Insight[] = [];
  if (history.length < 6) return out;
  const ideal = idealsFor(species, band);

  // Light pattern
  const lights = history.map((r) => r.light_lux).filter((v): v is number => v != null);
  if (lights.length >= 6) {
    const a = avg(lights);
    if (a >= 70) out.push({ icon: 'sunny', text: `This spot gets consistently bright light (averaging ${Math.round(a)}/100).` });
    else if (a < 25) out.push({ icon: 'moon', text: `This spot stays fairly dim (avg ${Math.round(a)}/100) — ${species} may prefer brighter.` });
    else out.push({ icon: 'partly-sunny', text: `Light here is moderate and steady (avg ${Math.round(a)}/100).` });
  }

  // Watering cycle — detect refill events (soil jumps up) and measure the gap.
  const soils = history
    .filter((r) => r.soil_pct != null)
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.soil_pct as number }));
  const refills: number[] = [];
  for (let i = 1; i < soils.length; i++) {
    if (soils[i].v - soils[i - 1].v > 12) refills.push(soils[i].t);
  }
  if (refills.length >= 2) {
    const gaps = refills.slice(1).map((t, i) => (t - refills[i]) / 864e5);
    const days = Math.round(avg(gaps));
    if (days >= 1) out.push({ icon: 'water', text: `You water ${species} about every ${days} day${days > 1 ? 's' : ''} — I'll time reminders to that.` });
  }

  // Temperature vs ideal
  const temps = history.map((r) => r.temp_c).filter((v): v is number => v != null);
  if (temps.length >= 6) {
    const aF = (avg(temps) * 9) / 5 + 32;
    if (aF < ideal.temp[0]) out.push({ icon: 'thermometer', text: `Runs cooler than ${species} likes (avg ${Math.round(aF)}°F).` });
    else if (aF > ideal.temp[1]) out.push({ icon: 'thermometer', text: `Runs warm here (avg ${Math.round(aF)}°F) — watch for faster drying.` });
  }

  // Humidity vs ideal
  const hums = history.map((r) => r.humidity_pct).filter((v): v is number => v != null);
  if (hums.length >= 6) {
    const a = avg(hums);
    if (a < ideal.rhFloor - 8) out.push({ icon: 'rainy', text: `Humidity averages ${Math.round(a)}% — below ${species}'s comfort; grouping plants or a humidifier helps.` });
  }

  return out;
}
