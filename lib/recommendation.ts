import { endpointsValid, traceConsistency } from './sensing/moisture';
import { MODEL_VERSION } from './modelVersion';
import { getSpecies, waterProfileFor } from './plants';
import { idealsFor } from './plantStatus';
import { insertionBlocksLearning, probeInsertion } from './probeInsertion';
import { retentionEstimate } from './soilRetention';
import { containerThresholds } from './soilProfile';
import { recipeText, resolveSubstrate } from './substrate/catalog';
import { waterAction } from './waterAction';
import { perPointFor, wateringSchedule } from './waterBalance';
import type { SensorCalibration } from './calibration';
import type { Reading } from './devices';
import type { Plant } from './types';

/**
 * THE RECOMMENDATION — the water decision, plus what it rests on.
 *
 * `waterAction` decides. This wraps it to answer the three questions a decision
 * on its own cannot: is the plant merely on its way to needing water, are the
 * readings good enough to act on at all, and how well-founded is the answer.
 *
 * ──────────────────────────── THE STATES ────────────────────────────
 *
 *   insufficient-data  no reading, or the last one is too old to act on
 *   inconsistent       readings exist but cannot be trusted (probe out of the
 *                      soil, wiring fault, an erratic trace)
 *   retry / waiting    carried through from `waterAction`
 *   water-now          below the species' floor
 *   drying             inside the band, but the substrate's easily-available
 *                      water is nearly used or the measured trend reaches the
 *                      floor within two days
 *   in-range           nothing to do
 *   too-wet            above the band and not simply draining
 *   not-draining       still saturated long after watering
 *
 * WHY THE SUBSTRATE MOVES "DRYING" BUT NOT "WATER NOW". The substrate threshold
 * is where the model says water stops being freely available in THIS mix. It is
 * a modelled figure, and the costly mistake with a houseplant is watering too
 * soon, not a day late. So it is used to warn early, while the instruction to
 * pour stays tied to the species floor and the pot's own measured behaviour.
 *
 * ──────────────────────── THE EVIDENCE GRADE ────────────────────────
 *
 * Not a probability. Nothing here has a sampling distribution to compute one
 * from, and a "73% confident" badge would be invention. It is a count against a
 * fixed, published checklist:
 *
 *   REQUIRED (all three, or the grade is "low" at best)
 *     fresh      the reading is recent for this sensor's reporting rhythm
 *     seated     the probe is in the soil and reading in range
 *     steady     the recent trace is not erratic
 *
 *   SUPPORTING (counted)
 *     own-range     this sensor's air and water endpoints were captured
 *     substrate     the owner has said what the plant is potted in
 *     pot-drying    this pot has been watched drying, and the fit is good
 *     pot-dose      at least one measured pour has calibrated ml per point
 *     species       the species has a curated care record
 *     dimensions    pot width and depth are known
 *
 *   high      required, pot-drying, and at least 4 of the other 5 supporting
 *   moderate  required and at least 3 supporting
 *   low       anything else with a usable reading
 *   none      no usable reading
 *
 * The grade says how much of the answer is measured rather than assumed. It does
 * not say the answer is right.
 */

export type RecommendationState =
  | 'insufficient-data'
  | 'inconsistent'
  | 'retry'
  | 'waiting'
  | 'water-now'
  | 'drying'
  | 'in-range'
  | 'too-wet'
  | 'not-draining';

export type EvidenceGrade = 'high' | 'moderate' | 'low' | 'none';

export interface EvidenceItem {
  key:
    | 'fresh' | 'seated' | 'steady'
    | 'own-range' | 'substrate' | 'pot-drying' | 'pot-dose' | 'species' | 'dimensions';
  required: boolean;
  met: boolean;
  /** short, shown in the checklist */
  label: string;
  /** one sentence: what was found, or what would satisfy it */
  detail: string;
}

