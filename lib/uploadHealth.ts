import type { Device, Reading } from './devices';

/**
 * ARE THE READINGS STILL ARRIVING?
 *
 * Written after the failure that motivated it: every sensor on the account
 * stopped uploading on 20 August, and nobody found out for thirteen days. The
 * data was gone for a fortnight and the app never once said so.
 *
 * That is not because nothing knew. `connectionFrom` had the device marked
 * offline the whole time, and `sensorHealth` would have called it silent. The
 * problem is WHERE those live: on the devices screen and the per-plant screen,
 * both of which you have to go looking for. The screen people actually open
 * showed plant cards with soil percentages on them, and a two-week-old number
 * looks exactly like a fresh one.
 *
 * So this module exists to answer the fleet-level question once, cheaply enough
 * to run on every render of Home, and to answer it in a form that can be put in
 * front of somebody who was not looking for it.
 *
 * ─────────────────────────── THE THREE BLIND SPOTS ───────────────────────────
 *
 * 1. CADENCE WAS HARDCODED. `connectionFrom` called a device offline after 420
 *    minutes, full stop. Every device carries `wake_seconds` — the interval the
 *    server itself hands back to the firmware on each upload — so the app knew
 *    the right answer and used a constant instead. A sensor deliberately set to
 *    report once a day would have shown "offline" every single day of its life.
 *
 * 2. THE CADENCE WAS INFERRED FROM WHAT ARRIVED. `sensorSilence` takes the
 *    median gap between readings as "normal", which is right when there is
 *    nothing better and quietly wrong when there is: a sensor that decays from
 *    one reading every 3 hours to one a day re-medians to 24 h and reports
 *    itself perfectly regular at an eighth of its real rate. Failure that
 *    redefines success is the hardest kind to see. Configured cadence wins here,
 *    and measurement is the fallback rather than the source.
 *
 * 3. SILENCE LONGER THAN THE WINDOW ERASED ITSELF. The app holds 30 days of
 *    readings. At 31 days of silence the history is empty, and an empty history
 *    is indistinguishable from a sensor that never existed — the outage would
 *    have become invisible precisely when it got serious. `last_seen` on the
 *    device row does not expire, so it is the primary clock here and the reading
 *    history is only used for the shape of the delivery.
 *
 * ──────────────────────── SILENT IS NOT THE ONLY FAULT ───────────────────────
 *
 * A sensor that misses half its slots and then catches up is never silent for
 * long enough to trip any threshold, but it has thrown away half the evidence.
 * Every dry-down curve this app fits gets noisier, and nothing says why. So
 * delivery is measured as a SHARE of what was expected across a window, and a
 * sensor delivering 40% of its readings is reported as failing even though one
 * arrived an hour ago.
 */

export type UploadState =
  /** registered, but nothing has ever arrived */
  | 'never'
  /** nothing for several expected intervals — the sensor has stopped */
  | 'silent'
  /** still reporting, but losing a large share of its slots */
  | 'dropping'
  /** delivering acceptably overall, with at least one real hole in the record */
  | 'irregular'
  /** arriving on schedule */
  | 'steady';

export interface UploadHealth {
  deviceId: string;
  label: string;
  state: UploadState;
  /** 0 = fine, 100 = needs attention now */
  severity: number;
  /** how often this sensor is SUPPOSED to report, in hours */
  expectedGapH: number;
  expectedSource: 'configured' | 'measured' | 'assumed';
  hoursSinceLast: number | null;
  /** scheduled slots that have gone by unanswered */
  missedInARow: number;
  /** received ÷ expected over the window, 0–1; null when there is nothing to judge */
  deliveredShare: number | null;
  windowDays: number;
  longestGapH: number | null;
  headline: string;
  detail: string;
  /** the concrete next step, not a restatement of the problem */
  action: string | null;
}

/** Fall back to this when a device carries no cadence at all. */
const ASSUMED_GAP_H = 3;
/** Cadences outside this are a corrupt `wake_seconds`, not a choice. */
const MIN_GAP_H = 1 / 60;
const MAX_GAP_H = 24;
/** Silent once this many scheduled reports have been missed… */
const SILENT_AFTER_INTERVALS = 3;
/** …but never call a fast-cycling sensor dead inside a couple of hours. */
const SILENT_FLOOR_H = 12;
/** Below this share of expected readings, the record is too thin to model from. */
const DROPPING_SHARE = 0.7;
/** A gap this many intervals wide is a real outage, even if it has since recovered. */
const HOLE_INTERVALS = 3;
/** How far back delivery is judged. Long enough to be a rate, short enough to be current. */
const WINDOW_DAYS = 14;

const hours = (ms: number) => ms / 3600000;

