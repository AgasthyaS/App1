import type { Reading } from './devices';
import { retentionEstimate } from './soilRetention';
import { TENSION, waterContentAt, containerThresholds, mlPerPointPerLiter, MAX_SINGLE_POUR_FRACTION } from './soilProfile';
import type { Plant, SoilMix, SoilRetention } from './types';
import { observedPours, poursAndCeiling, type ObservedPour } from './waterBalance';
import { potVolume } from './watering';

/**
 * MEASURING THE SUBSTRATE INSTEAD OF ASKING ABOUT IT.
 *
 * Prof. Neil Mattson's objection to the whole approach, and it is the right one:
 * different substrates hold water differently because particle size, pore
 * structure and composition decide how strongly water is held, so a moisture
 * threshold that is correct for peat is wrong for bark and wrong again for a
 * gritty cactus mix. His proposed remedy is the interesting part — rather than
 * making the owner identify their medium (which they usually cannot, because it
 * came in an unlabelled bag or was mixed by whoever sold the plant), run a
 * ONE-TIME CALIBRATION and let the pot describe itself:
 *
 *   1. start with the substrate relatively dry, and record a baseline;
 *   2. add a KNOWN volume of water;
 *   3. record how far the reading moves, and
 *   4. record how it decays afterwards as the pot drains, evaporates and drinks.
 *
 * Comparing the water put in against the sensor's response and the subsequent
 * drying pattern yields a curve for THAT POT — long-holding or free-draining —
 * without ever needing the substrate's name.
 *
 * That is what this module does. The app already measured pieces of it
 * opportunistically (`observedPours` for ml-per-point, `retentionEstimate` for
 * the decay), but nothing tied them into one substrate description, nothing
 * derived the physical properties they jointly imply, and nothing walked the
 * owner through producing a clean measurement on purpose.
 *
 * ───────────────────── WHAT THE THREE NUMBERS ACTUALLY MEAN ──────────────────
 *
 * A single well-formed pour yields three INDEPENDENT observations, and it is
 * their combination that identifies a substrate rather than any one alone:
 *
 *   ml PER DISPLAY POINT — how much water it takes to move the reading. Chiefly
 *     a property of the pot's size and the medium's moisture-release curve.
 *
 *   PROMPT DRAINAGE — how much of the peak reading falls away in the first hours
 *     while the pot is still draining. This is gravitational water leaving, and
 *     the share of it is a direct read on AIR-FILLED POROSITY: a coarse bark or
 *     pumice mix sheds a lot within an hour, fine peat almost none.
 *
 *   DECAY TIME — the e-folding time of the slow decline afterwards, once
 *     drainage has stopped and only evaporation and the roots are removing
 *     water. This is water-holding proper.
 *
 * A mix can be high on one and low on another, which is exactly why one
 * threshold cannot serve them all. Coarse bark drains fast AND holds what is
 * left tenaciously in its particles; dense old compost drains slowly AND gives
 * its water up slowly. Two numbers separate cases one number confuses.
 *
 * ───────────────── AND WHY THERE IS NO BULK DENSITY IN g/cm³ ─────────────────
 *
 * There was, briefly. De Boodt's framework partitions a container into solids,
 * air at capacity and water at capacity, so measuring two gives the third and a
 * particle density turns the solid fraction into g/cm³. It computed. It was
 * wrong, and the way it was wrong is worth recording.
 *
 * The water-at-capacity term came from `mlPerPoint × workingPoints ÷ potVolume`,
 * and `workingPoints` is the pot's range in display points AS PREDICTED BY THE
 * MODELLED THRESHOLDS — the very model this calibration exists to replace. A
 * measurement that leans on the assumption it is meant to check is not a
 * measurement. It duly produced 5–7% water at capacity where the growing-media
 * literature says 30–60%, and classified a light bark mix and a heavy compost
 * both as "dense", from figures of 1.15 and 1.53 g/cm³ that looked authoritative
 * and meant nothing.
 *
 * So density is reported as a CLASS, derived only from quantities this app
 * actually measures:
 *
 *   ml PER POINT PER LITRE — the measured dose divided by the pot's volume, so
 *     two different-sized pots are comparable. In simulation a peat mix came out
 *     at 3.3 and a gritty one at 14.8: a four-fold separation from measurement
 *     alone, with no model in the chain.
 *
 *   DRY-DOWN TIME — which resolves the ambiguity in that figure, because a
 *     reading moves reluctantly for two opposite reasons. An open, coarse mix
 *     needs a lot of water per point because most of it passes through; a dense,
 *     compacted one needs a lot because it is holding tightly. They are opposite
 *     substrates and the dry-down time tells them apart at a glance.
 *
 * The result is a description a person can act on — "light and open", "dense and
 * heavy" — rather than a number with false precision behind it.
 *
 * ────────────────────────────── HONESTY RULES ────────────────────────────────
 *
 * A calibration pour that SATURATED the pot measures nothing about ml-per-point
 * — once water is running out of the base, more water stops moving the reading —
 * so those pours are used only for capacity and drainage, never for the dose.
 * That is Prof. Waller's "see if everything starts to level out to see if water
 * is piling up", and `plateauAfterPour` below is exactly that test.
 */

