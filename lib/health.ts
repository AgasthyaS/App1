import { applyCalibration, type SensorCalibration } from './calibration';
import type { Reading } from './devices';
import { pct2 } from './format';
import { isNight, USEFUL_LIGHT_MIN } from './insights';
import type { SoilDynamics } from './soilDynamics';
import { idealsFor, lightStatus, soilStatus, tempStatus, humidityStatus, type Tone } from './plantStatus';

/**
 * The transparent Plant Health engine (§9). Given the latest sensor reading, it
 * scores health against THIS species' measurable ideals (from lib/plants.ts) —
 * never generic thresholds. Every component reports what it earned, out of
 * what, WHY (citing the ideal it was judged against), and the recommended
 * action for any deduction. Nothing is fabricated: with no reading the score is
 * `measured: false` and shows no number.
 *
 * Weights (sum 100): Moisture 30 · Light 25 · Temperature 25 · Humidity 20.
 * Only the four directly-measured metrics count, so the same reading always
 * produces the same score on every screen, reproducible by hand.
 */

export interface HealthComponent {
  key: 'moisture' | 'light' | 'temperature' | 'humidity';
  label: string;
  earned: number;
  max: number;
  tone: Tone;
  /** the reading, formatted (e.g. "42%", "24°C", "Bright indirect") */
  value: string;
  /** WHY this score — cites the species' ideal range */
  reason: string;
  /** what to do about a deduction (empty when full marks) */
  recommendation: string;
  /** true when this component is a low-confidence estimate (e.g. sparse history) */
  estimate: boolean;
}

export interface HealthScore {
  total: number;
  max: number;
  components: HealthComponent[];
  /** false when the sensor is paired but hasn't reported — show no number */
  measured: boolean;
  word: 'Thriving' | 'Stable' | 'Stressed' | 'Critical' | 'No data';
  summary: string;
}

const WEIGHTS = { moisture: 30, light: 25, temperature: 25, humidity: 20 } as const;
const HEALTH_MAX = 100;

/** Full marks inside [lo,hi]; loses points linearly, reaching 0 `soft` units outside. */
function scoreRange(v: number, lo: number, hi: number, soft: number, max: number): number {
  if (v >= lo && v <= hi) return max;
  const d = v < lo ? lo - v : v - hi;
  return Math.max(0, Math.round(max * (1 - d / soft)));
}

function wordFor(total: number): HealthScore['word'] {
  if (total >= 85) return 'Thriving';
  if (total >= 70) return 'Stable';
  if (total >= 50) return 'Stressed';
  return 'Critical';
}

function moistureComponent(
  species: string,
  soil: number | null | undefined,
  band: [number, number],
  dyn?: SoilDynamics | null,
): HealthComponent {
  const [lo, hi] = band;
  const base: Omit<HealthComponent, 'earned' | 'tone' | 'value' | 'reason' | 'recommendation'> = {
    key: 'moisture',
    label: 'Moisture',
    max: WEIGHTS.moisture,
    estimate: false,
  };
  if (soil == null) {
    return { ...base, earned: 0, tone: 'unknown', value: 'N/A', reason: `Waiting for a soil reading to judge against ${species}'s ${lo}–${hi}% ideal.`, recommendation: '' };
  }

  // Freshly watered soil reads saturated — that is the watering WORKING, not a
  // fault. Scoring that instant against the band gave 0/30 and told people to
  // fix something they had just done right, so a plant inside its normal drain
  // window keeps full marks and simply reports when it'll settle.
  if (dyn?.draining) {
    return {
      ...base,
      earned: WEIGHTS.moisture,
      tone: 'good',
      value: `${pct2(soil)} · draining`,
      reason: `Just watered, so the soil is saturated at ${Math.round(soil)}% — normal while it drains toward ${lo}–${hi}%.`,
      recommendation: '',
    };
  }

  const span = Math.max(8, hi - lo);
  const earned = scoreRange(soil, lo, hi, span, WEIGHTS.moisture);
  const tone = soilStatus(soil, band).tone;
  let recommendation = '';
  if (soil < lo) recommendation = 'Water now — pour slowly until it drains from the base, then empty the saucer.';
  else if (dyn?.drainageProblem)
    recommendation = 'Still waterlogged long after watering — check the drainage holes and empty the saucer.';
  else if (soil > hi) recommendation = 'Hold off watering; let the soil dry back into range before the next drink.';
  return {
    ...base,
    earned,
    tone,
    value: pct2(soil),
    reason: `${species} prefers ${lo}–${hi}% soil moisture; the sensor reads ${Math.round(soil)}%.`,
    recommendation,
  };
}

