import type { SoilMix } from '../types';
import { COMPONENTS, MINERAL_TEXTURE_IDS, componentById } from './components';
import { mixtureKey, mixtureProperties, type MixturePart, type SubstrateProperties } from './mixture';
import { LEGACY_VG, vgTheta, type VanGenuchten } from './vg';

/**
 * WHAT A PLANT IS POTTED IN — the choice the owner makes, and what it resolves to.
 *
 * Three ways to say it, in rising order of effort:
 *
 *   preset   "Succulent mix", "Coco coir", "Loamy soil" — one tap
 *   custom   ingredients and proportions — for people who mix their own
 *   unknown  "I don't know" — a real answer, and treated as one
 *
 * Whatever is chosen resolves to the same thing: a retention curve for the
 * container model, a set of physical properties with ranges, and an honest label
 * for where those numbers came from.
 */

export type SubstrateSpec =
  | { kind: 'preset'; id: string }
  | { kind: 'custom'; parts: MixturePart[]; name?: string }
  | { kind: 'unknown' };

export type PresetGroup = 'potting' | 'specialist' | 'single' | 'garden';

export interface SubstratePreset {
  id: string;
  label: string;
  /** one line the picker shows under the name */
  blurb: string;
  group: PresetGroup;
  /** either one of the four fitted classes the app shipped with… */
  legacy?: SoilMix;
  /** …or a recipe from the component library */
  parts?: MixturePart[];
  /** shown in the simple picker; the rest sit behind "More" */
  common: boolean;
}

const textureLabel = (id: string) => componentById(id)?.label ?? id;

export const PRESETS: SubstratePreset[] = [
  { id: 'potting-mix', label: 'General potting mix', blurb: 'Bagged multipurpose or houseplant compost', group: 'potting', legacy: 'Standard mix', common: true },
  { id: 'succulent-mix', label: 'Succulent & cactus mix', blurb: 'Gritty, drains in minutes', group: 'potting', legacy: 'Gritty / cactus', common: true },
  { id: 'aroid-mix', label: 'Chunky aroid mix', blurb: 'Bark and perlite, airy', group: 'potting', legacy: 'Chunky / aroid', common: true },
  { id: 'orchid-mix', label: 'Orchid bark mix', blurb: 'Mostly bark chunks', group: 'specialist', parts: [{ component: 'orchid-bark', parts: 70 }, { component: 'sphagnum-moss', parts: 15 }, { component: 'perlite', parts: 15 }], common: true },
  { id: 'coco-coir', label: 'Coco coir', blurb: 'Coconut fibre, on its own', group: 'single', parts: [{ component: 'coir', parts: 100 }], common: true },
  { id: 'dense-compost', label: 'Old or dense compost', blurb: 'Heavy, compacted, stays wet', group: 'potting', legacy: 'Dense / heavy', common: false },
  { id: 'seed-mix', label: 'Seed-starting mix', blurb: 'Fine peat and vermiculite', group: 'specialist', parts: [{ component: 'peat', parts: 50 }, { component: 'vermiculite', parts: 50 }], common: false },
  { id: 'compost-mix', label: 'Compost-based mix', blurb: 'Garden compost with peat or coir and perlite', group: 'potting', parts: [{ component: 'compost', parts: 40 }, { component: 'peat', parts: 40 }, { component: 'perlite', parts: 20 }], common: false },
  { id: 'peat-moss', label: 'Peat moss', blurb: 'Sphagnum peat, on its own', group: 'single', parts: [{ component: 'peat', parts: 100 }], common: false },
  { id: 'sphagnum', label: 'Sphagnum moss', blurb: 'Long-fibre moss', group: 'single', parts: [{ component: 'sphagnum-moss', parts: 100 }], common: false },
  { id: 'pumice', label: 'Pumice or mineral grit', blurb: 'Soilless, for semi-hydro and bonsai', group: 'single', parts: [{ component: 'pumice', parts: 100 }], common: false },
  { id: 'sandy-soil', label: 'Sandy soil', blurb: 'Garden soil that feels gritty', group: 'garden', parts: [{ component: 'sandy-loam', parts: 100 }], common: true },
  { id: 'loamy-soil', label: 'Loamy soil', blurb: 'Garden soil, crumbly', group: 'garden', parts: [{ component: 'loam', parts: 100 }], common: true },
  { id: 'clay-soil', label: 'Clay-heavy soil', blurb: 'Garden soil that is sticky when wet', group: 'garden', parts: [{ component: 'clay-loam', parts: 100 }], common: true },
  // Every USDA texture class, for people who know theirs.
  ...MINERAL_TEXTURE_IDS.map((id): SubstratePreset => ({
    id: `texture:${id}`, label: textureLabel(id), blurb: 'USDA texture class', group: 'garden',
    parts: [{ component: id, parts: 100 }], common: false,
  })),
];