/** "13 days" / "7 hours" — the unit people would actually use for that length. */
export function spanLabel(h: number): string {
  if (!Number.isFinite(h)) return 'an unknown time';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

/** Median of a numeric list. */
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

type UploadDevice = Pick<Device, 'id' | 'label' | 'wake_seconds' | 'last_seen'>;

/**
 * How reliably one sensor is delivering.
 *
 * `history` may be empty — that is the 31-day-outage case, and it is handled
 * from `last_seen` rather than treated as "no such device".
 */
export function uploadHealth(opts: {
  device: UploadDevice;
  history?: Reading[];
  now?: number;
}): UploadHealth {
  const { device, now = Date.now() } = opts;
  const history = opts.history ?? [];
  const label = device.label?.trim() || 'This sensor';

  const stamps = history
    .map((r) => new Date(r.created_at).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);

  /*
   * CADENCE. The device's own `wake_seconds` is what the firmware was told to
   * do, so it is the only figure that can call a slowdown a slowdown. Measured
   * gaps are the fallback, and a flat assumption the last resort — each labelled
   * so the caller can say how much the verdict is worth.
   */
  const gaps: number[] = [];
  for (let i = 1; i < stamps.length; i++) gaps.push(hours(stamps[i] - stamps[i - 1]));
  const configuredH = device.wake_seconds ? device.wake_seconds / 3600 : null;
  const measuredH = median(gaps);
  const [expectedGapH, expectedSource]: [number, UploadHealth['expectedSource']] =
    configuredH != null && configuredH >= MIN_GAP_H && configuredH <= MAX_GAP_H
      ? [configuredH, 'configured']
      : measuredH != null && measuredH > 0
        ? [Math.min(MAX_GAP_H, measuredH), 'measured']
        : [ASSUMED_GAP_H, 'assumed'];

  /*
   * THE CLOCK. `last_seen` outlives the reading window; the newest reading is
   * more precise while it exists. Take whichever is later so neither a pruned
   * history nor a stale device row can make the sensor look worse than it is.
   */
  const lastSeenMs = device.last_seen ? new Date(device.last_seen).getTime() : NaN;
  const candidates = [
    Number.isFinite(lastSeenMs) ? lastSeenMs : null,
    stamps.length ? stamps[stamps.length - 1] : null,
  ].filter((t): t is number => t != null);
  const lastAt = candidates.length ? Math.max(...candidates) : null;

  const base = {
    deviceId: device.id,
    label,
    expectedGapH,
    expectedSource,
    windowDays: WINDOW_DAYS,
  };

  if (lastAt == null) {
    return {
      ...base,
      state: 'never',
      severity: 50,
      hoursSinceLast: null,
      missedInARow: 0,
      deliveredShare: null,
      longestGapH: null,
      headline: `${label} has never uploaded`,
      detail:
        'It is registered to your account but no reading has ever arrived from it, so there is nothing for Greenr to work from. That is almost always setup rather than hardware — the board was never flashed with its own id and key, or it has never joined Wi-Fi.',
      action: 'Run Wi-Fi setup for this sensor, and check it was flashed with its own device id and key.',
    };
  }

  const hoursSinceLast = hours(now - lastAt);
  const missedInARow = Math.max(0, Math.floor(hoursSinceLast / expectedGapH) - 1);

  /*
   * DELIVERY RATE. Counted against how many reports the window SHOULD have
   * contained, not against how many arrived — the whole point is to notice the
   * ones that did not. The window is trimmed to the period the app could
   * actually have seen: judging a sensor set up yesterday against fourteen days
   * would mark every new device as failing.
   */
  const windowMs = WINDOW_DAYS * 86400000;
  const firstSeen = stamps.length ? stamps[0] : null;
  const windowStart = Math.max(now - windowMs, firstSeen ?? now - windowMs);
  const windowH = hours(now - windowStart);
  const inWindow = stamps.filter((t) => t >= windowStart);
  const expectedCount = windowH / expectedGapH;
  /*
   * NO HISTORY IS NOT THE SAME AS NO DELIVERIES, and conflating them produced a
   * false alarm on the most ordinary case there is. An UNPAIRED sensor has no
   * plant, so the shared snapshot holds no readings for it — and dividing zero
   * readings by fourteen days of expectation called a device that reported five
   * minutes ago "losing readings". The rate is only computable when there is a
   * record to compute it from; without one the honest answer is nothing, and
   * `last_seen` still catches the case that matters (it having stopped).
   */
  const deliveredShare =
    stamps.length > 0 && expectedCount >= 2
      ? Math.min(1, inWindow.length / expectedCount)
      : null;

  const windowGaps: number[] = [];
  for (let i = 1; i < inWindow.length; i++) windowGaps.push(hours(inWindow[i] - inWindow[i - 1]));
  // The run of silence up to now counts as a gap too — otherwise a sensor that
  // stopped yesterday shows a perfect record right up to the moment it died.
  if (inWindow.length) windowGaps.push(hoursSinceLast);
  const longestGapH = windowGaps.length ? Math.max(...windowGaps) : null;

  const common = { ...base, hoursSinceLast, missedInARow, deliveredShare, longestGapH };
  const cadence = `about every ${spanLabel(expectedGapH)}`;

  const silentThresholdH = Math.max(SILENT_FLOOR_H, expectedGapH * SILENT_AFTER_INTERVALS);
  if (hoursSinceLast > silentThresholdH) {
    return {
      ...common,
      state: 'silent',
      // Long outages outrank short ones, but a sensor down for two days is
      // already as actionable as one down for two weeks — so this saturates.
      severity: Math.min(100, 80 + Math.min(20, missedInARow)),
      headline: `No readings from ${label} for ${spanLabel(hoursSinceLast)}`,
      detail:
        `It should report ${cadence}, so ${missedInARow} report${missedInARow === 1 ? ' has' : 's have'} been missed. ` +
        'Everything Greenr shows for this plant describes it as it was then, not now — the soil percentage on the card is that old too.',
      action:
        'Check the sensor has power and your 2.4 GHz Wi-Fi is up. If you changed router or password, it reopens Bluetooth setup on its own — run Wi-Fi setup to point it at the new network.',
    };
  }

  if (deliveredShare != null && deliveredShare < DROPPING_SHARE) {
    const pct = Math.round(deliveredShare * 100);
    return {
      ...common,
      state: 'dropping',
      severity: 65,
      headline: `${label} is losing readings`,
      detail:
        `Only ${pct}% of the readings expected in the last ${WINDOW_DAYS} days actually arrived (${inWindow.length} of about ${Math.round(expectedCount)}). ` +
        'It is still reporting, so this is easy to miss, but every missing reading is a piece of the drying curve Greenr fits — the watering amounts get vaguer as the record thins.',
      action:
        'Usually weak Wi-Fi at the pot rather than the sensor. Move it closer to the router, or add a repeater, and check the battery.',
    };
  }

  if (longestGapH != null && longestGapH > expectedGapH * HOLE_INTERVALS) {
    return {
      ...common,
      state: 'irregular',
      severity: 40,
      headline: `${label} has an unexplained gap`,
      detail:
        `It is reporting normally now, but there was a ${spanLabel(longestGapH)} gap in the last ${WINDOW_DAYS} days against a ${spanLabel(expectedGapH)} cadence. ` +
        'A gap that spans a watering is the expensive kind: the rise gets missed, so that pour teaches Greenr nothing about this pot.',
      action: 'Worth checking Wi-Fi strength where the pot stands, and the battery level.',
    };
  }

  return {
    ...common,
    state: 'steady',
    severity: 0,
    headline: `${label} is reporting on schedule`,
    detail:
      `Last reading ${hoursSinceLast < 1 ? 'just now' : `${spanLabel(hoursSinceLast)} ago`}, ${cadence}` +
      (deliveredShare != null ? `, ${Math.round(deliveredShare * 100)}% of expected readings delivered.` : '.'),
    action: null,
  };
}

export interface FleetUpload {
  /** the single worst sensor, for a one-line banner */
  worst: UploadHealth;
  all: UploadHealth[];
  failing: UploadHealth[];
  counts: Record<UploadState, number>;
  severity: number;
  headline: string;
  detail: string;
}

/**
 * One verdict for the whole account, for the top of Home.
 *
 * Returns null when every sensor is fine — a banner that is always there is a
 * banner nobody reads. It also deliberately reports the SHARED case first:
 * three sensors that stopped within the same hour is a router or an outage, and
 * saying "3 sensors have stopped" sends you to the right place, where three
 * separate "check the battery" cards would not.
 */
export function fleetUploadHealth(list: UploadHealth[]): FleetUpload | null {
  const counts: Record<UploadState, number> = {
    never: 0, silent: 0, dropping: 0, irregular: 0, steady: 0,
  };
  for (const h of list) counts[h.state] += 1;

  const failing = list
    .filter((h) => h.state !== 'steady')
    .sort((a, b) => b.severity - a.severity);
  if (!failing.length) return null;

  const worst = failing[0];
  const silent = failing.filter((h) => h.state === 'silent');

  let headline: string;
  let detail: string;
  if (silent.length > 1) {
    // Everything down at once is one fault, not several.
    const longest = Math.max(...silent.map((h) => h.hoursSinceLast ?? 0));
    headline = `${silent.length} sensors have stopped uploading`;
    detail =
      `Nothing has arrived from ${silent.length === list.length ? 'any of your sensors' : `${silent.length} of your ${list.length} sensors`} for up to ${spanLabel(longest)}. ` +
      'Several stopping together usually means the network rather than the sensors — a changed Wi-Fi password, a new router, or an outage at the house.';
  } else if (failing.length > 1) {
    headline = worst.headline;
    detail = `${worst.detail} ${failing.length - 1} other sensor${failing.length === 2 ? ' also needs' : 's also need'} attention.`;
  } else {
    headline = worst.headline;
    detail = worst.detail;
  }

  return {
    worst,
    all: list,
    failing,
    counts,
    severity: worst.severity,
    headline,
    detail,
  };
}
