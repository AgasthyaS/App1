import type { WeatherData } from './weather';

/**
 * The user's LOCAL CLIMATE — what their area can actually support, as opposed to
 * what one windowsill measures.
 *
 * "Will this plant thrive here?" has two different answers depending on where it
 * will live. Indoors, the spot's own light/temperature/humidity decide almost
 * everything. Outdoors, one number dominates everything else: **the coldest
 * night of the year**. A plant rated to −1 °C dies in a −8 °C winter no matter
 * how perfect every other factor is, and no amount of summer sunshine saves it.
 *
 * USDA hardiness zones encode exactly that — they are defined by average annual
 * minimum winter temperature in 10 °F bands. We derive the zone from observed
 * local temperatures (Open-Meteo), so it reflects the user's real location
 * rather than a guess from latitude.
 */

export interface AreaClimate {
  /** typical coldest night of the year, °C (drives hardiness) */
  winterMinC: number;
  /** typical hottest day, °C */
  summerMaxC: number;
  /** USDA-style zone number, 1–13 (fractional: 9.3 = zone 9, upper half) */
  zone: number;
  /** human label, e.g. "Zone 9b" */
  zoneLabel: string;
  /** how much of this is measured vs inferred, 0–1 */
  confidence: number;
}

const cToF = (c: number) => (c * 9) / 5 + 32;

/**
 * USDA zone from the annual minimum temperature. Zone 1 starts at −60 °F and
 * each zone spans 10 °F; the a/b halves split each zone at 5 °F.
 */
export function zoneFromMinC(minC: number): { zone: number; label: string } {
  /*
   * A non-finite minimum has to be clamped before it reaches the label, not
   * after. `Math.max`/`Math.min` pass NaN straight through, so the clamp that
   * appears to bound this to 1-13 did nothing, and the template below rendered
   * the result as the literal string "Zone NaNa". Reachable whenever the
   * forecast the annual minimum is extrapolated from has a gap in it.
   */
  if (!Number.isFinite(minC)) return { zone: 1, label: 'Zone unknown' };
  const minF = cToF(minC);
  const raw = (minF + 60) / 10 + 1;
  const zone = Number.isFinite(raw) ? Math.max(1, Math.min(13, raw)) : 1;
  const whole = Math.floor(zone);
  const half = zone - whole >= 0.5 ? 'b' : 'a';
  return { zone, label: `Zone ${whole}${half}` };
}

/**
 * Estimate the local climate from whatever weather data we have.
 *
 * The forecast only covers a week, so the observed minimum is a floor, not the
 * annual one. We extrapolate to a plausible winter minimum using latitude — the
 * dominant driver of seasonal swing — and mark the result's confidence honestly
 * rather than pretending a 7-day window measured the whole year.
 */
export function areaClimateFrom(
  weather: WeatherData | null,
  latitude?: number | null,
): AreaClimate | null {
  if (!weather?.daily?.length) return null;
  const mins = weather.daily.map((d) => d.tempMinC);
  const maxes = weather.daily.map((d) => d.tempMaxC);
  const observedMin = Math.min(...mins);
  const observedMax = Math.max(...maxes);

  // Seasonal swing grows with distance from the equator: near-zero in the
  // tropics, very large in continental mid-latitudes.
  const lat = Math.abs(latitude ?? 45);
  const swing = 2 + Math.pow(lat / 90, 1.4) * 34; // °C below the current week's low

  // If the observed week is already cold, it IS near the annual minimum.
  const winterMinC = observedMin < 2 ? observedMin - swing * 0.25 : observedMin - swing;
  const summerMaxC = observedMax + (observedMax > 26 ? 2 : swing * 0.5);

  const { zone, label } = zoneFromMinC(winterMinC);
  return {
    winterMinC,
    summerMaxC,
    zone,
    zoneLabel: label,
    // A week of real data plus a latitude model — useful, but not a climate record.
    confidence: latitude != null ? 0.7 : 0.5,
  };
}

/**
 * Parse a care profile's hardiness string ("USDA 10–12 · grown indoors…") into
 * numeric zone limits. Returns null when the text carries no usable range.
 */
export function parseHardiness(text: string | undefined): { min: number; max: number } | null {
  if (!text) return null;
  // Accepts "10-12", "10–12", "USDA 9–11", "5 to 9"
  const m = text.match(/(\d{1,2})\s*(?:[–\-—]|to)\s*(\d{1,2})/);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (a >= 1 && b <= 13 && a <= b) return { min: a, max: b };
  }
  const single = text.match(/(?:USDA|zone)\s*(\d{1,2})/i);
  if (single) {
    const z = parseInt(single[1], 10);
    if (z >= 1 && z <= 13) return { min: z, max: z };
  }
  return null;
}

export interface OutdoorViability {
  /** can it survive the local winter outdoors, unprotected? */
  yearRound: boolean;
  /** can it live outside for the warm season and come in for winter? */
  summerOnly: boolean;
  note: string;
}

/**
 * Can this species live outdoors here? Cold is decisive — a plant either
 * survives the local winter or it doesn't, and no other factor compensates.
 */
export function outdoorViability(
  hardiness: { min: number; max: number } | null,
  area: AreaClimate,
): OutdoorViability {
  if (!hardiness) {
    return { yearRound: false, summerOnly: true, note: 'Hardiness unknown — treat it as tender and bring it in before frost.' };
  }
  const yearRound = area.zone >= hardiness.min;
  // Almost anything tolerates a mild summer outside; the question is winter.
  const summerOnly = !yearRound && area.summerMaxC >= 15;
  if (yearRound) {
    return {
      yearRound: true,
      summerOnly: false,
      note: `Hardy here — rated to zone ${hardiness.min}, and your area is ${area.zoneLabel}, so it can stay out all year.`,
    };
  }
  return {
    yearRound: false,
    summerOnly,
    note: summerOnly
      ? `Not winter-hardy here — it needs zone ${hardiness.min}+ and your area is ${area.zoneLabel} (about ${Math.round(area.winterMinC)}°C at its coldest). Fine outdoors in summer, but bring it in before the first frost.`
      : `Too cold here for outdoors — it needs zone ${hardiness.min}+ and your area is ${area.zoneLabel}. Grow it as a houseplant.`,
  };
}
