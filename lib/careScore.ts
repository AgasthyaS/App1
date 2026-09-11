import { estimateWaterSchedule } from './estimate';
import { plantLabel } from './format';
import { getSpecies, nicheFor } from './plants';
import type { Grade } from './rating';
import { GRADE_WORD } from './rating';
import type { Plant, Spot } from './types';
import { waterPlan } from './watering';

/**
 * The sensorless rating engine.
 *
 * A sensor plant is graded on what the soil, light, temperature, and humidity
 * ACTUALLY are. A sensorless plant has none of that — so grading it on invented
 * measurements would be a lie. Instead we grade the one thing we CAN observe
 * honestly: CARE FIDELITY — how well the gardener's real, logged behaviour
 * matches what this species, in this pot, in this spot, in this season needs.
 *
 * It rests on four measurable components, each a suitability fᵢ ∈ [0,1]:
 *
 *   1. RHYTHM       — does the logged watering cadence match the interval the
 *                     water-calculator says the plant needs?  (log-ratio fit)
 *   2. CONSISTENCY  — is that cadence steady or erratic?  (coefficient of
 *                     variation of the gaps — a plant watered every 7±1 days
 *                     fares better than one watered 3, 14, 5, 20)
 *   3. ENVIRONMENT  — does the chosen spot's (estimated) light, warmth, and
 *                     humidity suit the species?  (tolerance curves, same shape
 *                     as the sensor Habitat-Suitability model)
 *   4. AMOUNT       — when volumes are logged, do they match the calculated ml?
 *
 * They combine by a weighted HARMONIC MEAN — even more minimum-dominated than
 * the geometric mean used for the sensor model, and deliberately so: one
 * persistent bad habit (erratic timing, chronic over-watering) genuinely
 * undermines a plant no matter how good everything else is, so it should drag
 * the score down hard rather than be averaged away. The whole thing carries a
 * CONFIDENCE that climbs with every watering logged and every day owned. It can
 * never reach a sensor's certainty, and the UI says so.
 *
 * Nothing here is fabricated: with too little logged behaviour it returns null,
 * and the plant stays honestly "building baseline".
 */

const DAY = 86400000;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const EPS = 0.02;

export interface CareComponent {
  key: 'rhythm' | 'consistency' | 'environment' | 'amount';
  label: string;
  fit: number; // 0–1
  /** what we observed, in words */
  detail: string;
  /** what to change (empty when good) */
  recommendation: string;
}

/** One logged watering, graded against the interval it should have followed. */
export interface WateringGrade {
  /** ISO time of this watering */
  at: string;
  /** days since the previous watering */
  gapDays: number;
  grade: Grade;
}

export interface CareScore {
  /** 0–100 care-fidelity score */
  total: number;
  grade: Grade;
  word: string;
  components: CareComponent[];
  /** 0–1, grows with logged waterings + days owned; capped below a sensor's */
  confidence: number;
  /** the one-line summary / top action */
  summary: string;
  /** per-watering grades — the sensorless analogue of the sensor per-day strip */
  history: WateringGrade[];
  /** number of waterings behind the score */
  waterings: number;
}

function gradeFromFit(f: number): Grade {
  return f >= 0.85 ? 'excellent' : f >= 0.65 ? 'good' : f >= 0.4 ? 'fair' : 'poor';
}

/** Tolerance curve identical in shape to the sensor model: 1 in band, Gaussian falloff. */
function toleranceFit(v: number, lo: number, hi: number, sigma: number): number {
  if (v >= lo && v <= hi) return 1;
  const d = v < lo ? lo - v : v - hi;
  return clamp01(Math.exp(-0.5 * (d / Math.max(sigma, 0.001)) ** 2));
}

/** Weighted geometric mean (used for the environment sub-score). */
function geoMean(parts: { f: number; w: number }[]): number {
  const W = parts.reduce((a, p) => a + p.w, 0);
  if (W <= 0) return 0;
  const ln = parts.reduce((a, p) => a + p.w * Math.log(Math.max(p.f, EPS)), 0);
  return Math.exp(ln / W);
}