const PRESET_BY_ID = new Map(PRESETS.map((p) => [p.id, p]));

export function presetById(id: string | null | undefined): SubstratePreset | undefined {
  return id ? PRESET_BY_ID.get(id) : undefined;
}

/** The preset that reproduces one of the four original classes exactly. */
export const PRESET_FOR_LEGACY: Record<SoilMix, string> = {
  'Standard mix': 'potting-mix',
  'Gritty / cactus': 'succulent-mix',
  'Chunky / aroid': 'aroid-mix',
  'Dense / heavy': 'dense-compost',
};

/**
 * How the substrate became known. Ordered weakest → strongest; a pot's own
 * measured behaviour (lib/soilRetention) is a further step above all of these and
 * is applied separately, on top.
 */
export type SubstrateKnowledge = 'unknown' | 'category' | 'recipe';

export interface ResolvedSubstrate {
  /** stable identity, safe to store and to group by */
  key: string;
  label: string;
  knowledge: SubstrateKnowledge;
  vg: VanGenuchten;
  /** null only for the four original classes, whose curve is fitted directly */
  properties: SubstrateProperties | null;
  /** the nearest of the four original classes, for the tables keyed on them */
  legacyClass: SoilMix;
  /** ingredients, when there are any */
  parts: { component: string; fraction: number; label: string }[];
  /** one honest sentence about where the numbers came from */
  provenance: string;
}

/**
 * Nearest of the four original classes, from air space and water held at
 * container capacity. Boundaries sit between the classes' own figures
 * (gritty 35/30, chunky 48/30, standard 68/19, dense 72/10 — water/air, %).
 */
export function legacyClassFor(vg: VanGenuchten): SoilMix {
  const cc = vgTheta(vg, 10);
  const air = vg.thetaS - cc;
  if (air < 0.13) return 'Dense / heavy';
  if (cc < 0.42 && air >= 0.2) return 'Gritty / cactus';
  if (cc < 0.58 && air >= 0.2) return 'Chunky / aroid';
  return 'Standard mix';
}

const isMix = (m: unknown): m is SoilMix =>
  typeof m === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_VG, m);

const LEGACY_PROVENANCE =
  'A reference curve fitted to published container-mix figures. Your own bag may differ; Greenr corrects it from how this pot actually dries.';

function fromLegacy(mix: SoilMix, knowledge: SubstrateKnowledge, label?: string): ResolvedSubstrate {
  return {
    key: knowledge === 'unknown' ? 'unknown' : `class:${mix}`,
    label: label ?? mix,
    knowledge,
    vg: LEGACY_VG[mix],
    properties: null,
    legacyClass: mix,
    parts: [],
    provenance:
      knowledge === 'unknown'
        ? 'The substrate has not been specified, so a general potting mix is assumed. Thresholds are looser until Greenr has watched this pot dry, or you tell it what the plant is in.'
        : LEGACY_PROVENANCE,
  };
}

