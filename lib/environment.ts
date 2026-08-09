import { dailyStats, type DayStat, type MetricKey } from './dailyStats';
import type { Reading } from './devices';
import { lightThresholds, lightVerdict, type DayLight } from './insights';
import { waterProfileFor } from './plants';
import type { SoilDynamics } from './soilDynamics';

/**
 * "Is this spot actually working for this plant?" — answered only when we're SURE.
 *
 * Telling someone to move a plant is a big ask: they have to find a new home for
 * it, and if we're wrong we've made their plant worse and cost us their trust. So
 * this stays silent until the readings themselves prove it — see the note on the
 * confidence test below. Until then the metric is simply "still learning", and
 * confidence genuinely improves with every day the sensor runs.
 *
 * The remedy depends on the metric, because they aren't equally fixable:
 *   light / temperature → the spot itself is wrong, so MOVE the plant
 *   humidity            → usually fixable where it stands (tray, grouping)
 *   moisture            → a watering HABIT, not the room — never "move it"
 */

/**
 * HOW SURE IS SURE? — chosen by simulation, not by feel.
 *
 * A fixed "N days, most of them bad" rule turned out to be a poor test, for a
 * reason that isn't obvious: rounding makes its strictness jump around with N.
 * At 4 days, 70% means 3-of-4 (75%); at 6 days it means 5-of-6 (83%); at 7 days
 * only 5-of-7 (71%). So a 4-day window was one of the LOOSEST settings — it
 * flagged a merely-borderline spot 26% of the time over a month.
 *
 * Instead we ask the question that actually matters: given the spread of the
 * daily readings we've seen, are we 95% sure the TRUE average is beyond the
 * plant's limit? That's a one-sided t-test on the daily means. It adapts by
 * itself — a hopeless spot is obvious in days, a noisy one waits for more
 * evidence — with no arbitrary cut-off anywhere.
 *
 * Monte-Carlo over 30 days of continuous checking, with weather modelled as an
 * AR(1) clearness index (cloud memory ~12–36 h; overcast cuts light 20–50 %):
 *
 *   rule                 hopeless   genuinely-bad   borderline   fine   healthy
 *   fixed 4 d / 70 %       100 %        91 %           26 %      3.6 %   0.2 %
 *   fixed 6 d / 70 %       100 %        89 %           16 %      0.8 %   0.0 %
 *   t-test 95 %, min 5 d   100 %        96 %           11 %      0.4 %   0.0 %   ← chosen
 *
 * The t-test wins on every axis at once: it catches MORE genuinely bad spots,
 * raises FEWER false alarms, and fires sooner (median day 5 for a hopeless spot,
 * day 6 for a marginal one). Crucially it never told a healthy plant to move.
 *
 * Waiting those few days costs nothing biologically: low light shows up as
 * etiolation and leaf drop over one to two WEEKS, so a verdict on day 5–6 is
 * still well ahead of any visible harm.
 */
const MIN_DAYS = 5;   // enough spread to estimate variance honestly
const MAX_DAYS = 14;  // beyond this, older days say little about today's spot

/** One-sided 95% t values; ~1.70 is the large-sample limit. */
const T95: Record<number, number> = {
  3: 2.92, 4: 2.353, 5: 2.132, 6: 2.015, 7: 1.943, 8: 1.895, 9: 1.86, 10: 1.833,
  11: 1.812, 12: 1.796, 13: 1.782, 14: 1.771,
};
const tFor = (n: number) => T95[Math.min(14, Math.max(3, n))] ?? 1.7;

/**
 * Are we 95% confident the true mean sits beyond `threshold`? Compares the far
 * end of the confidence interval, so a wide spread simply means we wait.
 */
function confidentlyBeyond(
  values: number[],
  threshold: number,
  dir: 'below' | 'above',
): { confident: boolean; mean: number; n: number } {
  const n = values.length;
  const mean = n ? values.reduce((a, b) => a + b, 0) / n : 0;
  if (n < MIN_DAYS) return { confident: false, mean, n };
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const margin = tFor(n) * (sd / Math.sqrt(n));
  return {
    confident: dir === 'below' ? mean + margin < threshold : mean - margin > threshold,
    mean,
    n,
  };
}