/** Uses the real local sunrise/sunset when the weather data has supplied it, so
 *  a winter evening reading isn't mistaken for a dark spot. */
function isNightHour(iso: string): boolean {
  return isNight(new Date(iso).getTime());
}

function lightComponent(
  species: string,
  lightIdx: number | null | undefined,
  dli: [number, number],
  opts?: { avg?: number | null; days?: number; night?: boolean },
): HealthComponent {
  const base = { key: 'light' as const, label: 'Light', max: WEIGHTS.light, estimate: true };
  // Prefer the multi-day daytime AVERAGE — a stable, accumulating measure of the
  // spot's real light — over a single in-the-moment reading (near 0 at night,
  // swings with clouds). Falls back to the instantaneous reading until an average
  // exists. This is what makes the light metric get more accurate with each day.
  const avg = opts?.avg;
  const useAvg = avg != null;
  const idx = useAvg ? avg : lightIdx;
  if (idx == null) {
    return { ...base, earned: 0, tone: 'unknown', value: 'N/A', reason: `Waiting for a light reading.`, recommendation: '' };
  }
  // Night AND genuinely dark, with no average yet: that reading says nothing
  // about the spot, so hold light neutral instead of tanking health.
  // If a lamp or grow light is on and bright enough to clear the compensation
  // point, it IS feeding the plant — that reading counts normally.
  if (!useAvg && opts?.night && idx < USEFUL_LIGHT_MIN) {
    return {
      ...base,
      earned: Math.round(WEIGHTS.light * 0.8),
      tone: 'unknown',
      value: 'Awaiting daytime',
      reason: `It's night — a dark reading now doesn't reflect ${species}'s daylight. This settles as daytime readings accumulate into an average.`,
      recommendation: '',
    };
  }
  const st = lightStatus(idx, dli);
  // Light is a relative 0–100 index (not calibrated lux), so scoring is coarse
  // and honestly labelled an estimate.
  const earned =
    st.tone === 'good' ? WEIGHTS.light : st.tone === 'warn' ? Math.round(WEIGHTS.light * 0.7) : Math.round(WEIGHTS.light * 0.35);
  const wants = dli[1] >= 10 ? 'bright, direct light' : dli[1] <= 4 ? 'low to medium indirect light' : 'bright indirect light';
  // "Move your plant" must NEVER come from one reading. Light swings hugely with
  // cloud, time of day and season, so a single dim sample says nothing about the
  // spot. The recommendation only appears once the multi-day average has reached
  // the same confidence bar the spot verdict uses; before that the app says it is
  // still measuring, which is the honest state.
  const MIN_DAYS_FOR_MOVE = 5;
  const daysBehind = useAvg ? (opts?.days ?? 1) : 0;
  let recommendation = '';
  if (st.tone !== 'good') {
    if (daysBehind >= MIN_DAYS_FOR_MOVE) {
      recommendation = st.label.includes('dark') || st.label.includes('Low')
        ? `Move ${species} closer to a brighter window, or add a grow light.`
        : `Filter the light or move it back — this is stronger than ${species} wants.`;
    } else {
      recommendation = `Still measuring this spot — light varies a lot day to day, so Greenr waits for ${MIN_DAYS_FOR_MOVE} days of readings before suggesting a move.`;
    }
  }
  const multiDay = useAvg && opts?.days && opts.days >= 2;
  const tag = useAvg ? (multiDay ? ` · ${opts!.days}-day avg` : ' · daytime avg') : '';
  return {
    ...base,
    earned,
    tone: st.tone,
    value: `${st.label} (${Math.round(idx)}/100${tag})`,
    reason: useAvg
      ? `${species} wants ${wants}; its daytime light${multiDay ? ` over ${opts!.days} days` : ''} averages ${Math.round(idx)}/100.`
      : `${species} wants ${wants}; the sensor reads a relative ${Math.round(idx)}/100.`,
    recommendation,
  };
}