export interface Recommendation {
  state: RecommendationState;
  /** one line for a card */
  headline: string;
  /** what to do, or null when the answer is "nothing" */
  action: string | null;
  /** millilitres to pour now; 0 unless the state asks for water */
  ml: number;
  /** days until watering is expected to be due, when the pot's drying has been measured */
  daysUntilDue: number | null;
  grade: EvidenceGrade;
  evidence: EvidenceItem[];
  /** the seven-part explanation, each a plain sentence */
  explain: {
    measured: string;
    calculated: string;
    substrate: string;
    plant: string;
    history: string;
    why: string;
    reliability: string;
  };
  /** the numbers the decision used — stored with it so it can be re-examined later */
  inputs: Record<string, string | number | boolean | null>;
  modelVersion: string;
}

const HOUR = 3_600_000;
const GRADE_WORD: Record<EvidenceGrade, string> = {
  high: 'Well founded',
  moderate: 'Reasonably founded',
  low: 'Thinly founded',
  none: 'No basis yet',
};

export const gradeLabel = (g: EvidenceGrade): string => GRADE_WORD[g];

/** Median gap between readings, hours. Null with fewer than three readings. */
function cadenceHours(history: Reading[]): number | null {
  const ts = history.map((r) => new Date(r.created_at).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < ts.length; i++) if (ts[i] > ts[i - 1]) gaps.push((ts[i] - ts[i - 1]) / HOUR);
  if (gaps.length < 2) return null;
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1];
}

const round = (v: number | null | undefined): number | null =>
  v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;