/* ─────────────────────────────── constants ──────────────────────────────── */

/** Water is still draining and redistributing for about this long after a pour. */
const DRAIN_WINDOW_H = 4;
/** …and the reading has settled by here. Beyond it, decline is drying, not drainage. */
const SETTLE_BY_H = 26;
/** A calibration pour must move the reading at least this far to be readable. */
const MIN_RISE_PTS = 3;
/** A peak within this of the pot's highest-ever reading counts as "at the top". */
const PLATEAU_TOLERANCE_PTS = 3;
/**
 * …and delivering less than this share of the rise the retention prior predicts.
 * Deliberately severe: that prior is good to ±6–9 points and was observed to be
 * out by a factor of two on ordinary pots, so anything less strict fires on them.
 */
const DIMINISHED_RETURN = 0.25;
/** Below this share of the pot, a pour is too small to calibrate from. */
const MIN_POUR_FRACTION = 0.02;
/**
 * Prompt drainage is mostly finished within an hour or two, so a probe reporting
 * less often than this has already missed it and cannot measure what was retained.
 */
const MAX_GAP_FOR_RETENTION_H = 1.5;

export type DensityClass = 'open' | 'light' | 'medium' | 'dense';

export interface PlateauVerdict {
  /** the reading stopped responding while water was still going in */
  plateaued: boolean;
  /** the level it stopped at */
  atPct: number | null;
  /** how much of the peak drained away again within the first hours */
  fallbackPts: number | null;
  headline: string;
}

export interface SubstrateCalibration {
  /** how much of this rests on a deliberate calibration rather than incidental pours */
  basis: 'guided' | 'observed' | 'insufficient';
  /** pours that were clean enough to measure from */
  usablePours: number;
  /** millilitres that move this pot's reading one display point — MEASURED */
  mlPerPoint: number | null;
  /**
   * The water that moves this pot across its OBSERVED reading range, as a
   * fraction of pot volume — measured, with no modelled threshold in the chain.
   *
   * Not the same as total water-holding capacity, and deliberately not called
   * that: the probe reads the top 6.5 cm on a non-linear scale, and a pot is
   * never driven from bone-dry to saturated. It is the usable, sensed water,
   * which is the part any watering decision actually turns on.
   */
  sensedWaterFraction: number | null;
  /**
   * Air-filled porosity at container capacity, v/v, from the drainage the sensor
   * caught. A LOWER BOUND at a three-hourly interval, for the same reason
   * `retainedFraction` is an upper one: the drainage that happened before the
   * first sample is invisible, and there is more of it in an open mix.
   */
  airFilledPorosity: number | null;
  /**
   * The share of a watering still held at the settled reading, measured against
   * the highest reading the SENSOR SAW — which is not the same as the highest
   * the pot reached.
   *
   * Read the caveat before using this. At a three-hourly reporting interval the
   * first sample after a watering already misses most of the prompt drainage, so
   * this is an UPPER bound on what was retained, and the faster the pot drains
   * the more it flatters it. In simulation a mix losing over half of every pour
   * measured 92% here, because the sensor never saw the peak it fell from.
   *
   * It becomes meaningful at an hourly interval, which is why `calibrationPlan`
   * asks for one. Null rather than a guess when the cadence cannot support it.
   */
  retainedFraction: number | null;
  /** true when the reporting interval is too slow for `retainedFraction` to mean anything */
  cadenceTooSlow: boolean;
  /** measured dose per litre of pot — the size-normalised density signal */
  mlPerPointPerLiter: number | null;
  /** how open or dense this substrate behaves, from measurement alone */
  densityClass: DensityClass | null;
  /** easily-available water as a share of pot volume — De Boodt's 0.20–0.30 optimum */
  easilyAvailableFraction: number | null;
  /** days from drained to needing water, at reference demand */
  dryDownDays: number | null;
  retentionClass: SoilRetention | null;
  /** the mix this pot BEHAVES like, whatever the owner called it */
  behavesLike: SoilMix | null;
  /** true when the owner's stated mix and the measurement disagree materially */
  contradictsStated: boolean;
  /** 0–1 */
  confidence: number;
  headline: string;
  detail: string;
  /** what would sharpen it, when anything would */
  nextStep: string | null;
}