function temperatureComponent(species: string, tempC: number | null | undefined, tempF: [number, number], unitsF: boolean): HealthComponent {
  const base = { key: 'temperature' as const, label: 'Temperature', max: WEIGHTS.temperature, estimate: false };
  if (tempC == null) {
    return { ...base, earned: 0, tone: 'unknown', value: 'N/A', reason: `Waiting for a temperature reading.`, recommendation: '' };
  }
  const f = (tempC * 9) / 5 + 32;
  const [lo, hi] = tempF;
  const earned = scoreRange(f, lo, hi, 12, WEIGHTS.temperature);
  const tone = tempStatus(tempC, tempF).tone;
  const shown = unitsF ? `${Math.round(f)}°F` : `${Math.round(tempC)}°C`;
  let recommendation = '';
  if (f < lo) recommendation = `Move ${species} away from cold drafts and windows; it likes ${lo}–${hi}°F.`;
  else if (f > hi) recommendation = `Give it more air or a cooler spot; above ${hi}°F soil dries fast and leaves stress.`;
  return {
    ...base,
    earned,
    tone,
    value: shown,
    reason: `${species} is comfortable at ${lo}–${hi}°F; it's ${shown} here.`,
    recommendation,
  };
}

function humidityComponent(species: string, rh: number | null | undefined, floor: number): HealthComponent {
  const base = { key: 'humidity' as const, label: 'Humidity', max: WEIGHTS.humidity, estimate: false };
  if (rh == null) {
    return { ...base, earned: 0, tone: 'unknown', value: 'N/A', reason: `Waiting for a humidity reading.`, recommendation: '' };
  }
  // Full marks at or above the floor (up to 85%), losing points as it drops below.
  const earned = rh >= floor ? (rh <= 85 ? WEIGHTS.humidity : Math.round(WEIGHTS.humidity * 0.85)) : scoreRange(rh, floor, 100, 25, WEIGHTS.humidity);
  const tone = humidityStatus(rh, floor).tone;
  let recommendation = '';
  if (rh < floor) recommendation = `Raise humidity above ${floor}% — group plants, use a pebble tray, or a humidifier.`;
  return {
    ...base,
    earned,
    tone,
    value: pct2(rh),
    reason: `${species} wants at least ${floor}% humidity; the air here is ${Math.round(rh)}%.`,
    recommendation,
  };
}

/** Multi-day daytime light average for a plant (from stored lightDaily). */
export interface LightAvgInput {
  /** blended daytime average, 0–100 (null → fall back to the live reading) */
  avg?: number | null;
  /** how many days are behind it (for wording/confidence) */
  days?: number;
}

export function computeHealth(
  species: string,
  band: [number, number],
  reading: Reading | null,
  _history: Reading[] = [], // kept for call-site compatibility; trends live in the charts, not the score
  unitsF = true,
  calibration?: SensorCalibration | null,
  lightAvg?: LightAvgInput | null,
  soilDyn?: SoilDynamics | null,
): HealthScore {
  const ideal = idealsFor(species, band);
  // Correct the reading with the sensor's calibration offsets first, so health
  // is judged on corrected values (§8/§6).
  const r = reading ? applyCalibration(reading, calibration) : reading;
  const night = reading ? isNightHour(reading.created_at) : false;
  const components: HealthComponent[] = [
    moistureComponent(species, r?.soil_pct, ideal.band, soilDyn),
    lightComponent(species, r?.light_lux, ideal.dli, { avg: lightAvg?.avg, days: lightAvg?.days, night }),
    temperatureComponent(species, r?.temp_c, ideal.temp, unitsF),
    humidityComponent(species, r?.humidity_pct, ideal.rhFloor),
  ];

  const measured = reading != null;
  const total = measured ? components.reduce((a, c) => a + c.earned, 0) : 0;
  const worst = components
    .filter((c) => c.tone !== 'unknown' && c.recommendation)
    .sort((a, b) => a.earned / a.max - b.earned / b.max)[0];

  let summary: string;
  if (!measured) {
    summary = 'Sensor paired — health appears after the first reading.';
  } else if (worst) {
    summary = worst.recommendation;
  } else {
    summary = `${species} is in great shape — every reading sits inside its ideal range.`;
  }

  return {
    total,
    max: HEALTH_MAX,
    components,
    measured,
    word: measured ? wordFor(total) : 'No data',
    summary,
  };
}

/**
 * The single rule for "is this plant's vitality real or estimated?" (§6). A live
 * sensor reading always wins over the plant's stored `estimate` flag — which is
 * only the pre-sensor model and is never cleared when a sensor is later paired.
 * Every surface (detail hero, garden cards, lists, stats) reads vitality from
 * here so a sensored plant NEVER shows estimate visuals or "±" language.
 */
