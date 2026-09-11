import type { Reading } from './devices';
import { containerThresholds } from './soilProfile';
import { potVolume } from './watering';
import type { Plant } from './types';

/**
 * WHEN THE PROBE CANNOT SEE THE POT — measuring the instrument, then working
 * around it.
 *
 * There is a class of pot this app is nearly blind in, and no amount of modelling
 * fixes it because the information is not in the signal. A gritty cactus mix in a
 * 16 cm pot has about 1.7 display points between soaked and bone dry: the whole
 * moisture range of that plant is smaller than two points of sensor noise. Deep
 * pots have a milder version of the same problem, because the probe occupies the
 * top 6.5 cm, which in a 30 cm pot is the driest slice and barely moves.
 *
 * The app already flags this (`containerThresholds.unreliable`) and then carries
 * on using the reading anyway. This module does the two things that actually
 * help.
 *
 * ────────────────────── 1. RESCALE ONTO THE POT'S OWN RANGE ──────────────────
 *
 * The 0–100 display scale is a property of the SENSOR, not of the pot. If a pot
 * has only ever been observed between 3% and 9%, then 9% IS soaked for that pot
 * and 3% IS dry, and the useful question is not "what is the reading" but "where
 * in this pot's own range is it". Rescaling turns six points of raw travel into a
 * full 0–100 relative scale, which is legible to a person and usable by the
 * model.
 *
 * This is honest as long as the range is real — which is why it is measured from
 * observed extremes with outliers trimmed, and why it refuses to rescale until it
 * has seen enough of a range to be sure it is not amplifying noise.
 *
 * ────────────────────── 2. FALL BACK TO TIME, NOT LEVEL ──────────────────────
 *
 * The second insight matters more. When the LEVEL is unresolvable, the TIMING
 * usually is not: the probe still shows a clear step when water goes in, and the
 * clock still runs. So for a pot the sensor cannot read, the app can stop asking
 * "how wet is it" and switch to "how long since it was watered, against how long
 * this pot has historically lasted". That is exactly how people water cacti
 * anyway, and it degrades to something useful instead of something wrong.
 *
 * The distinction the module makes is therefore not "working / broken" but
 * "which question can this sensor actually answer for this pot".
 */

/** Sensor noise floor in display points — from the observed reading-to-reading jitter. */
const DEFAULT_NOISE_PTS = 1.5;
/** A range must be at least this many noise-widths to be worth rescaling. */
const MIN_SNR_TO_RESCALE = 3;
/** …and this many before the raw reading can be trusted directly. */
const MIN_SNR_FOR_RAW = 8;
/** Trim this share off each end of the observed range — one spike is not a range. */
const OUTLIER_TRIM = 0.05;
/** A watering of at least this share of the pot counts as a real drink (Waller). */
const ADEQUATE_POUR_FRACTION = 0.08;
/** …and the pot must have topped out at the same level this many separate times. */
const MIN_TOP_OUTS = 3;

export type ProbeMode = 'direct' | 'rescaled' | 'time-based';

export interface ProbeResolution {
  /** how the app should read this pot */
  mode: ProbeMode;
  /** the pot's own observed operating range, in display points */
  observedLow: number;
  observedHigh: number;
  rangePts: number;
  /** measured reading-to-reading jitter, in display points */
  noisePts: number;
  /** range ÷ noise — how many genuinely distinguishable steps the probe has here */
  signalToNoise: number;
  /** what the model predicts the range SHOULD be, for comparison */
  modelledRangePts: number;
  /** readings behind the estimate */
  samples: number;
  /** the pot's whole operating range sits outside the species' comfort band */
  bandUnreachable: boolean;
  headline: string;
  detail: string;
}

/** Median of a numeric list. */
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

type ResolutionPlant = Pick<Plant,
  'potHeightCm' | 'soilMix' | 'soilRetention' | 'probeDepthCm' | 'potCm' | 'potShape' | 'waterLog'>;

/**
 * How much this probe can actually tell us about this pot.
 *
 * Everything is measured from the pot's own history — the modelled range is only
 * carried alongside for comparison, never used in place of what was observed.
 */