export type CalibrationStage =
  /** the pot is too wet to start — a calibration must begin dry */
  | 'wait-until-dry'
  /** ready: pour a measured amount now */
  | 'pour-now'
  /** poured; the reading is still moving */
  | 'settling'
  /** settled, now watching the decline */
  | 'watching-drydown'
  /** the pot has never been seen refilled, so "dry" has no meaning yet */
  | 'learning-range'
  /** enough evidence */
  | 'complete';

export interface CalibrationPlan {
  stage: CalibrationStage;
  /** the amount to pour, when that is the current step */
  suggestedMl: number | null;
  /** what the owner should do right now */
  instruction: string;
  /** why this step exists — the science, in a sentence */
  why: string;
  /** 0–1 through the whole procedure */
  progress: number;
  /** hours until the next step can happen, when it is a wait */
  waitHours: number | null;
}

type CalPlant = Pick<Plant,
  'potSize' | 'potCm' | 'potHeightCm' | 'potShape' | 'potMaterial'
  | 'soilMix' | 'soilRetention' | 'hasDrainage' | 'probeDepthCm' | 'waterLog'
> & { id?: string; species?: string; comfortBand?: [number, number] | null };

/* ───────────────────────── Waller: does it level out? ───────────────────── */

/**
 * Did the reading STOP RESPONDING while water was still going in?
 *
 * Prof. Waller's test, and the cleanest signal of saturation the sensor can
 * give. Once the pot is at container capacity the next millilitre does not raise
 * the reading — it goes out of the base, or worse, stands in the saucer. So a
 * flat top on the response curve means water is piling up rather than being
 * absorbed, and the pour has stopped measuring anything about ml-per-point.
 *
 * ──────────────── WHY IT IS NOT SIMPLY "SEVERAL FLAT SAMPLES" ────────────────
 *
 * The obvious implementation looks for a run of level readings just after the
 * pour, and it does not work, because a sensor reporting every three hours puts
 * ONE sample inside the window where the pot is still filling. There is no flat
 * top to see; by the second sample the pot is already draining. Written that way
 * the test never fired once in simulation, which is a test that would have
 * shipped looking correct and detecting nothing.
 *
 * What IS visible at that cadence is DIMINISHING RETURN. A known volume of water
 * predicts a rise, from the pot's own size and the retention curve's slope at the
 * level it started from. A pour that delivered far less rise than it bought —
 * while finishing at the top of everything this pot has ever read — did not fail
 * to be measured; it filled the pot and the rest went through. The second
 * signature is a large fallback: water that appears at the peak and is gone a few
 * hours later never entered the medium in the first place, it was in transit.
 *
 * Both are measurable from three-hourly readings, which is the only cadence that
 * matters.
 *
 * ────────────── AND WHY IT IS NOT `ObservedPour.saturated` EITHER ────────────
 *
 * That flag means "this pour's peak landed within four points of the highest
 * reading this pot has ever given", which is a deliberately cautious rule for the
 * DOSE — banking a flooding pour as a measurement is how the app once asked a
 * 16 L pot for 975 ml. But it is the wrong question here. Somebody who waters
 * the same amount at the same trigger every time produces pours that all land in
 * the same place, none of which saturated anything; the flag marks every one of
 * them, and a substrate measurement filtered on it sees nothing at all. That is
 * exactly what happened — the calibration returned "not measured yet" for a
 * perfectly well-behaved pot with three clean pours in its history.
 */