export type EnvMetric = MetricKey;

export interface EnvironmentVerdict {
  metric: EnvMetric;
  /** true when all three confidence tests passed — only then is this shown as advice */
  confident: boolean;
  /** 'act' = do something now; 'watch' = trending wrong, keep an eye on it */
  severity: 'act' | 'watch';
  /** does fixing it mean relocating the plant? */
  relocate: boolean;
  days: number;
  /** how many of those days were outside the ideal */
  daysOut: number;
  avg: number;
  headline: string;
  detail: string;
  action: string;
}

/** Weighted mean of day averages (each day counted by how well it was covered). */
function meanOf(days: DayStat[]): number {
  const w = days.reduce((a, d) => a + d.hours, 0);
  return w ? days.reduce((a, d) => a + d.avg * d.hours, 0) / w : 0;
}

/** Run the confidence test over a metric's daily averages. */
function assess(days: DayStat[], threshold: number, dir: 'below' | 'above') {
  const vals = days.slice(-MAX_DAYS).map((d) => d.avg);
  const r = confidentlyBeyond(vals, threshold, dir);
  const daysOut = vals.filter((v) => (dir === 'below' ? v < threshold : v > threshold)).length;
  return { ...r, days: vals.length, daysOut };
}

export function environmentVerdicts(opts: {
  species: string;
  plantName: string;
  history: Reading[];
  ideal: { band: [number, number]; dli: [number, number]; temp: [number, number]; rhFloor: number };
  unitsF?: boolean;
  /** per-day light from the store — remembers far longer than the reading window */
  lightDaily?: DayLight[] | null;
  /** suppresses the moisture verdict while a pot is simply draining after a drink */
  soilDyn?: SoilDynamics | null;
}): EnvironmentVerdict[] {
  const { species, plantName, history, ideal, unitsF = true, lightDaily, soilDyn } = opts;
  const out: EnvironmentVerdict[] = [];

  // ── LIGHT — the spot's defining property, and the hardest to change ──
  // Prefer the store's per-day light history: it remembers far longer than the
  // ~6 days of raw readings the sensor window holds.
  const lightDays: DayStat[] = lightDaily?.length
    ? lightDaily.map((d) => ({ day: d.day, avg: d.avg, min: d.avg, max: d.avg, hours: d.hours }))
    : dailyStats(history, 'light');
  if (lightDays.length) {
    const { tooDark, tooBright } = lightThresholds(ideal.dli);
    const dark = assess(lightDays, tooDark, 'below');
    const bright = assess(lightDays, tooBright, 'above');
    const hit = dark.confident || dark.mean < tooDark ? dark : bright;
    const isBright = hit === bright;
    if (dark.mean < tooDark || bright.mean > tooBright) {
      const verdict = lightVerdict(hit.mean, species, ideal.dli, { days: hit.days });
      out.push({
        metric: 'light',
        confident: hit.confident,
        severity: 'act',
        relocate: true,
        days: hit.days,
        daysOut: hit.daysOut,
        avg: verdict.avg,
        headline: isBright
          ? `This spot is too bright for ${plantName}`
          : `This spot is too dark for ${plantName}`,
        detail: `Daytime light has averaged ${verdict.avg}/100 across ${hit.days} day${hit.days === 1 ? '' : 's'}, and ${hit.daysOut} of them were outside what ${species} needs. This isn't one dull day — it's what the spot is like.`,
        action: isBright
          ? 'Move it somewhere shadier, or filter the window with a sheer curtain.'
          : 'Move it closer to a bright window, or add a grow light. Most plants need to be within a metre of the glass.',
      });
    }
  }

  // ── TEMPERATURE — also a property of the place ──
  const tempDays = dailyStats(history, 'temp');
  if (tempDays.length) {
    const [loF, hiF] = ideal.temp;
    const toF = (c: number) => (c * 9) / 5 + 32;
    const inF = tempDays.map((d) => ({ ...d, avg: toF(d.avg) }));
    const coldA = assess(inF, loF - 3, 'below');
    const hotA = assess(inF, hiF + 3, 'above');
    const avgF = toF(meanOf(tempDays));
    const cold = avgF < loF - 3;
    const hot = avgF > hiF + 3;
    const j = cold ? coldA : hotA;
    if (cold || hot) {
      const show = (f: number) => (unitsF ? `${Math.round(f)}°F` : `${Math.round(((f - 32) * 5) / 9)}°C`);
      out.push({
        metric: 'temp',
        confident: j.confident,
        severity: 'act',
        relocate: true,
        days: j.days,
        daysOut: j.daysOut,
        avg: avgF,
        headline: cold ? `Too cold here for ${plantName}` : `Too warm here for ${plantName}`,
        detail: `It has averaged ${show(avgF)} over ${j.days} days (${j.daysOut} of them outside range). ${species} is comfortable at ${show(loF)}–${show(hiF)}.`,
        action: cold
          ? 'Move it off the cold windowsill and away from draughts — glass gets much colder than the room at night.'
          : 'Move it away from the radiator or hot glass, and give it more air movement.',
      });
    }
  }

  // ── HUMIDITY — usually fixable without moving anything ──
  const rhDays = dailyStats(history, 'humidity');
  if (rhDays.length) {
    const floor = ideal.rhFloor;
    const j = assess(rhDays, floor - 8, 'below');
    const avg = meanOf(rhDays);
    if (avg < floor - 8) {
      out.push({
        metric: 'humidity',
        confident: j.confident,
        severity: 'watch',
        relocate: false,
        days: j.days,
        daysOut: j.daysOut,
        avg,
        headline: `The air here is dry for ${plantName}`,
        detail: `Humidity has averaged ${Math.round(avg)}% over ${j.days} days; ${species} wants at least ${floor}%. Dry air shows up as crisping leaf edges before anything else.`,
        action: 'Group it with other plants, stand it on a pebble tray, or run a humidifier nearby — no need to move it.',
      });
    }
  }

  // ── MOISTURE — a watering habit, never a reason to move the plant ──
  // Skipped while the pot is draining after a drink: that's not a chronic state.
  const soilDays = dailyStats(history, 'soil');
  if (soilDays.length && !soilDyn?.draining) {
    const [lo, hi] = ideal.band;
    const tol = waterProfileFor(species).dryTolerance;
    const avg = meanOf(soilDays);
    const dryJ = assess(soilDays, lo - tol * 0.5, 'below');
    const wetJ = assess(soilDays, hi + 8, 'above');
    if (avg < lo - tol * 0.5) {
      out.push({
        metric: 'soil',
        confident: dryJ.confident,
        severity: 'act',
        relocate: false,
        days: dryJ.days,
        daysOut: dryJ.daysOut,
        avg,
        headline: `${plantName} is being under-watered`,
        detail: `Soil has averaged ${Math.round(avg)}% over ${dryJ.days} days — below ${species}'s ${lo}–${hi}% ideal on ${dryJ.daysOut} of them. This is a pattern, not a one-off dry day.`,
        action: 'Water more often, and pour slowly until it runs from the drainage holes so the whole root ball wets through.',
      });
    } else if (avg > hi + 8) {
      out.push({
        metric: 'soil',
        confident: wetJ.confident,
        severity: 'act',
        relocate: false,
        days: wetJ.days,
        daysOut: wetJ.daysOut,
        avg,
        headline: `${plantName} is being over-watered`,
        detail: `Soil has averaged ${Math.round(avg)}% over ${wetJ.days} days, above ${species}'s ${hi}% ceiling on ${wetJ.daysOut} of them. Roots that never dry out start to rot.`,
        action: 'Wait until the top of the soil dries before watering again, and check the pot drains freely.',
      });
    }
  }

  // Confident, act-now items first; relocation advice above in-place fixes.
  return out.sort(
    (a, b) =>
      Number(b.confident) - Number(a.confident) ||
      (a.severity === b.severity ? 0 : a.severity === 'act' ? -1 : 1) ||
      Number(b.relocate) - Number(a.relocate),
  );
}

/** Just the verdicts we're sure enough about to put in front of someone. */
export function confidentVerdicts(
  ...args: Parameters<typeof environmentVerdicts>
): EnvironmentVerdict[] {
  return environmentVerdicts(...args).filter((v) => v.confident);
}