function fromParts(parts: MixturePart[], label: string, key: string, knowledge: SubstrateKnowledge): ResolvedSubstrate | null {
  const props = mixtureProperties(parts);
  if (!props) return null;
  const single = props.regime === 'single';
  const provenance =
    props.basis === 'published-parameters'
      ? 'Published class-average parameters for this soil texture (Carsel & Parrish 1988), measured on field soils.'
      : single
        ? props.basis === 'published-anchors'
          ? 'Anchored on published container measurements for this material; the curve between them is fitted.'
          : 'A typical figure for this material from the growing-media literature, not a specific measurement.'
        : 'Estimated from the ingredients with a packing model. Real blends vary with grade and compaction, so the ranges matter more than the midpoints.';
  return {
    key,
    label,
    knowledge,
    vg: props.vg,
    properties: props,
    legacyClass: legacyClassFor(props.vg),
    parts: partsWithLabels(parts),
    provenance,
  };
}

function partsWithLabels(parts: MixturePart[]) {
  const total = parts.reduce((s, p) => s + (Number.isFinite(p.parts) && p.parts > 0 && componentById(p.component) ? p.parts : 0), 0);
  return parts
    .filter((p) => componentById(p.component) && Number.isFinite(p.parts) && p.parts > 0)
    .map((p) => ({ component: p.component, fraction: total > 0 ? p.parts / total : 0, label: componentById(p.component)!.label }));
}

/**
 * Resolve whatever is stored on a plant to a usable substrate.
 *
 * `legacyMix` is the plant's original four-way `soilMix`. A plant with no
 * `substrate` resolves through it to exactly the curve it always had, so adding
 * this library changes nothing for existing plants until the owner chooses
 * something more specific.
 */
export function resolveSubstrate(spec: SubstrateSpec | null | undefined, legacyMix?: SoilMix | null): ResolvedSubstrate {
  // The container model calls this in its innermost loops, always with the same
  // spec object the plant holds, so identity is a sufficient and very cheap key.
  if (spec && typeof spec === 'object') {
    const slot = isMix(legacyMix) ? legacyMix : '';
    let bySlot = resolved.get(spec);
    const hit = bySlot?.get(slot);
    if (hit) return hit;
    const fresh = resolveUncached(spec, legacyMix);
    if (!bySlot) resolved.set(spec, (bySlot = new Map()));
    bySlot.set(slot, fresh);
    return fresh;
  }
  return resolveUncached(spec, legacyMix);
}

const resolved = new WeakMap<object, Map<string, ResolvedSubstrate>>();

function resolveUncached(spec: SubstrateSpec | null | undefined, legacyMix?: SoilMix | null): ResolvedSubstrate {
  if (spec?.kind === 'preset') {
    const preset = presetById(spec.id);
    if (preset?.legacy) return { ...fromLegacy(preset.legacy, 'category', preset.label), key: `preset:${preset.id}` };
    if (preset?.parts) {
      const r = fromParts(preset.parts, preset.label, `preset:${preset.id}`, 'category');
      if (r) return r;
    }
  }
  if (spec?.kind === 'custom') {
    const key = mixtureKey(spec.parts);
    if (key) {
      const r = fromParts(spec.parts, spec.name?.trim() || 'Custom mix', `mix:${key}`, 'recipe');
      if (r) return r;
    }
  }
  if (spec?.kind === 'unknown') return fromLegacy('Standard mix', 'unknown', 'Not specified');
  // No (or unusable) spec: the original class if there is one, otherwise unknown.
  return isMix(legacyMix) ? fromLegacy(legacyMix, 'category') : fromLegacy('Standard mix', 'unknown', 'Not specified');
}

/** Short ingredient line, e.g. "50% bagged potting mix · 30% perlite · 20% coco coir". */
export function recipeText(r: ResolvedSubstrate): string {
  return r.parts
    .slice()
    .sort((a, b) => b.fraction - a.fraction)
    .map((p) => `${Math.round(p.fraction * 100)}% ${p.label.toLowerCase()}`)
    .join(' · ');
}

export { COMPONENTS };
