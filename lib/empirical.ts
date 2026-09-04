import { supabase } from './supabase';

/**
 * THE MOAT, read side.
 *
 * `lib/plants.ts` currently describes 1,217 species from 15 category baselines
 * plus 140 curated overrides. That means ~1,077 species share an identical
 * profile — which is why eight different ferns score exactly the same for a
 * spot. No amount of decimal places fixes that: the information simply isn't
 * there. More precision on identical inputs is decoration.
 *
 * What DOES fix it is measurement. Once sensors have watched real plants of a
 * species live or die, we can replace the textbook band with the conditions
 * those plants actually thrived in — per species, and eventually per climate.
 * That is data a competitor cannot scrape, buy, or reason their way to; it only
 * accrues by having hardware in homes, and it compounds with every user.
 *
 * This module reads those aggregates (see supabase-moat.sql). It degrades
 * gracefully at every step: no backend, no opted-in data, or too small a sample
 * → the app simply uses the book values as before. Nothing here ever blocks the
 * UI, and nothing is fabricated when the evidence is thin.
 */

/** Minimum plants behind a statistic before we let it override the book value. */
export const MIN_SAMPLE = 20;

export interface EmpiricalBands {
  species: string;
  samplePlants: number;
  /** interquartile range of conditions in which this species THRIVED */
  soil?: [number, number];
  light?: [number, number];
  temp?: [number, number];
  humidity?: [number, number];
}

export interface AreaSurvival {
  species: string;
  zone: number;
  indoor: boolean;
  samplePlants: number;
  /** share of plants that thrived or recovered, 0–1 */
  successRate: number;
  avgDaysOwned: number;
}

let bandsCache: Map<string, EmpiricalBands> | null = null;
let survivalCache: AreaSurvival[] | null = null;
let fetchedAt = 0;
const TTL = 12 * 3600 * 1000; // aggregates move slowly; a twice-daily refresh is plenty

/**
 * Measured bands per species. Returns an empty map when the backend isn't
 * configured or the views don't exist yet — callers then fall back to book values.
 */
export async function loadEmpiricalBands(): Promise<Map<string, EmpiricalBands>> {
  if (bandsCache && Date.now() - fetchedAt < TTL) return bandsCache;
  const out = new Map<string, EmpiricalBands>();
  if (!supabase) return out;
  try {
    const { data } = await supabase
      .from('species_env_stats')
      .select('species,sample_plants,soil_p25,soil_p75,light_p25,light_p75,temp_p25,temp_p75,rh_p25,rh_p75');
    for (const r of (data as any[]) ?? []) {
      if ((r.sample_plants ?? 0) < MIN_SAMPLE) continue;
      const pair = (a: unknown, b: unknown): [number, number] | undefined =>
        a == null || b == null ? undefined : [Number(a), Number(b)];
      out.set(r.species, {
        species: r.species,
        samplePlants: r.sample_plants,
        soil: pair(r.soil_p25, r.soil_p75),
        light: pair(r.light_p25, r.light_p75),
        temp: pair(r.temp_p25, r.temp_p75),
        humidity: pair(r.rh_p25, r.rh_p75),
      });
    }
  } catch {
    // View not installed yet, or no permission — book values remain in use.
  }
  bandsCache = out;
  fetchedAt = Date.now();
  return out;
}

/** Real-world success rates per species × climate zone × indoor/outdoor. */
export async function loadAreaSurvival(): Promise<AreaSurvival[]> {
  if (survivalCache && Date.now() - fetchedAt < TTL) return survivalCache;
  const out: AreaSurvival[] = [];
  if (!supabase) return out;
  try {
    const { data } = await supabase
      .from('species_area_survival')
      .select('species,climate_zone,indoor,sample_plants,success_rate,avg_days_owned');
    for (const r of (data as any[]) ?? []) {
      out.push({
        species: r.species,
        zone: Number(r.climate_zone),
        indoor: !!r.indoor,
        samplePlants: r.sample_plants,
        successRate: Number(r.success_rate),
        avgDaysOwned: Number(r.avg_days_owned),
      });
    }
  } catch {
    /* not available yet */
  }
  survivalCache = out;
  return out;
}

/**
 * How much to trust a measured band, 0–1. Confidence grows with sample size and
 * saturates: 20 plants is worth listening to, 200 is not ten times better.
 */
export function sampleWeight(n: number): number {
  if (n < MIN_SAMPLE) return 0;
  return Math.min(1, Math.log10(n / (MIN_SAMPLE / 2)) / Math.log10(20));
}

/**
 * Blend a measured band with the book band, weighted by how much evidence there
 * is. With few plants the textbook still leads; as data accumulates the measured
 * reality takes over. This is the mechanism by which the app quietly gets more
 * accurate the more people use it.
 */
export function blendBand(
  book: [number, number],
  measured: [number, number] | undefined,
  samplePlants: number,
): { band: [number, number]; basis: 'measured' | 'blended' | 'book'; weight: number } {
  if (!measured) return { band: book, basis: 'book', weight: 0 };
  const w = sampleWeight(samplePlants);
  if (w <= 0) return { band: book, basis: 'book', weight: 0 };
  const lo = book[0] * (1 - w) + measured[0] * w;
  const hi = book[1] * (1 - w) + measured[1] * w;
  return { band: [lo, hi], basis: w > 0.75 ? 'measured' : 'blended', weight: w };
}

/* ─────────────────── THE SYNCHRONOUS HOP INTO THE CARE BANDS ───────────────────
 *
 * `loadEmpiricalBands` has existed, correct and complete, and was never called
 * from anywhere — so measured reality has never once overridden a textbook band.
 * The blocker was shape, not intent: `idealsFor` is synchronous and sits in every
 * hot path in the app, and making it async would mean rewriting every screen.
 *
 * So the fetch happens once, into a module-level cache, and `idealsFor` reads it
 * synchronously. Before the fetch lands — and forever, if the backend is absent
 * or the sample is thin — the book values are used exactly as before. Nothing
 * waits on the network and nothing breaks without it.
 */

let primed = false;

/** Fetch the measured bands once, so `idealsFor` can consult them synchronously. */
export async function primeEmpiricalBands(): Promise<void> {
  if (primed) return;
  primed = true;
  try { await loadEmpiricalBands(); } catch { /* book values remain in use */ }
}

/**
 * The measured band for a species, or undefined. Synchronous by design — it only
 * ever reads the cache that `primeEmpiricalBands` filled.
 */
export function empiricalBandFor(species: string | undefined): EmpiricalBands | undefined {
  if (!species || !bandsCache) return undefined;
  return bandsCache.get(species);
}
