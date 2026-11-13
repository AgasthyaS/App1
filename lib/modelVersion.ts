/**
 * Which version of each model produced a stored result.
 *
 * Stamped onto every recommendation and research row, so that when a formula
 * changes, older rows can still be read as what they were at the time — and the
 * two versions can be compared on the outcomes that followed. Bump the relevant
 * part when its behaviour changes; never reuse a value.
 *
 * Mirrored in the `model_versions` table (supabase/migrations).
 */
export const MODEL_VERSIONS = {
  /** raw counts → index, validation, per-sensor endpoints (lib/sensing) */
  sensing: 's3',
  /** substrate library, blend model, container physics (lib/substrate, lib/soilProfile) */
  substrate: 'b2',
  /** light averaging and daily-light estimate (lib/lightModel, lib/insights) */
  light: 'l3',
  /** the water decision and its evidence grade (lib/waterAction, lib/recommendation) */
  decision: 'd2',
} as const;

/** One string for a row: e.g. "s2.b2.l2.d2". */
export const MODEL_VERSION = Object.values(MODEL_VERSIONS).join('.');