/** Weighted harmonic mean — strongly minimum-dominated (Liebig, hardened). */
function harmonicMean(parts: { f: number; w: number }[]): number {
  const W = parts.reduce((a, p) => a + p.w, 0);
  if (W <= 0) return 0;
  const denom = parts.reduce((a, p) => a + p.w / Math.max(p.f, EPS), 0);
  return W / denom;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Compute the care-fidelity score for a sensorless plant. Returns null when
 * there isn't enough logged behaviour to judge honestly (→ keep "building
 * baseline"). `spot` sharpens the environment component when present.
 */
export function computeCareScore(plant: Plant, spot: Spot | undefined, nowMs = Date.now()): CareScore | null {
  const species = getSpecies(plant.species);
  const niche = nicheFor(plant.species);

  // The interval + amount this plant SHOULD follow, from the real calculator
  // (pot volume × species draw × season). Spot env feeds the climate terms.
  const plan = waterPlan({
    species: plant.species,
    potSize: plant.potSize,
    potMaterial: plant.potMaterial,
    potCm: plant.potCm,
    tempC: spot ? ((((spot.tempRange[0] + spot.tempRange[1]) / 2) - 32) * 5) / 9 : null,
    humidityPct: spot?.rh ?? null,
    lightAvg: null,
    now: new Date(nowMs),
  });

  // Watering times, oldest → newest.
  const times = (plant.waterLog ?? [])
    .map((w) => new Date(w.at).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) gaps.push((times[i] - times[i - 1]) / DAY);

  const daysOwned = plant.addedAt ? Math.max(0, (nowMs - new Date(plant.addedAt).getTime()) / DAY) : plant.addedDaysAgo ?? 0;

  const components: CareComponent[] = [];
  const parts: { f: number; w: number }[] = [];

  // ── 1. RHYTHM — median gap vs the plant's needed interval (log-ratio fit) ──
  if (gaps.length >= 1) {
    const medGap = median(gaps);
    const ratio = medGap / Math.max(plan.intervalDays, 0.5);
    // Gaussian on ln(ratio): perfect at ratio 1; ~0.6 fit at 1.6× or 0.6×.
    const fit = clamp01(Math.exp(-0.5 * (Math.log(ratio) / 0.55) ** 2));
    parts.push({ f: fit, w: 0.34 });
    const off = ratio > 1.25 ? 'under-watering' : ratio < 0.8 ? 'over-watering' : null;
    components.push({
      key: 'rhythm',
      label: 'Watering rhythm',
      fit,
      detail: `You water about every ${medGap.toFixed(1)} days; ${plantLabel(plant.species)} in this pot wants roughly every ${plan.intervalDays.toFixed(1)}.`,
      recommendation: off
        ? off === 'under-watering'
          ? `Water a little more often — you're stretching the gap ${(ratio).toFixed(1)}× longer than ideal.`
          : `Ease off — you're watering ${(1 / ratio).toFixed(1)}× more often than needed; let it dry more between drinks.`
        : '',
    });
  }

  // ── 2. CONSISTENCY — coefficient of variation of the gaps ──
  if (gaps.length >= 2) {
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const variance = gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
    const fit = clamp01(Math.exp(-0.5 * (cv / 0.45) ** 2)); // CV 0 → 1.0; CV 0.45 → 0.6
    parts.push({ f: fit, w: 0.3 });
    components.push({
      key: 'consistency',
      label: 'Consistency',
      fit,
      detail: `Your watering gaps vary by about ${Math.round(cv * 100)}% (steadier is better).`,
      recommendation: cv > 0.55 ? 'Try to keep a steadier schedule — erratic watering stresses roots more than the average would suggest.' : '',
    });
  }

  // ── 3. ENVIRONMENT — the chosen spot vs the species (estimated, so weighted down) ──
  if (spot && species) {
    const tempMid = (spot.tempRange[0] + spot.tempRange[1]) / 2;
    const fLight = toleranceFit(spot.dli, species.dli[0], species.dli[1], niche.lightSigmaDli * 0.6);
    const fTemp = toleranceFit(tempMid, species.temp[0], species.temp[1], niche.tempSigmaF);
    const fRh = toleranceFit(spot.rh, species.rhFloor, 100, niche.rhSigmaPct);
    const fit = geoMean([
      { f: fLight, w: 0.5 },
      { f: fTemp, w: 0.32 },
      { f: fRh, w: 0.18 },
    ]);
    parts.push({ f: fit, w: 0.24 });
    const weakest = [
      { k: 'light', f: fLight, txt: spot.dli < species.dli[0] ? 'the spot is dimmer than it likes' : 'the spot is brighter than it likes' },
      { k: 'warmth', f: fTemp, txt: tempMid < species.temp[0] ? 'the spot runs cool for it' : 'the spot runs warm for it' },
      { k: 'humidity', f: fRh, txt: 'the air is drier than it likes' },
    ].sort((a, b) => a.f - b.f)[0];
    components.push({
      key: 'environment',
      label: 'Spot suitability',
      fit,
      detail: `${spot.name}: ~${spot.dli.toFixed(1)} DLI, ${Math.round(tempMid)}°F, ${spot.rh}% RH vs ${plantLabel(plant.species)}'s needs.`,
      recommendation: weakest.f < 0.7 ? `Consider a better spot — ${weakest.txt}.` : '',
    });
  }

  // ── 4. AMOUNT — logged volumes vs the calculated ml (only when ml is logged) ──
  const mls = (plant.waterLog ?? []).map((w) => w.ml).filter((m): m is number => m != null && m > 0);
  if (mls.length >= 2) {
    const medMl = median(mls);
    const ratio = medMl / Math.max(plan.ml, 25);
    const fit = clamp01(Math.exp(-0.5 * (Math.log(ratio) / 0.5) ** 2));
    parts.push({ f: fit, w: 0.12 });
    components.push({
      key: 'amount',
      label: 'Amount',
      fit,
      detail: `You pour about ${Math.round(medMl)} ml; the calculated amount for this pot is ~${plan.ml} ml.`,
      recommendation:
        ratio > 1.3 ? 'You may be giving more than the pot holds — excess just drains and can wash out nutrients.'
          : ratio < 0.7 ? 'Small pours may not reach deep roots — water until it drains from the base.'
            : '',
    });
  }

  // Not enough logged behaviour to say anything honest yet.
  if (parts.length === 0 || times.length < 2) return null;

  const total = Math.round(harmonicMean(parts) * 100);
  const grade = gradeFromFit(total / 100);

  // Confidence: climbs with logged waterings and days owned; capped — a
  // behaviour model can never be as sure as a soil probe.
  const confidence = clamp01(0.25 + 0.09 * Math.min(times.length, 6) + 0.012 * Math.min(daysOwned, 30) * 0.5);

  // Per-watering history: grade each gap against the plant's ideal interval.
  const history: WateringGrade[] = [];
  for (let i = 1; i < times.length; i++) {
    const g = (times[i] - times[i - 1]) / DAY;
    const ratio = g / Math.max(plan.intervalDays, 0.5);
    const f = clamp01(Math.exp(-0.5 * (Math.log(ratio) / 0.55) ** 2));
    history.push({ at: new Date(times[i]).toISOString(), gapDays: Math.round(g * 10) / 10, grade: gradeFromFit(f) });
  }

  // Summary = the most impactful recommendation, else praise; overdue overrides.
  const sched = estimateWaterSchedule(plant, nowMs);
  const worst = components.filter((c) => c.recommendation).sort((a, b) => a.fit - b.fit)[0];
  let summary: string;
  if (sched.status === 'due') summary = `${sched.whenLabel} — ${sched.detail.split('.')[0]}.`;
  else if (worst) summary = worst.recommendation;
  else summary = `Your care for ${plant.name} closely matches what it needs — keep it up.`;

  return {
    total,
    grade,
    word: GRADE_WORD[grade],
    components,
    confidence,
    summary,
    history,
    waterings: times.length,
  };
}

/** Just the 0–100 number (or null), for aggregate screens and vitality. */
export function careScoreValue(plant: Plant, spot: Spot | undefined, nowMs = Date.now()): number | null {
  return computeCareScore(plant, spot, nowMs)?.total ?? null;
}
