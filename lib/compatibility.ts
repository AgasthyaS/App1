import { estimateDli } from './lightModel';
import { outdoorViability, parseHardiness } from './areaClimate';
import { blendBand } from './empirical';
import { ALL_SPECIES, nicheFor, type PlantSpecies } from './plants';

/**
 * Environmental compatibility — a real Habitat Suitability Index (HSI), the
 * method field ecologists use to rank how well a location suits a species.
 *
 * The math, made honest:
 *
 *   • LIGHT is converted from the sensor's raw index to a physically-grounded
 *     DLI (mol/m²/day) via lib/lightModel — log-photometry, not a linear guess
 *     — then compared to the species' DLI band. Temperature and humidity are
 *     compared to their bands directly.
 *
 *   • Each factor scores a suitability fᵢ ∈ [0,1] from a TOLERANCE CURVE: 1.0
 *     inside the ideal band, then a Gaussian falloff whose width σ is the
 *     species' own niche width (a cactus forgives dim light; a fern does not).
 *     This makes the curve data-driven per species, not one fixed margin.
 *
 *   • Factors combine by a WEIGHTED GEOMETRIC MEAN — the standard HSI
 *     aggregation and a direct expression of Liebig's Law of the Minimum: the
 *     scarcest resource limits the whole. A plant in the dark scores ~0 no
 *     matter how perfect the humidity, which is horticulturally correct (an
 *     arithmetic mean would wrongly "average away" a fatal deficit).
 *
 *   • The LIMITING FACTOR (lowest fᵢ) is reported, so the advice is causal.
 *
 *   • CONFIDENCE reflects how many factors were actually measured and how
 *     uncertain the light estimate is.
 */
export interface FactorScore {
  key: 'light' | 'temperature' | 'humidity';
  label: string;
  /** suitability 0–1 */
  fit: number;
  /** what the spot offers, in words */
  measured: string;
  /** what the species wants, in words */
  ideal: string;
}