/** How long a sensorless plant must be tracked before an estimate score is shown. */
export const BASELINE_DAYS = 10;

interface VitalityPlant {
  species: string;
  comfortBand: [number, number];
  score: number;
  estimate: boolean;
  estimateBand: number;
  addedAt?: string;
  addedDaysAgo?: number;
}

export interface Vitality {
  /** a live device is paired to this plant */
  sensored: boolean;
  /** the sensor has actually reported */
  measured: boolean;
  /** sensored but no reading yet — show "awaiting", not a number or estimate */
  awaiting: boolean;
  /**
   * sensorless and too new to score honestly — show "N/A · building baseline"
   * instead of a made-up number (a sensor scores instantly)
   */
  pending: boolean;
  /** which day of the baseline window we're on (1-based), when pending */
  baselineDay: number | null;
  /** the score to display (health when measured; the model score otherwise) */
  score: number;
  /** whether to draw estimate visuals (dashed ring, ± band) */
  estimate: boolean;
  estimateBand: number;
  word: string;
}

function daysOwned(plant: VitalityPlant, now = Date.now()): number {
  if (plant.addedAt) return Math.floor((now - new Date(plant.addedAt).getTime()) / 86400000);
  // Legacy plants without a timestamp: trust the stored age (seeds carry real ages).
  return plant.addedDaysAgo ?? BASELINE_DAYS;
}

export function vitalityFor(
  plant: VitalityPlant,
  hasSensor: boolean,
  reading: Reading | null,
  calibration?: SensorCalibration | null,
  unitsF = true,
  lightAvg?: LightAvgInput | null,
  /** sensorless care-fidelity score (lib/careScore) — the honest score when
   *  there's no sensor but the user has logged real care behaviour */
  careScore?: number | null,
): Vitality {
  if (hasSensor) {
    const h = computeHealth(plant.species, plant.comfortBand, reading, [], unitsF, calibration, lightAvg);
    return {
      sensored: true,
      measured: h.measured,
      awaiting: !h.measured,
      pending: false,
      baselineDay: null,
      score: h.measured ? h.total : 0,
      estimate: false,
      estimateBand: 0,
      word: h.measured ? h.word : 'Awaiting reading',
    };
  }

  // Sensorless: once the user has logged enough real care behaviour, the
  // care-fidelity score (lib/careScore) is the honest, computed score — no
  // sensor, but no invented measurements either.
  if (careScore != null) {
    return {
      sensored: false,
      measured: false,
      awaiting: false,
      pending: false,
      baselineDay: null,
      score: careScore,
      estimate: false,
      estimateBand: 0,
      word: wordFor(careScore),
    };
  }

  // No sensor and not enough logged behaviour yet — no score at all until the
  // baseline window passes. A new plant's health simply isn't known, and
  // pretending otherwise is lying.
  const owned = daysOwned(plant);
  if (owned < BASELINE_DAYS) {
    return {
      sensored: false,
      measured: false,
      awaiting: false,
      pending: true,
      baselineDay: Math.min(BASELINE_DAYS, owned + 1),
      score: 0,
      estimate: false,
      estimateBand: 0,
      word: 'Building baseline',
    };
  }

  return {
    sensored: false,
    measured: false,
    awaiting: false,
    pending: false,
    baselineDay: null,
    score: plant.score,
    estimate: plant.estimate,
    estimateBand: plant.estimateBand,
    word: wordFor(plant.score),
  };
}

/**
 * Garden average over plants whose vitality is actually known — live health for
 * sensored plants, baselined estimates for the rest. Returns null (show "—")
 * when nothing is measurable yet, rather than a fabricated number.
 */
export function gardenVitalityAvg(
  items: {
    plant: VitalityPlant;
    hasSensor: boolean;
    reading: Reading | null;
    calibration?: SensorCalibration | null;
    lightAvg?: LightAvgInput | null;
    careScore?: number | null;
  }[],
  unitsF = true,
): number | null {
  const scores = items
    .map((i) => vitalityFor(i.plant, i.hasSensor, i.reading, i.calibration, unitsF, i.lightAvg, i.careScore))
    .filter((v) => !v.awaiting && !v.pending)
    .map((v) => v.score);
  if (!scores.length) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}
