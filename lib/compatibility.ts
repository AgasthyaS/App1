import { estimateDli } from './lightModel';
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
  /** 0–100 HSI */
  score: number;
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
      const f = toleranceFit(tempF, s.temp[0], s.temp[1], niche.tempSigmaF);
      factors.push({
        key: 'temperature',
        label: 'Temperature',
        fit: f,
        measured: `${Math.round(tempF)}°F here`,
        ideal: `wants ${s.temp[0]}–${s.temp[1]}°F`,
      });
      parts.push({ f, w: 0.32 });
    }
    if (humidity != null) {
      // Humidity has a floor, not a ceiling — above the floor is always fine.
      const f = toleranceFit(humidity, s.rhFloor, 100, niche.rhSigmaPct);
      factors.push({
        key: 'humidity',
        label: 'Humidity',
        fit: f,
        measured: `${Math.round(humidity)}% here`,
        ideal: `wants ≥${s.rhFloor}%`,
      });
      parts.push({ f, w: 0.18 });
    }

    const score = parts.length ? Math.round(geometricMean(parts) * 100) : 0;
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

    return { species: s, score, verdict: verdictFor(score), why, factors, limiting: worst, confidence };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
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
