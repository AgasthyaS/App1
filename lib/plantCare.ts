import { careProfileFor, type CareProfile } from './plants';

/**
 * The care guide surfaced on Plant Detail. It now reads from the single source
 * of truth — the per-species care profile in lib/plants.ts — rather than a
 * separate category table, so on-screen guidance can never drift from the data
 * the sensor logic and health engine use.
 */
export interface CareGuide {
  overwatering: string;
  underwatering: string;
  tooMuchLight: string;
  tooLittleLight: string;
  fertilizer: string;
  dormancy: string;
  growth: string;
  pests: string;
  potting: string;
}

function toGuide(care: CareProfile): CareGuide {
  return {
    overwatering: care.signs.overwatering,
    underwatering: care.signs.underwatering,
    tooMuchLight: care.signs.tooMuchLight,
    tooLittleLight: care.signs.tooLittleLight,
    fertilizer: care.fertilizer,
    dormancy: care.dormancy,
    growth: care.growthExpectations,
    pests: care.pests,
    potting: care.soil.potting,
  };
}

export function careFor(speciesCommon: string): CareGuide | null {
  const care = careProfileFor(speciesCommon);
  return care ? toGuide(care) : null;
}

/** Re-exported so callers can reach the full measurable profile directly. */
export { careProfileFor, type CareProfile } from './plants';
