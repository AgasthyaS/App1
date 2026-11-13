import { ADC_MAX } from './moisture';

/**
 * THE LIGHT SIGNAL — what a photoresistor on a voltage divider can and cannot say.
 *
 * The sensor is an LDR in series with a fixed resistor; the microcontroller
 * reads the voltage between them. With the LDR on the low side (which is how
 * these modules are built — they read HIGH in the dark):
 *
 *     V/Vcc = R_ldr / (R_ldr + R_fixed)          →   R_ldr = R_fixed · x / (1 − x)
 *     R_ldr = R_10 · (E / 10 lx)^(−γ)            →   E = 10 lx · (R_10 / R_ldr)^(1/γ)
 *
 *   x      raw / ADC_MAX
 *   E      illuminance, lux
 *   R_10   the LDR's resistance at 10 lux (datasheet: 8–20 kΩ for a GL5528)
 *   γ      its log-log slope (datasheet: about 0.7, ±0.1)
 *
 * Two consequences, neither of which calibration can remove:
 *
 *   IT SATURATES. In bright light R_ldr falls to tens of ohms against a fixed
 *   resistor of ten thousand, so the voltage is pinned near zero and the top
 *   decade or two of real illuminance lands in the bottom few percent of the
 *   converter's range — where the converter itself is least accurate. A reading
 *   at that floor means "at least this bright", not a value.
 *
 *   IT IS NOT A PHOTON COUNT. An LDR's spectral response peaks in the green and
 *   does not match either the eye (lux) or photosynthesis (PPFD). Converting to
 *   PPFD needs a factor that depends on the light source: about 0.0185
 *   µmol·m⁻²·s⁻¹ per lux for daylight, but 0.013–0.02 across common lamps.
 *
 * R_10 and γ vary ±50% and ±15% between parts, and R_fixed is not documented for
 * the module in use, so the divider model above is provided for calibration and
 * documentation; the app's default mapping remains the anchored index in
 * lib/lightModel.ts until a reference lux reading pins the parameters.
 */

export type LightQuality =
  | 'ok'
  /** pinned at the bright end of the divider — a lower bound, not a value */
  | 'saturated-bright'
  /** pinned at the dark end — below what the sensor resolves */
  | 'floor-dark'
  | 'invalid';

/** Counts from either rail inside which the divider has stopped resolving. */
const RAIL_MARGIN = 120;

export function validateLight(raw: number | null | undefined): { raw: number | null; quality: LightQuality } {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > ADC_MAX) {
    return { raw: null, quality: 'invalid' };
  }
  // These modules read LOW in bright light.
  if (raw <= RAIL_MARGIN) return { raw, quality: 'saturated-bright' };
  if (raw >= ADC_MAX - RAIL_MARGIN) return { raw, quality: 'floor-dark' };
  return { raw, quality: 'ok' };
}

export interface LdrDivider {
  /** fixed resistor, Ω */
  rFixed: number;
  /** LDR resistance at 10 lux, Ω */
  r10: number;
  /** log-log slope of resistance against illuminance */
  gamma: number;
}

/** Datasheet-typical values for a GL5528 on a 10 kΩ module. Not measured. */
export const TYPICAL_LDR: LdrDivider = { rFixed: 10_000, r10: 12_000, gamma: 0.7 };

/**
 * Illuminance (lux) implied by a raw count under the divider model. Null at
 * either rail, where the model has no information.
 */
export function ldrLux(raw: number, d: LdrDivider = TYPICAL_LDR): number | null {
  const v = validateLight(raw);
  if (v.quality !== 'ok' || v.raw == null) return null;
  if (!(d.rFixed > 0) || !(d.r10 > 0) || !(d.gamma > 0)) return null;
  const x = v.raw / ADC_MAX;
  const rLdr = (d.rFixed * x) / (1 - x);
  return 10 * Math.pow(d.r10 / rLdr, 1 / d.gamma);
}

/**
 * Solve for R_10 from one reference: a lux meter beside the sensor reading
 * `lux` while the sensor reports `raw`. γ is held at its datasheet value; a
 * second reference at a very different brightness would be needed to fit it.
 */
export function calibrateLdr(raw: number, lux: number, base: LdrDivider = TYPICAL_LDR): LdrDivider | null {
  const v = validateLight(raw);
  if (v.quality !== 'ok' || v.raw == null || !(lux > 0) || !Number.isFinite(lux)) return null;
  const x = v.raw / ADC_MAX;
  const rLdr = (base.rFixed * x) / (1 - x);
  return { ...base, r10: rLdr * Math.pow(lux / 10, base.gamma) };
}

/**
 * The brightest illuminance the divider can still resolve — where its output
 * reaches the rail margin. Anything above reads the same.
 */
export function ldrCeilingLux(d: LdrDivider = TYPICAL_LDR): number {
  return ldrLux(RAIL_MARGIN + 1, d) ?? 0;
}