export function plateauAfterPour(
  pour: ObservedPour,
  history: Reading[],
  plant?: Pick<Plant, 'potSize' | 'potCm' | 'potHeightCm' | 'potShape'>,
): PlateauVerdict {
  const pts = history
    .filter((r) => r.soil_pct != null && Number.isFinite(r.soil_pct))
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.soil_pct as number }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  if (!pts.length) {
    return { plateaued: false, atPct: null, fallbackPts: pour.fallbackPts, headline: '' };
  }

  const highestEver = Math.max(...pts.map((p) => p.v));
  const atTop = pour.peakPct >= highestEver - PLATEAU_TOLERANCE_PTS;

  /*
   * THE YARDSTICK HAS TO BE THE POT'S VOLUME, NOT THE RETENTION PRIOR.
   *
   * The first attempt asked whether the pour delivered at least half the rise
   * the van Genuchten prior predicted. That prior is honestly documented in
   * `soilProfile` as good to ±6–9 points and routinely superseded by
   * measurement — and in simulation it under-priced a point by about two-fold
   * for BOTH a genuine flood and a perfectly ordinary pour into a gritty mix.
   * With the prior that far out, no fixed threshold on it separates the two:
   * the gritty pot's four good pours were all discarded as floods, and the
   * substrate came back unmeasurable.
   *
   * The volume test is not circular in that way. A pot cannot absorb more than
   * roughly a quarter of its own volume in one pass — past that the water
   * channels down the sides and out of the base, which is why the same constant
   * already caps every suggested dose in the app. So a pour bigger than that,
   * landing at the top of everything this pot has ever read, has demonstrably
   * piled up rather than soaked in. Pot volume is also the input this codebase
   * is most confident in: `formulaCheck` verifies it against πr²h directly.
   *
   * The prior is kept as a second gate, but only at a threshold gross enough
   * that a two-fold prior error cannot reach it.
   */
  const liters = plant ? potVolume(plant).liters : null;
  const pourFraction = liters != null && liters > 0 ? pour.ml / (liters * 1000) : null;
  const tooMuchForOnePass = pourFraction != null && pourFraction > MAX_SINGLE_POUR_FRACTION;

  const predictedRise =
    liters != null ? pour.ml / Math.max(1, mlPerPointPerLiter(pour.fromPct) * liters) : null;
  const delivered = predictedRise != null && predictedRise > 1 ? pour.risePts / predictedRise : null;
  const diminished = delivered != null && delivered < DIMINISHED_RETURN;

  /*
   * ONLY DIMINISHED RETURN COUNTS. An earlier version also treated a large
   * fallback — water that appears at the peak and is gone hours later — as
   * evidence of saturation, and that was wrong in a way that destroyed the
   * measurement it was meant to protect: a free-draining mix ALWAYS sheds a
   * large share of every pour within hours. That is not a full pot, it is high
   * air-filled porosity, and it is precisely the property being measured. In
   * simulation the gritty pot had every one of its four perfectly good pours
   * thrown away as "saturated" and reported as unmeasurable.
   *
   * The fallback is still measured, and still used — as air-filled porosity,
   * which is what it actually is. It just no longer disqualifies a pour.
   */
  const fallbackPts = pour.fallbackPts;
  const plateaued = atTop && (tooMuchForOnePass || diminished);

  return {
    plateaued,
    atPct: plateaued ? pour.peakPct : null,
    fallbackPts,
    headline: plateaued
      ? `That watering levelled off at ${pour.peakPct.toFixed(0)}% — ${
          tooMuchForOnePass && pourFraction != null
            ? `${pour.ml} ml is ${Math.round(pourFraction * 100)}% of this pot's volume, more than it can take in one pass`
            : delivered != null
              ? `it lifted the reading only ${Math.round(delivered * 100)}% as far as ${pour.ml} ml should have`
              : 'it stopped responding'
        }, so the pot was already full and the rest went past the roots.`
      : 'The reading rose in proportion to the water, so none of it was wasted.',
  };
}

/* ───────────────────────── the substrate measurement ────────────────────── */

const mixLabel = (m: SoilMix | null): string => m ?? 'an unfamiliar mix';

/**
 * Open or dense, from the two things that were actually measured.
 *
 * A high dose per litre means the reading moves reluctantly, and that happens
 * for two opposite reasons — so the dry-down time is what disambiguates. Fast
 * and reluctant is an open mix losing water through it; slow and reluctant is a
 * dense one holding on to it.
 */
function classifyDensity(mlPerPointPerLiter: number, ptsPerDay: number | null): DensityClass {
  const reluctant = mlPerPointPerLiter > 8;
  const responsive = mlPerPointPerLiter < 4;
  /*
   * The OBSERVED decline, not the fitted dry-down days. The fit is an
   * extrapolation to a floor the readings may never reach, and it inherits
   * whatever error is in that floor; points-per-day is a straight observation
   * with nothing between it and the sensor. For a classification into three
   * buckets, the plain measurement is both sufficient and safer.
   */
  const fast = ptsPerDay != null && ptsPerDay >= 3;
  const slow = ptsPerDay != null && ptsPerDay < 1.2;
  if (reluctant && fast) return 'open';
  if (reluctant && slow) return 'dense';
  if (responsive && slow) return 'dense';
  if (responsive) return 'light';
  return 'medium';
}

const DENSITY_WORDS: Record<DensityClass, string> = {
  open: 'open and coarse — most of a watering passes straight through, so it behaves like bark, pumice or grit',
  light: 'light and responsive, the way a fresh peat or coir blend behaves',
  medium: 'a middling substrate — a general-purpose compost',
  dense: 'dense and retentive — fine, compacted, or with a good deal of mineral soil in it',
};

/**
 * Everything the pot's own pours say about what it is made of.
 *
 * Deliberately separate from `perPointFor`: that reconciles a dose from every
 * source available, prior included, and is right to. This measures, and returns
 * nothing where nothing was measured — so a caller can tell "we know this pot"
 * from "we have a decent guess about this pot", which is the distinction the
 * whole calibration idea rests on.
 */
export function substrateCalibration(
  plant: CalPlant,
  history: Reading[],
  now = Date.now(),
): SubstrateCalibration {
  const vol = potVolume(plant);
  const potMl = vol.liters * 1000;
  const stated = plant.soilMix ?? null;

  const empty: SubstrateCalibration = {
    basis: 'insufficient',
    usablePours: 0,
    mlPerPoint: null,
    sensedWaterFraction: null,
    airFilledPorosity: null,
    retainedFraction: null,
    cadenceTooSlow: false,
    mlPerPointPerLiter: null,
    densityClass: null,
    easilyAvailableFraction: null,
    dryDownDays: null,
    retentionClass: null,
    behavesLike: null,
    contradictsStated: false,
    confidence: 0,
    headline: 'This pot has not been measured yet',
    detail:
      'Greenr is working from published figures for the mix you named, which describe an average bag of that compost rather than the one in this pot. One measured watering, starting from dry, replaces the average with this pot.',
    nextStep: 'Run a calibration watering: let it dry out, then pour a measured amount and log the exact figure.',
  };

  if (!history.length) return empty;

  const { ceiling } = poursAndCeiling(plant, history, now);
  const pours = observedPours(plant, history, ceiling, now)
    .filter((p) => p.ml >= potMl * MIN_POUR_FRACTION);
  if (!pours.length) return empty;

  /*
   * ml PER POINT comes only from pours that did NOT saturate. Once the pot is
   * full the reading stops answering, so a saturating pour would report a huge
   * ml-per-point that is really just "the rest ran out of the bottom" — the
   * error that had this app asking a 16 L pot for 975 ml when 400 filled it.
   */
  const plateaus = new Map(pours.map((p) => [p.at, plateauAfterPour(p, history, plant)]));
  const clean = pours.filter(
    (p) => !plateaus.get(p.at)?.plateaued && p.risePts >= MIN_RISE_PTS);
  const perPointSamples = clean.map((p) => p.ml / p.risePts).filter((v) => Number.isFinite(v) && v > 0);
  const mlPerPoint = perPointSamples.length
    ? perPointSamples.slice().sort((a, b) => a - b)[Math.floor(perPointSamples.length / 2)]
    : null;

  /*
   * AIR-FILLED POROSITY from prompt drainage. A pour that filled the pot and
   * then lost height in the first hours has shown us its gravitational water:
   * the share of the peak that drained away, expressed against the pot's whole
   * working range, is the volume that air reclaimed.
   */
  const geo = {
    potHeightCm: plant.potHeightCm ?? 16,
    soilMix: stated,
    soilRetention: plant.soilRetention ?? null,
    probeDepthCm: plant.probeDepthCm ?? null,
  };
  const th = containerThresholds(geo);
  const workingPoints = Math.max(1, th.capacityReading - th.stressReading);

  const drainers = pours.filter((p) => p.settledPct != null && p.fallbackPts != null && p.fallbackPts >= 0);
  void DRAIN_WINDOW_H;
  const fallbackShare = drainers.length
    ? drainers.reduce((a, p) => a + (p.fallbackPts as number), 0) / drainers.length / workingPoints
    : null;

  /*
   * THE SENSED WATER, from the pot's OWN observed range rather than the modelled
   * one. `workingPoints` above comes from `containerThresholds`, i.e. from the
   * retention model — using it here would make the measurement depend on the
   * assumption it exists to test. What the pot has actually been seen to do is
   * independent of all of that.
   */
  const values = history
    .map((r) => r.soil_pct)
    .filter((v): v is number => v != null && Number.isFinite(v))
    .sort((a, b) => a - b);
  const observedRange = values.length >= 12
    ? values[Math.floor(values.length * 0.95)] - values[Math.floor(values.length * 0.05)]
    : null;
  const sensedWaterFraction =
    mlPerPoint != null && potMl > 0 && observedRange != null && observedRange > 0
      ? Math.max(0.005, Math.min(0.95, (mlPerPoint * observedRange) / potMl))
      : null;

  const airFilledPorosity =
    fallbackShare != null && mlPerPoint != null
      ? Math.max(0.02, Math.min(0.6, fallbackShare))
      : null;

  /*
   * APPLIED vs RETAINED, which is not a subtlety — it is a factor of two.
   *
   * `mlPerPoint` above is measured against the SETTLED reading, hours after the
   * pour, and that is deliberate: it is the number you need in order to decide
   * how much to pour, because it already accounts for whatever ran through. But
   * it means the figure for a free-draining pot looks alarming next to the
   * instantaneous physics. A gritty mix here measured 91 ml to hold a point
   * where the water going in was worth 40 — the pot did take all of it, and then
   * let more than half go within four hours.
   *
   * Both numbers are true and they answer different questions, so both are
   * reported. The ratio between them is a substrate property in its own right,
   * and the most immediately useful thing this whole calibration produces: of
   * every hundred millilitres you pour, this is how much is still there in the
   * morning.
   */
  /*
   * …and this is only computable if the sensor reports often enough to have
   * SEEN the peak. Prompt drainage is largely over within an hour or two; a
   * probe reporting every three hours takes its first post-watering sample after
   * the fact, so `peakPct` is not the peak, it is already the aftermath, and the
   * ratio comes out near one for every substrate alike. Reporting the number
   * anyway would be worse than reporting nothing, because it would look like a
   * measurement and read as "this pot keeps almost everything" for a pot that
   * keeps half.
   */
  const stamps = history
    .filter((r) => r.soil_pct != null && Number.isFinite(r.soil_pct))
    .map((r) => new Date(r.created_at).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < stamps.length; i++) gaps.push((stamps[i] - stamps[i - 1]) / 3600000);
  const medianGapH = gaps.length
    ? gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
    : 3;
  const cadenceTooSlow = medianGapH > MAX_GAP_FOR_RETENTION_H;

  const retained = cadenceTooSlow ? [] : pours
    .map((p) => {
      const peakRise = p.peakPct - p.fromPct;
      return peakRise > 0.5 ? Math.max(0, Math.min(1, p.risePts / peakRise)) : null;
    })
    .filter((v): v is number => v != null);
  const retainedFraction = retained.length
    ? retained.slice().sort((a, b) => a - b)[Math.floor(retained.length / 2)]
    : null;

  const perLiter = mlPerPoint != null && vol.liters > 0 ? mlPerPoint / vol.liters : null;

  /* EASILY AVAILABLE WATER — the 10→50 cm slice, the part a plant takes freely. */
  const eawPoints = Math.max(
    0,
    waterContentAt(TENSION.containerCapacity, stated ?? 'Standard mix', plant.soilRetention ?? null)
      - waterContentAt(TENSION.easilyAvailable, stated ?? 'Standard mix', plant.soilRetention ?? null),
  );
  const easilyAvailableFraction =
    mlPerPoint != null && potMl > 0 ? (mlPerPoint * eawPoints) / potMl : null;

  /* THE DECAY — reuse the fitted dry-down rather than refitting it here. */
  const ret = retentionEstimate(plant as Parameters<typeof retentionEstimate>[0], history);
  const dryDownDays = ret?.dryDays ?? null;
  const retentionClass = ret?.value ?? null;

  /*
   * WHAT IT BEHAVES LIKE. Drainage separates coarse from fine; decay separates
   * holding from not-holding. Neither alone identifies a medium — a bark mix and
   * a peat mix can share a dry-down time and share nothing else.
   */
  const behavesLike: SoilMix | null = (() => {
    if (airFilledPorosity == null && (ret?.ptsPerDay ?? null) == null) return null;
    const airy = (airFilledPorosity ?? 0) > 0.22;
    const rate = ret?.ptsPerDay ?? null;
    const fast = rate != null && rate >= 3;
    const slow = rate != null && rate < 1.2;
    if (airy && fast) return 'Gritty / cactus';
    if (airy && !fast) return 'Chunky / aroid';
    if (slow) return 'Dense / heavy';
    return 'Standard mix';
  })();

  const usablePours = clean.length;
  const confidence = Math.max(0, Math.min(1,
    (mlPerPoint != null ? 0.4 : 0) +
    Math.min(0.25, usablePours * 0.12) +
    (airFilledPorosity != null ? 0.2 : 0) +
    (ret?.confident ? 0.2 : ret ? 0.08 : 0)));

  const contradictsStated =
    behavesLike != null && stated != null && behavesLike !== stated && confidence >= 0.5;

  const basis: SubstrateCalibration['basis'] =
    mlPerPoint == null ? 'insufficient' : usablePours >= 2 && ret?.confident ? 'guided' : 'observed';

  if (mlPerPoint == null) {
    return {
      ...empty,
      usablePours: 0,
      dryDownDays,
      retentionClass,
      retainedFraction,
      cadenceTooSlow,
      confidence: Math.min(0.25, confidence),
      headline: 'Not measured yet — every logged watering so far filled the pot',
      detail:
        'A watering that runs out of the base cannot measure how much water moves the reading: past the point the pot is full, more water changes nothing. Greenr needs one pour that stops short of that.',
      nextStep: 'Next time, water when the pot is dry and pour about half what you normally would, then log the exact amount.',
    };
  }

  const density = perLiter != null ? classifyDensity(perLiter, ret?.ptsPerDay ?? null) : null;

  const headline =
    contradictsStated
      ? `This pot behaves like ${mixLabel(behavesLike)}, not the ${mixLabel(stated)} it is set to`
      : `Measured: about ${Math.round(mlPerPoint)} ml moves this pot one point`;

  const detail = [
    `From ${usablePours} watering${usablePours === 1 ? '' : 's'} that did not fill the pot, ${Math.round(mlPerPoint)} ml raises the reading by one point.`,
    sensedWaterFraction != null
      ? ` Moving it across the whole range it actually operates in takes about ${Math.round(sensedWaterFraction * 100)}% of the pot's volume in water`
      : '',
    airFilledPorosity != null
      ? `, and at least ${Math.round(airFilledPorosity * 100)}% drains away as air in the first hours — that share is what separates an open mix from a close one.`
      : '.',
    density != null && perLiter != null
      ? ` At ${perLiter.toFixed(1)} ml per point per litre of pot, it is ${DENSITY_WORDS[density]}.`
      : '',
    retainedFraction != null && retainedFraction < 0.95
      ? ` Of every 100 ml you pour, about ${Math.round(retainedFraction * 100)} ml is still there a few hours later — the rest drains straight through, which is why the figure above is higher than the water alone would suggest.`
      : cadenceTooSlow
        ? ` How much of each watering actually stays cannot be measured at this sensor's reporting interval — the drainage is over before the next reading. Setting it to hourly for one watering would answer it.`
        : '',
    dryDownDays != null
      ? ` It then takes about ${dryDownDays.toFixed(1)} days to go from drained to needing water again.`
      : '',
    easilyAvailableFraction != null
      ? ` Easily-available water comes to ${Math.round(easilyAvailableFraction * 100)}% of the pot, against the 20–30% growing-media research treats as ideal.`
      : '',
  ].join('');

  const nextStep =
    usablePours < 2
      ? 'One more measured watering from dry would confirm it — two agreeing pours are much stronger than one.'
      : ret?.confident
        ? null
        : 'Greenr is still watching this pot dry out; the holding time will sharpen over the next week or two.';

  return {
    basis,
    usablePours,
    mlPerPoint: Math.round(mlPerPoint * 10) / 10,
    sensedWaterFraction,
    airFilledPorosity,
    retainedFraction: retainedFraction != null ? Math.round(retainedFraction * 100) / 100 : null,
    cadenceTooSlow,
    mlPerPointPerLiter: perLiter != null ? Math.round(perLiter * 10) / 10 : null,
    densityClass: density,
    easilyAvailableFraction,
    dryDownDays,
    retentionClass,
    behavesLike,
    contradictsStated,
    confidence: Math.round(confidence * 100) / 100,
    headline,
    detail,
    nextStep,
  };
}