export interface Match {
  species: PlantSpecies;
  /**
   * 0–100 HSI, carried at FULL precision (two decimals are meaningful because
   * every factor is a continuous Gaussian — rounding to an integer used to make
   * genuinely different plants tie at "85%").
   */
  score: number;
  /**
   * Honest error bar on that score, in points. Two decimals are only worth
   * showing next to this: the ranking is finely resolved, but the inputs (an
   * uncalibrated light index, book-value bands) carry real uncertainty.
   */
  margin: number;
  /** where it can live in THIS climate — null when the local climate is unknown */
  outdoor?: import('./areaClimate').OutdoorViability | null;
  /**
   * What the numbers rest on. 'measured' = real sensor data from plants of this
   * species (the moat); 'verified' = a curated profile; 'category' = the shared
   * baseline for its plant family. Species on 'category' data legitimately tie
   * with each other — pretending otherwise with extra decimals would be fake.
   */
  basis: 'measured' | 'verified' | 'category';
  /** how many real plants of this species informed the numbers (0 = none yet) */
  samplePlants: number;
  verdict: 'Thrives' | 'Suitable' | 'Survives' | 'Avoid';
  why: string;
  factors: FactorScore[];
  /** the factor holding the score back (lowest fit), if any is imperfect */
  limiting: FactorScore | null;
  /** 0–1: how much to trust the score, from measured-factor count + light uncertainty */
  confidence: number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const EPS = 0.02; // floor so ln() is finite in the geometric mean

/**
 * Tolerance curve: 1 inside [lo,hi]; outside, a half-Gaussian of width σ.
 *   f(d) = exp(-½ (d/σ)²),  d = distance outside the band.
 * σ is the species' niche width — wide for generalists, narrow for fussy
 * understory plants. Below- and above-band widths can differ: for light, being
 * DIMMER than ideal is far more dangerous than being brighter (light debt is
 * the #1 houseplant killer; even sun-lovers etiolate in the dark), so the
 * below-band curve is deliberately steeper.
 */
function toleranceFit(v: number, lo: number, hi: number, sigmaBelow: number, sigmaAbove = sigmaBelow): number {
  if (v >= lo && v <= hi) return 1;
  const d = v < lo ? lo - v : v - hi;
  const s = v < lo ? sigmaBelow : sigmaAbove;
  return clamp01(Math.exp(-0.5 * (d / Math.max(s, 0.001)) ** 2));
}

/** Weighted geometric mean of suitabilities (Liebig aggregation). */
function geometricMean(parts: { f: number; w: number }[]): number {
  const W = parts.reduce((a, p) => a + p.w, 0);
  if (W <= 0) return 0;
  const lnSum = parts.reduce((a, p) => a + p.w * Math.log(Math.max(p.f, EPS)), 0);
  return Math.exp(lnSum / W);
}

function verdictFor(score: number): Match['verdict'] {
  if (score >= 82) return 'Thrives';
  if (score >= 62) return 'Suitable';
  if (score >= 42) return 'Survives';
  return 'Avoid';
}

/**
 * Score every species for a spot's measured environment. `lightIdx` is the
 * sensor's 0–100 index (converted to DLI internally); temp is °C; humidity is %.
 */
export function plantsForEnvironment(
  lightIdx: number | null,
  tempC: number | null,
  humidity: number | null,
  limit = 6,
  /** measured bands per species (lib/empirical) — when present they REPLACE the
   *  book values in proportion to how much evidence stands behind them */
  empirical?: Map<string, import('./empirical').EmpiricalBands> | null,
): Match[] {
  const dliEst = lightIdx != null ? estimateDli(lightIdx) : null;
  const tempF = tempC != null ? (tempC * 9) / 5 + 32 : null;

  // Confidence: each measured factor contributes; light is downweighted for its
  // uncalibrated uncertainty (the estimate carries a ±40% band).
  const measuredCount = [lightIdx, tempC, humidity].filter((x) => x != null).length;
  const lightConf = dliEst ? 0.75 : 0; // uncalibrated LDR → capped confidence
  const confidence = clamp01(
    (measuredCount / 3) * 0.6 + (dliEst ? lightConf : 0) * 0.25 + (tempF != null && humidity != null ? 0.15 : 0),
  );

  const scored = ALL_SPECIES.map((s) => {
    const niche = nicheFor(s.common);
    const factors: FactorScore[] = [];
    const parts: { f: number; w: number }[] = [];

    // Measured reality beats the textbook once enough plants back it up.
    const empS = empirical?.get(s.common);
    const tempBand = blendBand(s.temp, empS?.temp, empS?.samplePlants ?? 0).band;
    const rhFloor = empS?.humidity ? blendBand([s.rhFloor, 100], empS.humidity, empS.samplePlants).band[0] : s.rhFloor;

    if (dliEst) {
      // Below the band (too dim) is punished harder than above (too bright).
      const f = toleranceFit(dliEst.dli, s.dli[0], s.dli[1], niche.lightSigmaDli * 0.45, niche.lightSigmaDli);
      factors.push({
        key: 'light',
        label: 'Light',
        fit: f,
        measured: `≈${dliEst.dli.toFixed(1)} DLI here`,
        ideal: `wants ${s.dli[0]}–${s.dli[1]} DLI`,
      });
      parts.push({ f, w: 0.5 * niche.demand });
    }
    if (tempF != null) {
      const f = toleranceFit(tempF, tempBand[0], tempBand[1], niche.tempSigmaF);
      factors.push({
        key: 'temperature',
        label: 'Temperature',
        fit: f,
        measured: `${Math.round(tempF)}°F here`,
        ideal: `wants ${Math.round(tempBand[0])}–${Math.round(tempBand[1])}°F`,
      });
      parts.push({ f, w: 0.32 });
    }
    if (humidity != null) {
      // Humidity has a floor, not a ceiling — above the floor is always fine.
      const f = toleranceFit(humidity, rhFloor, 100, niche.rhSigmaPct);
      factors.push({
        key: 'humidity',
        label: 'Humidity',
        fit: f,
        measured: `${Math.round(humidity)}% here`,
        ideal: `wants ≥${Math.round(rhFloor)}%`,
      });
      parts.push({ f, w: 0.18 });
    }

    // NO rounding — the geometric mean of continuous curves is continuous, so
    // keeping the float is what makes two-decimal ranking real rather than
    // decorative. Callers format for display.
    const score = parts.length ? geometricMean(parts) * 100 : 0;
    // Uncertainty shrinks as more factors are measured and as light confidence
    // rises. Roughly: ±12 points on one uncalibrated factor, ±4 on three good ones.
    const margin = parts.length ? Math.max(1.5, 14 * (1 - confidence) + 2) : 50;
    const limiting = factors.length
      ? factors.slice().sort((a, b) => a.fit - b.fit)[0]
      : null;
    const worst = limiting && limiting.fit < 0.85 ? limiting : null;

    let why: string;
    if (score >= 82) why = 'Excellent match — light, warmth, and humidity all sit in its range.';
    else if (worst) {
      const dir =
        worst.key === 'light'
          ? worst.measured.includes('≈') && parseFloat(worst.measured.slice(1)) < s.dli[0]
            ? 'too dim'
            : 'brighter than ideal'
          : worst.key === 'temperature'
            ? 'temperature is off'
            : 'air is drier than it likes';
      why = `Limited by ${worst.label.toLowerCase()} — ${dir} (${worst.measured}, ${worst.ideal}).`;
    } else why = 'A solid fit for this spot.';

    const emp = empirical?.get(s.common);
    const basis: Match['basis'] =
      emp && emp.samplePlants >= 20 ? 'measured' : s.care?.verified ? 'verified' : 'category';
    return {
      species: s, score, margin, verdict: verdictFor(score), why, factors,
      limiting: worst, confidence, basis, samplePlants: emp?.samplePlants ?? 0,
    };
  });

  // Rank by score, then by EVIDENCE — species sharing a category profile score
  // identically, so falling back to data quality is the honest tie-break rather
  // than whichever happened to be first in the catalog.
  const rank = { measured: 2, verified: 1, category: 0 } as const;
  return scored
    .sort((a, b) => b.score - a.score || rank[b.basis] - rank[a.basis] || b.samplePlants - a.samplePlants)
    .slice(0, limit);
}

/**
 * Score ONE species against a spot (for "is this the right spot for my plant?").
 * Same model, single result.
 */
export function scoreSpeciesForEnvironment(
  speciesCommon: string,
  lightIdx: number | null,
  tempC: number | null,
  humidity: number | null,
): Match | null {
  const s = ALL_SPECIES.find((x) => x.common === speciesCommon);
  if (!s) return null;
  const all = plantsForEnvironment(lightIdx, tempC, humidity, ALL_SPECIES.length);
  return all.find((m) => m.species.common === speciesCommon) ?? null;
}

/**
 * "What will actually thrive in MY area?" — the spot-level HSI above, plus the
 * one factor a windowsill reading can never capture: the local climate.
 *
 * Indoors, the spot decides nearly everything and climate barely matters. For a
 * plant that will live outside, winter cold is decisive and overrides every
 * other factor — a species rated to zone 10 simply dies in a zone 7 winter, no
 * matter how good the summer light is. Scoring those two cases identically is
 * how apps end up recommending a Monstera as a patio plant in Michigan.
 *
 * Species whose hardiness suits the area are also given a small, honest boost:
 * they can be grown either way, which is genuinely more useful to the user.
 */
export function plantsForArea(opts: {
  lightIdx: number | null;
  tempC: number | null;
  humidity: number | null;
  /** local climate from lib/areaClimate — null falls back to spot-only scoring */
  area?: import('./areaClimate').AreaClimate | null;
  /** true when the plant will live outdoors (cold hardiness becomes decisive) */
  outdoor?: boolean;
  limit?: number;
  /** measured per-species bands (lib/empirical) */
  empirical?: Map<string, import('./empirical').EmpiricalBands> | null;
}): Match[] {
  const { lightIdx, tempC, humidity, area = null, outdoor = false, limit = 6, empirical = null } = opts;
  // Score every species on the spot first, then re-rank by climate fit.
  const all = plantsForEnvironment(lightIdx, tempC, humidity, ALL_SPECIES.length, empirical);
  if (!area) return all.slice(0, limit);

  const adjusted = all.map((m) => {
    const hardy = parseHardiness(m.species.care?.hardinessZones);
    const viability = outdoorViability(hardy, area);
    let score = m.score;
    let why = m.why;

    if (outdoor) {
      // Outdoors, winter is a hard gate, not a weighting.
      if (!viability.yearRound && !viability.summerOnly) {
        score *= 0.12;
        why = viability.note;
      } else if (!viability.yearRound) {
        // Survives the summer outside but must come in — genuinely worse than a
        // plant that can simply stay put, so it ranks below the hardy ones.
        score *= 0.55;
        why = viability.note;
      }
    } else if (viability.yearRound) {
      // Indoors: being hardy locally is a modest plus (it can also go outside),
      // never enough to outrank a plant that actually fits the light.
      score = Math.min(100, score * 1.04);
    }
    return { ...m, score, why, verdict: verdictFor(score), outdoor: viability };
  });

  const rank2 = { measured: 2, verified: 1, category: 0 } as const;
  return adjusted
    .sort((a, b) => b.score - a.score || rank2[b.basis] - rank2[a.basis] || b.samplePlants - a.samplePlants)
    .slice(0, limit);
}

/** Format a score the way the UI should show it: precise, with its error bar. */
export function formatScore(m: Pick<Match, 'score' | 'margin'>): string {
  return `${m.score.toFixed(2)}% ±${m.margin.toFixed(1)}`;
}
