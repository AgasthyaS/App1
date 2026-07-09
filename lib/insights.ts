import type { Reading } from './devices';
import { idealsFor } from './plantStatus';

/**
 * Light benchmark (needs ~a day of readings): did this spot actually give the
 * plant the light it wants today? Judged from the real distribution of the
 * sensor's relative light index — how many daytime hours were bright vs dim —
 * against what the species needs. Returns null until there's enough history to
 * say something honest.
 */
export interface LightBenchmark {
  tone: 'good' | 'warn' | 'bad';
  headline: string; // e.g. "Right spot — plenty of light today"
  detail: string; // the numbers behind it, in words
}

export function lightBenchmark(
  history: Reading[],
  species: string,
  dliBand: [number, number],
  now = Date.now(),
): LightBenchmark | null {
  const DAY = 86400000;
  const pts = history
    .filter((r) => r.light_lux != null)
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.light_lux as number }))
    .filter((p) => now - p.t < 26 * 3600000);
  if (pts.length < 5) return null;
  const spanH = (Math.max(...pts.map((p) => p.t)) - Math.min(...pts.map((p) => p.t))) / 3600000;
  if (spanH < 16) return null; // need most of a day before judging the spot

  // Daytime = readings between 7:00 and 19:00 local; night is dark everywhere.
  const daytime = pts.filter((p) => {
    const h = new Date(p.t).getHours();
    return h >= 7 && h < 19;
  });
  if (daytime.length < 3) return null;

  const brightFrac = daytime.filter((p) => p.v >= 40).length / daytime.length;
  const usableFrac = daytime.filter((p) => p.v >= 15).length / daytime.length;
  const brightHours = Math.round(brightFrac * 12);
  const usableHours = Math.round(usableFrac * 12);

  const wantsHigh = dliBand[1] >= 10; // sun-lovers
  const wantsLow = dliBand[1] <= 4; // shade plants

  let tone: LightBenchmark['tone'];
  let headline: string;
  if (wantsHigh) {
    tone = brightFrac >= 0.5 ? 'good' : brightFrac >= 0.25 ? 'warn' : 'bad';
    headline =
      tone === 'good'
        ? 'Right spot — strong light most of the day'
        : tone === 'warn'
          ? 'Borderline — it wants more direct light'
          : 'Too dim here for a sun-lover';
  } else if (wantsLow) {
    tone = usableFrac >= 0.3 ? 'good' : 'warn';
    headline = tone === 'good' ? 'Right spot — gentle light suits it' : 'Very dark — even shade plants need some light';
  } else {
    tone = brightFrac >= 0.2 && usableFrac >= 0.5 ? 'good' : usableFrac >= 0.35 ? 'warn' : 'bad';
    headline =
      tone === 'good'
        ? 'Right spot — bright enough through the day'
        : tone === 'warn'
          ? 'A bit dim — a brighter spot would help'
          : 'Too dim here for this plant';
  }

  return {
    tone,
    headline,
    detail: `Over the last day this spot was bright for ~${brightHours} h and usable for ~${usableHours} h of daylight — ${species} wants ${
      wantsHigh ? 'strong, direct light' : wantsLow ? 'low to medium light' : 'bright indirect light'
    } for most of it.`,
  };
}

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
