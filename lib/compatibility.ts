import { ALL_SPECIES, type PlantSpecies } from './plants';

/**
 * Scores which plant species would thrive in a spot, from the real environment
 * a sensor there is measuring (light, temperature, humidity). Each species gets
 * a 0–100 compatibility score + a short reason, so a user can choose the best
 * plant for a location — or the best location for a plant.
 */
export interface Match {
  species: PlantSpecies;
  score: number;
  verdict: 'Thrives' | 'Survives' | 'Avoid';
  why: string;
}

/** 1 inside [lo,hi], easing to 0 by `soft` units outside. */
function fit(v: number, lo: number, hi: number, soft: number): number {
  if (v >= lo && v <= hi) return 1;
  const d = v < lo ? lo - v : v - hi;
  return Math.max(0, 1 - d / soft);
}

export function plantsForEnvironment(
  lightIdx: number | null,
  tempC: number | null,
  humidity: number | null,
  limit = 6,
): Match[] {
  // LDR index (0–100) → rough DLI estimate (uncalibrated; refined by a BH1750).
  const lightDli = lightIdx != null ? (lightIdx / 100) * 18 : null;
  const tempF = tempC != null ? (tempC * 9) / 5 + 32 : null;

  const scored = ALL_SPECIES.map((s) => {
    const parts: { k: string; f: number }[] = [];
    if (lightDli != null) parts.push({ k: 'light', f: fit(lightDli, s.dli[0], s.dli[1], 6) });
    if (tempF != null) parts.push({ k: 'temperature', f: fit(tempF, s.temp[0], s.temp[1], 12) });
    if (humidity != null) parts.push({ k: 'humidity', f: fit(humidity, s.rhFloor, 100, 25) });

    const score = parts.length ? Math.round((parts.reduce((a, b) => a + b.f, 0) / parts.length) * 100) : 0;
    const weakest = parts.slice().sort((a, b) => a.f - b.f)[0];
    let why: string;
    if (score >= 85) why = 'A great match for this spot’s light, warmth, and humidity.';
    else if (weakest && weakest.f < 0.6)
      why = `Good overall, but the ${weakest.k} here isn’t ideal for it.`;
    else why = 'A reasonable fit for this environment.';

    const verdict: Match['verdict'] = score >= 80 ? 'Thrives' : score >= 55 ? 'Survives' : 'Avoid';
    return { species: s, score, verdict, why };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
