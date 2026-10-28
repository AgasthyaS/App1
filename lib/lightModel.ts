/**
 * Light photometry — turning the sensor's uncalibrated 0–100 light index into a
 * physically-grounded Daily Light Integral (DLI, mol/m²/day), the unit plants
 * are actually specified in.
 *
 * The chain is real photometry, not a linear guess:
 *
 *   1. index → illuminance (lux).  A photoresistor's resistance is roughly
 *      logarithmic in illuminance, and the firmware maps its ADC to 0–100, so
 *      lux is modelled as a LOG interpolation between a dim-room floor and a
 *      direct-sun ceiling:
 *          lux(i) = LUX_MIN · (LUX_MAX / LUX_MIN)^(i/100)
 *
 *   2. lux → PPFD (µmol/m²/s).  Photosynthetic photon flux density is what
 *      drives photosynthesis. For broad daylight-ish spectra the accepted
 *      conversion is ≈ 0.0185 µmol·m⁻²·s⁻¹ per lux.
 *
 *   3. PPFD → DLI (mol/m²/day).  Integrate PPFD over the effective daily
 *      photoperiod:  DLI = PPFD · photoperiodSeconds / 1e6.
 *
 * Because step 1 is uncalibrated, every result carries a confidence band — the
 * math is rigorous, the input is coarse, and the UI is told to say so. A real
 * lux meter (e.g. a BH1750) would collapse the band to a point.
 */

/** Illuminance a light index of 0 maps to (dim interior, lux). */
const LUX_MIN = 80;
/** Illuminance a light index of 100 maps to (near direct sun, lux). */
const LUX_MAX = 65000;
/** Accepted broad-spectrum daylight conversion, µmol·m⁻²·s⁻¹ per lux. */
const LUX_TO_PPFD = 0.0185;
/**
 * Hours of daylight the daytime average is integrated over. The average itself
 * is taken between the real local sunrise and sunset, so the DLI must use the
 * same length of day — a fixed 11 h was up to ~30% out in midsummer and
 * midwinter. Set alongside the daylight window (lib/insights); 12 h, matching
 * that window's 07:00–19:00 fallback, until it is known.
 */
let PHOTOPERIOD_H = 12;

export function setPhotoperiodHours(hours: number): void {
  if (Number.isFinite(hours) && hours >= 4 && hours <= 22) PHOTOPERIOD_H = hours;
}

/** Light index (0–100) → estimated illuminance in lux (log-interpolated). */
export function indexToLux(index: number): number {
  const i = Math.max(0, Math.min(100, index));
  return LUX_MIN * Math.pow(LUX_MAX / LUX_MIN, i / 100);
}

/** Illuminance (lux) → photosynthetic photon flux density (µmol/m²/s). */
export function luxToPpfd(lux: number): number {
  return lux * LUX_TO_PPFD;
}

/** PPFD (µmol/m²/s) → Daily Light Integral (mol/m²/day) over the photoperiod. */
export function ppfdToDli(ppfd: number, photoperiodH: number = PHOTOPERIOD_H): number {
  return (ppfd * photoperiodH * 3600) / 1e6;
}

export interface DliEstimate {
  /** best-estimate DLI, mol/m²/day */
  dli: number;
  /** low / high bounds from the index quantisation + uncalibrated-LDR uncertainty */
  low: number;
  high: number;
  /** estimated illuminance, lux */
  lux: number;
  /** photosynthetic photon flux density, µmol/m²/s */
  ppfd: number;
}

/**
 * Full DLI estimate from a light index, with an uncertainty band. The band
 * comes from propagating a ±1 σ multiplicative error on the LDR (a factor of
 * about 2 for an uncalibrated part behind the case lid) through the
 * (monotonic) photometry chain.
 */
export function estimateDli(index: number, photoperiodH: number = PHOTOPERIOD_H): DliEstimate {
  const lux = indexToLux(index);
  const ppfd = luxToPpfd(lux);
  const dli = ppfdToDli(ppfd, photoperiodH);
  // Multiplicative 1σ uncertainty. Uncalibrated photoresistors vary by about a
  // factor of two from part to part, and the case's lid window cuts the light
  // again before it reaches the sensor — 1.4 was optimistic.
  const SIGMA = 2.0;
  return {
    dli,
    low: dli / SIGMA,
    high: dli * SIGMA,
    lux,
    ppfd,
  };
}

/** The inverse: what light index corresponds to a target DLI (for labelling axes/goals). */
export function dliToIndex(dli: number, photoperiodH: number = PHOTOPERIOD_H): number {
  /*
   * A negative or non-finite DLI has to clamp, not propagate.
   *
   * `Math.log` of a negative number is NaN, and NaN survives both `Math.min` and
   * `Math.max` untouched — so the clamp that looks like it bounds this to 0–100
   * returned NaN for any negative input. That is reachable: an inverted light
   * sensor (the app has a `setLightInverted` switch precisely because they
   * exist) or a miscalibrated one can produce one.
   */
  if (!Number.isFinite(dli) || dli <= 0) return 0;
  const ppfd = (dli * 1e6) / (photoperiodH * 3600);
  const lux = ppfd / LUX_TO_PPFD;
  const i = 100 * (Math.log(lux / LUX_MIN) / Math.log(LUX_MAX / LUX_MIN));
  return Number.isFinite(i) ? Math.max(0, Math.min(100, i)) : 0;
}

/** A plain-language bracket for a DLI value, independent of any species. */
export function dliBracket(dli: number): string {
  if (dli < 1) return 'deep shade';
  if (dli < 3) return 'low / bright shade';
  if (dli < 6) return 'bright indirect';
  if (dli < 12) return 'some direct sun';
  if (dli < 20) return 'high / partial full sun';
  return 'full sun';
}