export function probeResolution(
  plant: ResolutionPlant,
  history: Reading[],
  /**
   * The species' comfort band. Supplied because a pot can have a perfectly
   * readable range that sits entirely OUTSIDE it — see `bandUnreachable`.
   */
  band?: [number, number] | null,
): ProbeResolution | null {
  const vals = history
    .filter((r) => r.soil_pct != null && Number.isFinite(r.soil_pct))
    .map((r) => r.soil_pct as number);
  if (vals.length < 12) return null;

  const sorted = [...vals].sort((a, b) => a - b);
  const trim = Math.max(1, Math.floor(sorted.length * OUTLIER_TRIM));
  const observedLow = sorted[trim];
  const observedHigh = sorted[sorted.length - 1 - trim];
  const rangePts = Math.max(0, observedHigh - observedLow);

  /*
   * NOISE, measured rather than assumed. Consecutive readings three hours apart
   * differ by real drying plus sensor jitter. Drying is slow and one-directional;
   * jitter is fast and symmetric, so the MEDIAN absolute step is dominated by
   * jitter and is a fair floor. Using a fixed constant instead would call a quiet
   * sensor noisy and a noisy one precise.
   */
  const steps: number[] = [];
  for (let i = 1; i < vals.length; i++) steps.push(Math.abs(vals[i] - vals[i - 1]));
  const noisePts = Math.max(0.3, median(steps) || DEFAULT_NOISE_PTS);
  const signalToNoise = rangePts / noisePts;

  const th = containerThresholds({
    potHeightCm: plant.potHeightCm ?? 16,
    soilMix: plant.soilMix ?? null,
    soilRetention: plant.soilRetention ?? null,
    probeDepthCm: plant.probeDepthCm ?? null,
  });

  /*
   * A SECOND WAY THE LEVEL CAN BE UNUSABLE, and the one that actually bit.
   *
   * Signal-to-noise only asks whether the reading MOVES. It does not ask whether
   * it moves anywhere near the range the plant is judged against. A gritty pot
   * observed between 5.3% and 9.7% has a genuinely readable 4.4-point range — and
   * a snake plant's floor is 10%, which that pot can never reach. Judged on the
   * level it is "below its floor" every single day of its life, so the app would
   * say "water soon" forever, on a succulent, which is how you kill one.
   *
   * When the observed range barely overlaps the band, the band is not a
   * meaningful yardstick for this pot and the honest move is the same as for an
   * unreadable probe: stop reading the level, start counting the days.
   */
  const overlap = band
    ? Math.min(observedHigh, band[1]) - Math.max(observedLow, band[0])
    : Infinity;

  /*
   * …BUT "NEVER REACHES" HAS TO MEAN CANNOT, NOT HAS NOT.
   *
   * The overlap test alone fires on a pot that is simply under-watered, and that
   * is the worst possible place to get this wrong. A Monstera given two modest
   * drinks in two months sat between 22% and 32% against a 30% floor — barely
   * overlapping — and was declared unreadable, which SWITCHED OFF the "this
   * plant needs water" advice for a plant whose whole problem was needing water.
   * The one thing it needed to be told was the one thing the diagnosis
   * suppressed.
   *
   * A pot that physically cannot reach its band has been offered the water and
   * failed to get there. So two conditions have to hold as well as the overlap:
   *
   *   IT HAS BEEN GIVEN A REAL DRINK — at least one watering of about a tenth of
   *   the pot's volume, Prof. Waller's rule for an irrigation. Without that we
   *   have no evidence about where the pot tops out, only about how much its
   *   owner pours.
   *
   *   AND IT TOPPED OUT THERE REPEATEDLY — the observed high was reached on
   *   several separate occasions, so it is a ceiling rather than the highest
   *   point of one wet week.
   */
  const potMl = potVolume({
    potSize: 'M',
    potCm: plant.potCm ?? null,
    potHeightCm: plant.potHeightCm ?? null,
    potShape: plant.potShape,
  }).liters * 1000;
  const hadRealDrink = (plant.waterLog ?? []).some(
    (w) => typeof w.ml === 'number' && w.ml >= potMl * ADEQUATE_POUR_FRACTION);

  // Separate excursions to the top of the range, at least a day apart.
  const stamps = history
    .filter((r) => r.soil_pct != null && Number.isFinite(r.soil_pct))
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.soil_pct as number }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);
  let topOuts = 0;
  let lastTop = -Infinity;
  for (const x of stamps) {
    if (x.v >= observedHigh - 2 && x.t - lastTop > 24 * 3600000) {
      topOuts++;
      lastTop = x.t;
    }
  }

  /*
   * …AND IT HAS TO BE THE DRY SIDE. This fired on a pot that never reached its
   * band because it sat permanently ABOVE it — a Monstera watered 1.5 litres
   * every four days into a pot with no drainage hole, operating between 50% and
   * 78% against a 30–55% band. The overlap test cannot tell the two apart: a
   * succulent that can never get wet enough and a plant that is drowning both
   * "never reach the band".
   *
   * They could not be more different. The first needs the level ignored and the
   * calendar followed; the second needs somebody told to stop watering it. And
   * because the time-based verdict short-circuits the rating, the drowning plant
   * was reported as "Fine — about 4 days to go" while `soilDynamics` was
   * simultaneously saying "Still waterlogged, the water isn't draining".
   *
   * A pot whose ceiling is above the band's ceiling is not one this probe cannot
   * read. It is one that is too wet, which is a diagnosis, not a limitation.
   */
  const bandUnreachable =
    band != null && rangePts > 0 && overlap < rangePts * 0.25
    && observedHigh <= band[1]
    && hadRealDrink && topOuts >= MIN_TOP_OUTS;

  const mode: ProbeMode =
    bandUnreachable ? 'time-based'
      : signalToNoise >= MIN_SNR_FOR_RAW ? 'direct'
        : signalToNoise >= MIN_SNR_TO_RESCALE ? 'rescaled'
          : 'time-based';

  const headline =
    bandUnreachable ? 'This pot never reaches the range this plant is judged against'
      : mode === 'direct' ? 'The probe reads this pot clearly'
      : mode === 'rescaled' ? 'This pot uses a narrow slice of the scale — Greenr has rescaled it'
        : 'The probe cannot resolve moisture in this pot';

  const detail = (() => {
    const range = `${observedLow.toFixed(0)}–${observedHigh.toFixed(0)}%`;
    if (bandUnreachable) {
      return `This pot has only ever read between ${range}, which barely touches the ${band![0]}–${band![1]}% range this species is judged against — so on the level alone it would look thirsty every day of its life, which for a plant like this is exactly how it gets over-watered. Greenr has switched to timing instead: how long since it was watered, against how long this pot usually lasts.`;
    }
    if (mode === 'direct') {
      return `Readings here span ${range}, comfortably more than the ±${noisePts.toFixed(1)} point jitter, so the number can be taken at face value.`;
    }
    if (mode === 'rescaled') {
      return `This pot has only ever moved between ${range} — about ${rangePts.toFixed(1)} points, against ±${noisePts.toFixed(1)} of sensor noise. That is real but cramped, so Greenr now reads moisture as a position WITHIN that range rather than on the raw 0–100 scale. ${observedHigh.toFixed(0)}% is this pot's "full" and ${observedLow.toFixed(0)}% is its "dry".`;
    }
    return `This pot has only ever moved ${rangePts.toFixed(1)} points (${range}), which is inside the sensor's own ±${noisePts.toFixed(1)} point jitter — there is genuinely no moisture signal to read, usually because a coarse mix in a deep pot leaves the probe zone dry even when the pot is full. Greenr has switched this plant to timing instead: it watches WHEN you water and how long that lasts, and ignores the level. That is how these plants are watered anyway.`;
  })();

  return {
    mode,
    bandUnreachable,
    observedLow,
    observedHigh,
    rangePts: Math.round(rangePts * 10) / 10,
    noisePts: Math.round(noisePts * 10) / 10,
    signalToNoise: Math.round(signalToNoise * 10) / 10,
    modelledRangePts: Math.round(th.workingPoints * 10) / 10,
    samples: vals.length,
    headline,
    detail,
  };
}