export function recommendationFor(opts: {
  plant: Plant;
  /** calibration-corrected latest reading */
  reading: Reading | null;
  /** calibration-corrected history, oldest → newest */
  history?: Reading[];
  calibration?: SensorCalibration | null;
  now?: number;
}): Recommendation {
  const { plant, reading, history = [], calibration = null, now = Date.now() } = opts;
  const name = plant.species?.trim() || 'this plant';
  const species = getSpecies(plant.species);
  const ideal = idealsFor(plant.species, plant.comfortBand);
  const [lo, hi] = ideal.band;
  const substrate = resolveSubstrate(plant.substrate, plant.soilMix);
  const style = waterProfileFor(plant.species).style;

  const soil = reading?.soil_pct != null && Number.isFinite(reading.soil_pct) ? reading.soil_pct : null;
  const ageH = reading ? (now - new Date(reading.created_at).getTime()) / HOUR : null;
  const cadence = cadenceHours(history) ?? 3;
  // Two and a half reporting cycles, never less than eight hours: one missed
  // report is normal, three in a row is a sensor that has stopped.
  const staleAfterH = Math.max(8, cadence * 2.5);
  const fresh = ageH != null && Number.isFinite(ageH) && ageH <= staleAfterH;

  const insertion = history.length ? probeInsertion(plant, history, now) : null;
  const quality = reading?.soil_quality;
  const badSignal = quality === 'not-inserted' || quality === 'disconnected' || quality === 'beyond-wet' || quality === 'invalid';
  const seated = soil != null && !badSignal && !(insertion && insertionBlocksLearning(insertion));

  const trace = traceConsistency(history.map((r) => r.soil_pct));
  const steady = trace ? !trace.inconsistent : false;

  const retention = history.length ? retentionEstimate(plant, history) : null;
  const perPoint = history.length && soil != null ? perPointFor(plant, history, soil, now) : null;
  const schedule = history.length ? wateringSchedule(plant, history, ideal.band, now) : null;
  const geo = {
    potHeightCm: typeof plant.potHeightCm === 'number' && plant.potHeightCm > 0 ? plant.potHeightCm : 16,
    soilMix: plant.soilMix ?? null,
    substrate: plant.substrate ?? null,
    soilRetention: plant.soilRetention ?? null,
    probeDepthCm: plant.probeDepthCm ?? null,
  };
  const thresholds = containerThresholds(geo);

  /*
   * DAYS UNTIL THE PLANT'S OWN FLOOR — the reading at which "water now" fires.
   *
   * Projected along the fitted drying curve where there is one (drying slows as
   * the pot empties, so a straight line calls it too early), otherwise along the
   * measured average rate. Null unless this pot's drying has actually been
   * measured: a projection from a species table is a guess with a number on it.
   *
   *     t = τ · ln( (now − floor∞) / (lo − floor∞) )        τ, floor∞ from the fit
   */
  const daysToFloor: number | null = (() => {
    if (soil == null || !retention?.confident) return null;
    if (soil <= lo) return 0;
    const { tauObservedDays: tau, residual, ptsPerDay } = retention;
    if (tau > 0 && lo > residual + 0.5 && soil > residual + 0.5) {
      return Math.max(0, tau * Math.log((soil - residual) / (lo - residual)));
    }
    return ptsPerDay > 0 ? (soil - lo) / ptsPerDay : null;
  })();

  /* ───────────── evidence ───────────── */
  const ownRange = endpointsValid(calibration?.soilEndpoints);
  const evidence: EvidenceItem[] = [
    {
      key: 'fresh', required: true, met: fresh, label: 'Recent reading',
      detail: ageH == null
        ? 'No reading has arrived yet.'
        : fresh
          ? `The latest reading is ${ageH < 1 ? 'under an hour' : `${Math.round(ageH)} h`} old.`
          : `The latest reading is ${Math.round(ageH)} h old; this sensor normally reports every ${Math.round(cadence)} h.`,
    },
    {
      key: 'seated', required: true, met: seated, label: 'Probe in the soil',
      detail: soil == null
        ? 'No soil value to judge.'
        : badSignal
          ? quality === 'not-inserted'
            ? 'The reading matches open air, so the probe is not in the soil.'
            : quality === 'disconnected'
              ? 'The signal is far too low for a connected probe — check the cable.'
              : 'The signal is beyond the water endpoint — check for water on the electronics.'
          : insertion && insertionBlocksLearning(insertion)
            ? insertion.headline
            : 'The reading is in range and behaves like buried soil.',
    },
    {
      key: 'steady', required: true, met: steady, label: 'Steady trace',
      detail: !trace
        ? 'Fewer than eight readings so far — not enough to tell a steady trace from an erratic one.'
        : trace.inconsistent
          ? `Recent readings jump around (${Math.round(trace.outlierShare * 100)}% are outliers), which soil does not do.`
          : `Recent readings move smoothly (noise about ${trace.noisePts.toFixed(1)} points).`,
    },
    {
      key: 'own-range', required: false, met: ownRange, label: 'Sensor calibrated',
      detail: ownRange
        ? 'This sensor’s own air and water readings set its scale.'
        : 'Using the factory scale shared by every sensor. Capture this one’s air and water readings to remove unit-to-unit error.',
    },
    {
      key: 'substrate', required: false, met: substrate.knowledge !== 'unknown', label: 'Substrate known',
      detail: substrate.knowledge === 'unknown'
        ? 'What the plant is potted in has not been specified, so a general potting mix is assumed.'
        : `${substrate.label}${substrate.parts.length > 1 ? ` (${recipeText(substrate)})` : ''}.`,
    },
    {
      key: 'pot-drying', required: false, met: !!retention?.confident, label: 'Drying measured',
      detail: retention?.confident
        ? `Watched drying over ${retention.runs.length} run${retention.runs.length === 1 ? '' : 's'}: about ${retention.dryDays.toFixed(1)} days from full to due.`
        : retention
          ? 'A drying run has been seen but not enough agreeing ones to rely on yet.'
          : 'This pot has not been watched drying from full yet.',
    },
    {
      key: 'pot-dose', required: false, met: !!perPoint && perPoint.cleanPours >= 1, label: 'Amount measured',
      detail: perPoint && perPoint.cleanPours >= 1
        ? `${perPoint.cleanPours} logged pour${perPoint.cleanPours === 1 ? '' : 's'} with an amount ${perPoint.cleanPours === 1 ? 'has' : 'have'} calibrated what a millilitre does here.`
        : 'No measured pour yet, so the amount is estimated from the pot’s size.',
    },
    {
      key: 'species', required: false, met: !!species?.care.verified, label: 'Species record',
      detail: species?.care.verified
        ? `${species.common} has a curated care record.`
        : species
          ? `${species.common} uses its category’s typical values, not a species-specific record.`
          : 'The species is not in the catalog, so generic houseplant values are used.',
    },
    {
      key: 'dimensions', required: false,
      met: typeof plant.potHeightCm === 'number' && plant.potHeightCm > 0 && typeof plant.potCm === 'number' && plant.potCm > 0,
      label: 'Pot measured',
      detail: typeof plant.potHeightCm === 'number' && plant.potHeightCm > 0 && typeof plant.potCm === 'number' && plant.potCm > 0
        ? `Pot is ${plant.potCm} cm wide and ${plant.potHeightCm} cm deep.`
        : 'Pot width or depth is missing, so a typical pot is assumed.',
    },
  ];
  const requiredMet = evidence.filter((e) => e.required).every((e) => e.met);
  const supporting = evidence.filter((e) => !e.required && e.met).length;
  const potDrying = evidence.find((e) => e.key === 'pot-drying')!.met;
  const grade: EvidenceGrade =
    soil == null || !fresh ? 'none'
      : !requiredMet ? 'low'
        : potDrying && supporting >= 5 ? 'high'
          : supporting >= 3 ? 'moderate'
            : 'low';

  const inputs: Recommendation['inputs'] = {
    soil_index: round(soil),
    soil_raw: reading?.soil_raw ?? null,
    soil_quality: quality ?? null,
    temp_c: round(reading?.temp_c),
    humidity_pct: round(reading?.humidity_pct),
    reading_age_h: round(ageH),
    band_lo: lo,
    band_hi: hi,
    substrate_key: substrate.key,
    substrate_refill: round(thresholds.refillReading),
    substrate_capacity: round(thresholds.capacityReading),
    refill_at: round(schedule?.refillAt),
    capacity_at: round(schedule?.capacityAt),
    pts_per_day: round(schedule?.ptsPerDay),
    days_until_due: round(daysToFloor),
    days_to_refill: round(schedule?.daysUntilDue),
    ml_per_point: round(perPoint?.mlPerPoint),
    ml_basis: perPoint?.basis ?? null,
    own_endpoints: ownRange,
  };

  /* ───────────── the explanation's fixed parts ───────────── */
  const substrateLine =
    substrate.knowledge === 'unknown'
      ? 'The substrate is not specified, so Greenr assumes a general potting mix and leans on how this pot behaves rather than on the mix.'
      : thresholds.unreliable
        ? `In ${substrate.label.toLowerCase()} the probe barely moves between full and dry in this pot, so the reading says little here.`
        : `In ${substrate.label.toLowerCase()} a just-drained pot like this reads about ${Math.round(thresholds.capacityReading)}, and its freely available water runs out near ${Math.round(thresholds.refillReading)}.`;
  const plantLine =
    style === 'soak-and-dry'
      ? `${name} is a soak-and-dry plant: it should dry right out between waterings, so only its own floor of ${lo} counts.`
      : style === 'constantly-damp'
        ? `${name} wants to stay evenly moist, between ${lo} and ${hi}.`
        : `${name} is comfortable between ${lo} and ${hi}.`;
  const historyLine = retention?.confident
    ? `This pot has been measured losing about ${retention.ptsPerDay.toFixed(1)} points a day.`
    : history.length >= 8
      ? 'There is some history, but no complete drying run yet, so the timing is not measured.'
      : 'There is very little history for this pot yet.';
  const met = evidence.filter((e) => e.met).length;
  const reliabilityLine = `${GRADE_WORD[grade]}: ${met} of ${evidence.length} checks met.${
    evidence.find((e) => !e.met) ? ` Weakest point: ${evidence.find((e) => !e.met)!.detail}` : ''
  }`;
  const measuredLine = soil == null
    ? 'No soil reading yet.'
    : `Soil moisture index ${Math.round(soil)} (0 = this probe in air, 100 = in water)${
        reading?.temp_c != null ? `, ${Math.round(reading.temp_c)} °C` : ''
      }${reading?.humidity_pct != null ? `, ${Math.round(reading.humidity_pct)}% humidity` : ''}.`;

  const build = (
    state: RecommendationState,
    headline: string,
    action: string | null,
    calculated: string,
    why: string,
    ml = 0,
  ): Recommendation => ({
    state, headline, action, ml,
    daysUntilDue: daysToFloor,
    grade, evidence,
    explain: {
      measured: measuredLine,
      calculated,
      substrate: substrateLine,
      plant: plantLine,
      history: historyLine,
      why,
      reliability: reliabilityLine,
    },
    inputs: { ...inputs, state },
    modelVersion: MODEL_VERSION,
  });

  /* ───────────── the decision ───────────── */
  if (soil == null) {
    return build('insufficient-data', 'Waiting for a first reading', null,
      'Nothing to calculate yet.', 'Greenr will not guess at soil it has not measured.');
  }
  if (!fresh) {
    return build('insufficient-data', `Last reading was ${Math.round(ageH ?? 0)} h ago`,
      'Check the sensor has power and Wi-Fi.',
      `The last value was ${Math.round(soil)}, but soil can change a lot in ${Math.round(ageH ?? 0)} hours.`,
      'An old reading is not a basis for watering, in either direction.');
  }
  if (badSignal) {
    return build('inconsistent',
      quality === 'not-inserted' ? 'The probe is not in the soil' : 'The soil signal looks faulty',
      quality === 'not-inserted' ? 'Push the probe in to its white line.' : 'Check the probe’s cable and that its electronics are dry.',
      evidence.find((e) => e.key === 'seated')!.detail,
      'A reading taken in air or from a faulty connection says nothing about the plant.');
  }
  if (trace?.inconsistent) {
    return build('inconsistent', 'Readings are jumping around',
      'Reseat the probe and firm the soil around it, then give it a few hours.',
      evidence.find((e) => e.key === 'steady')!.detail,
      'Soil dries smoothly. A trace that zig-zags is the sensor, not the plant, so Greenr holds its advice.');
  }

  const act = waterAction({ plant, reading, history, now });

  if (act.kind === 'retry') {
    return build('retry', act.line, `Pour about ${act.ml} ml slowly, close to the probe.`, act.detail,
      'The soil was dry and a logged watering did not show up at the probe.', act.ml);
  }
  if (act.kind === 'waiting') {
    return build('waiting', act.line, null, act.detail,
      'The reading on screen is from before the watering, so it cannot judge it yet.');
  }
  if (act.kind === 'water') {
    return build('water-now', `Water now — about ${act.ml} ml`,
      `Pour about ${act.ml} ml slowly until it starts to drain, then empty the saucer.`,
      act.detail,
      `The index is ${Math.round(soil)}, below ${name}’s floor of ${lo}.`, act.ml);
  }
  if (act.kind === 'hold') {
    const notDraining = /not draining/i.test(act.line);
    return build(notDraining ? 'not-draining' : 'too-wet', act.line,
      notDraining ? 'Check the drainage holes and empty the saucer.' : 'Hold off watering and let it dry back into range.',
      act.detail,
      notDraining
        ? 'It is still saturated well after it should have drained.'
        : `The index is ${Math.round(soil)}, above ${name}’s ceiling of ${hi}.`);
  }

  // Inside the band. Is it on its way out of it?
  const days = daysToFloor;
  const inDays = (d: number) => (d < 0.75 ? 'within a day' : `in about ${Math.round(d)} day${Math.round(d) === 1 ? '' : 's'}`);
  const substrateLow =
    style !== 'soak-and-dry'
    && substrate.knowledge !== 'unknown'
    && !thresholds.unreliable
    && soil <= thresholds.refillReading;
  const trendSoon = days != null && days <= 2;
  if (substrateLow || trendSoon) {
    const projection = days != null
      ? `At the measured ${retention!.ptsPerDay.toFixed(1)} points a day it reaches ${name}’s floor of ${lo} ${inDays(days)}.`
      : '';
    return build('drying', days != null ? `Drying — likely needs water ${inDays(days)}` : 'Drying — will need water soon',
      days != null && days > 2 ? 'No need to water yet.' : 'No need to water yet. Check again tomorrow.',
      [
        substrateLow
          ? `The index (${Math.round(soil)}) is at or below the point where this mix’s freely available water runs out (${Math.round(thresholds.refillReading)}).`
          : '',
        projection,
      ].filter(Boolean).join(' '),
      `It is still above ${name}’s floor of ${lo}, so watering now would be early${days != null && days <= 1 ? ' — but not by much' : ''}.`);
  }

  return build('in-range', 'Moisture is in range', null,
    days != null
      ? `The index is ${Math.round(soil)}, inside ${lo}–${hi}. At the measured rate it reaches ${lo} ${inDays(days)}.`
      : `The index is ${Math.round(soil)}, inside ${lo}–${hi}.`,
    'Nothing needs doing.');
}