/* ─────────────────────────── the guided procedure ───────────────────────── */

/**
 * What to do next to calibrate this pot, as a single instruction.
 *
 * Neil Mattson's protocol needs the pot to START DRY, and that is the part an
 * opportunistic measurement never gets: a pour onto already-damp compost moves
 * the reading by an amount that depends on where it started, so the arithmetic
 * is contaminated before it begins. Hence a procedure rather than a passive
 * observation — the app waits for the right moment and then asks for one
 * specific, measured action.
 *
 * The suggested volume is Prof. Waller's rule of thumb: about a tenth of the
 * pot's volume. It is deliberately a MODEST pour. A generous one would saturate
 * the pot and measure nothing (see `plateauAfterPour`), and the point of this
 * exercise is a clean ml-per-point, not a thorough watering.
 */
export function calibrationPlan(
  plant: CalPlant,
  history: Reading[],
  now = Date.now(),
): CalibrationPlan {
  const cal = substrateCalibration(plant, history, now);
  const vol = potVolume(plant);
  const suggestedMl = Math.max(50, Math.round((vol.liters * 1000 * 0.1) / 25) * 25);

  const pts = history
    .filter((r) => r.soil_pct != null && Number.isFinite(r.soil_pct))
    .map((r) => ({ t: new Date(r.created_at).getTime(), v: r.soil_pct as number }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  const latest = pts.length ? pts[pts.length - 1] : null;

  const geo = {
    potHeightCm: plant.potHeightCm ?? 16,
    soilMix: plant.soilMix ?? null,
    soilRetention: plant.soilRetention ?? null,
    probeDepthCm: plant.probeDepthCm ?? null,
  };
  void containerThresholds(geo);

  if (cal.basis === 'guided') {
    return {
      stage: 'complete',
      suggestedMl: null,
      progress: 1,
      waitHours: null,
      instruction: 'This pot is calibrated — nothing more to do.',
      why: cal.headline,
    };
  }

  // A pour logged recently: we are in the measurement, not waiting to start it.
  const lastPour = (plant.waterLog ?? [])
    .map((w) => new Date(w.at).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)
    .pop();
  const sincePourH = lastPour != null ? (now - lastPour) / 3600000 : null;

  if (sincePourH != null && sincePourH < SETTLE_BY_H) {
    const remaining = Math.max(0, SETTLE_BY_H - sincePourH);
    return {
      stage: 'settling',
      suggestedMl: null,
      progress: 0.55,
      waitHours: Math.round(remaining),
      instruction: `Nothing to do — leave it alone for about ${Math.round(remaining)} more hours.`,
      why:
        'Water keeps moving through a pot for most of a day after it goes in. Reading the sensor before it stops moving would measure water in transit rather than water the substrate is holding.',
    };
  }

  if (sincePourH != null && sincePourH < 24 * 10 && cal.mlPerPoint != null) {
    return {
      stage: 'watching-drydown',
      suggestedMl: null,
      progress: 0.8,
      waitHours: null,
      instruction: 'Nothing to do — let it dry naturally and do not water until Greenr says so.',
      why:
        'How fast the reading falls once drainage has stopped is the second half of the measurement: it is how strongly this substrate holds the water it kept, which no single pour can show.',
    };
  }

  /*
   * "DRY ENOUGH" HAS TO COME FROM THE POT, NOT FROM THE MODEL.
   *
   * The obvious test — is the reading below the modelled refill threshold — sent
   * the calibration into a wait it could never leave. A 20 cm standard-mix pot
   * models a refill point of 14%, and the pot in question genuinely operates
   * between 22% and 45%: it is never going to read 14%, so a plan gated on that
   * says "wait until it dries" forever, on a pot that is already as dry as it
   * gets. The same equilibrium-range limit the formula checker turned up.
   *
   * So where there is history, the pot's OWN observed range decides: within the
   * bottom fifth of everything it has actually shown is as dry as this pot goes,
   * and that is the repeatable starting point the procedure needs. The modelled
   * threshold is the fallback for a pot with no history to speak of, where it is
   * the only figure available.
   */
  /*
   * …but a range only exists once the pot has been REFILLED at least once.
   *
   * A trace that only ever falls is not an operating range, it is a snapshot of
   * a decay in progress: its lowest point is simply wherever the decline had got
   * to when we looked, and calling that "dry" would tell someone to calibrate a
   * pot that is still half full. Nor can the modelled threshold stand in, since
   * that is the figure a real pot may never reach at all.
   *
   * When neither is available the honest answer is to say so and wait, rather
   * than pick whichever number happens to produce an instruction.
   */
  const refills = (() => {
    let n = 0;
    for (let i = 1; i < pts.length; i++) if (pts[i].v - pts[i - 1].v >= 5) n++;
    return n;
  })();
  const lows = pts.map((x) => x.v).sort((a, b) => a - b);
  const rangeKnown = pts.length >= 24 && refills >= 1;
  const observedLow = rangeKnown ? lows[Math.floor(lows.length * 0.05)] : null;
  const observedHigh = rangeKnown ? lows[Math.floor(lows.length * 0.95)] : null;

  if (!rangeKnown) {
    return {
      stage: 'learning-range',
      suggestedMl: null,
      progress: 0.05,
      waitHours: null,
      instruction: 'Water as you normally would for now — Greenr needs to watch one full cycle first.',
      why:
        'A calibration has to start from a dry, repeatable point, and Greenr cannot yet say where dry is for this pot. Published figures for a named compost describe an average bag rather than this one, and a reading that has only ever fallen shows where the decline had got to, not where it ends. One watering and one dry-down settles it.',
    };
  }

  const dryTarget = observedLow! + (observedHigh! - observedLow!) * 0.2;

  const tooWet = latest != null && latest.v > dryTarget;
  if (tooWet) {
    return {
      stage: 'wait-until-dry',
      suggestedMl: null,
      progress: 0.15,
      waitHours: null,
      instruction: `Wait until the soil reads about ${Math.round(dryTarget)}% — it is at ${Math.round(latest!.v)}% now.`,
      why:
        `The measurement compares a known volume of water against how far it moves the reading, which only works from a dry, repeatable starting point. This pot has ranged between ${Math.round(observedLow!)}% and ${Math.round(observedHigh!)}%, so ${Math.round(dryTarget)}% is near the dry end of what it actually does — not a textbook figure it may never reach.`,
    };
  }

  return {
    stage: 'pour-now',
    suggestedMl,
    progress: 0.35,
    waitHours: null,
    instruction: `Set this sensor to report hourly, then pour ${suggestedMl} ml — measured, not estimated — and log that exact figure.`,
    why:
      `About a tenth of this pot's ${vol.liters.toFixed(1)} litres, which is Prof. Waller's rule for a container irrigation. Deliberately modest: a thorough soak would fill the pot and stop the reading responding, which measures nothing. ` +
      `The hourly interval matters because most of the drainage is over inside two hours — at the usual three-hourly reporting the first reading after a watering arrives too late to see how much ran through, and that share is half of what tells one substrate from another. Devices → this sensor → Reporting. Put it back to three-hourly afterwards.`,
  };
}