/**
 * A reading expressed as a position within this pot's own range, 0–100.
 *
 * Returns the raw reading unchanged when the pot uses the scale normally — there
 * is no reason to transform a signal that is already legible, and doing so would
 * make two plants' numbers incomparable for no gain.
 */
export function relativeWetness(reading: number, res: ProbeResolution | null): number {
  if (!res || res.mode === 'direct' || res.rangePts <= 0) return reading;
  const t = (reading - res.observedLow) / res.rangePts;
  return Math.max(0, Math.min(100, t * 100));
}

/**
 * Map a threshold expressed on the raw scale onto the pot's own range, so
 * comparisons stay in one coordinate system.
 */
export function relativeThreshold(thresholdPct: number, res: ProbeResolution | null): number {
  return relativeWetness(thresholdPct, res);
}

export interface TimeBasedSchedule {
  /** median days between waterings this pot has actually shown */
  intervalDays: number | null;
  /** days since the last watering */
  sinceDays: number | null;
  /** days until the next one is due, from the measured interval */
  dueInDays: number | null;
  confident: boolean;
  headline: string;
  detail: string;
}

/**
 * The fallback for a pot the probe cannot read: schedule from the CLOCK.
 *
 * Watering events are still visible even when the level is not — a pour produces
 * a step the sensor can see, and the timestamps are exact. So the interval can be
 * measured directly from the gaps between waterings, which is the same thing a
 * person does when they say "I water the cactus every three weeks".
 *
 * Built from logged waterings where they exist, and from detected steps where
 * they do not, because in exactly the pots that need this the owner is least
 * likely to be logging.
 */
export function timeBasedSchedule(
  plant: Pick<Plant, 'waterLog' | 'lastWateredAt'>,
  history: Reading[],
  res: ProbeResolution | null,
  now = Date.now(),
): TimeBasedSchedule {
  const events: number[] = (plant.waterLog ?? [])
    .map((w) => new Date(w.at).getTime())
    .filter((t) => Number.isFinite(t));

  // Detected steps, for the common case of a cactus nobody logs. The bar scales
  // with this pot's own noise so it stays meaningful in a cramped range.
  const step = Math.max(2, (res?.noisePts ?? DEFAULT_NOISE_PTS) * 2.5);
  const pts = history
    .filter((r) => r.soil_pct != null && Number.isFinite(r.soil_pct))
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.soil_pct as number }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].v - pts[i - 1].v >= step) {
      // Don't double-count a detected step that a log already covers.
      if (!events.some((e) => Math.abs(e - pts[i].t) < 18 * 3600000)) events.push(pts[i].t);
    }
  }
  events.sort((a, b) => a - b);

  const gaps: number[] = [];
  for (let i = 1; i < events.length; i++) {
    const d = (events[i] - events[i - 1]) / 86400000;
    if (d >= 0.5 && d <= 200) gaps.push(d);
  }
  const intervalDays = gaps.length ? median(gaps) : null;

  const lastAt = events.length ? events[events.length - 1] : null;
  const sinceDays = lastAt != null ? (now - lastAt) / 86400000 : null;
  const dueInDays =
    intervalDays != null && sinceDays != null ? intervalDays - sinceDays : null;

  const confident = gaps.length >= 2;

  return {
    intervalDays: intervalDays != null ? Math.round(intervalDays * 10) / 10 : null,
    sinceDays: sinceDays != null ? Math.round(sinceDays * 10) / 10 : null,
    dueInDays: dueInDays != null ? Math.round(dueInDays * 10) / 10 : null,
    confident,
    headline:
      intervalDays == null
        ? 'Still learning this plant’s rhythm'
        : dueInDays != null && dueInDays <= 0
          ? `Due — it usually goes about ${Math.round(intervalDays)} days`
          : `About ${Math.round(dueInDays ?? intervalDays)} days to go`,
    detail:
      intervalDays == null
        ? 'Greenr needs to see two waterings before it can time this pot. Water as you normally would and it will learn the rhythm.'
        : `Measured from ${gaps.length + 1} watering${gaps.length ? 's' : ''}: this pot goes about ${Math.round(intervalDays)} days between drinks${sinceDays != null ? `, and it has been ${Math.round(sinceDays)}` : ''}. The moisture reading is not used here — in this pot it cannot tell wet from dry.`,
  };
}
