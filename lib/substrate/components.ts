import { LEGACY_VG, fitVg, vgTheta, type RetentionPoint, type VanGenuchten } from './vg';

/**
 * THE COMPONENT LIBRARY — what growing media are made of.
 *
 * Two families that must not be confused:
 *
 *   MINERAL SOILS are classified by TEXTURE (sand / silt / clay proportions).
 *   Their parameters here are the class averages of Carsel & Parrish (1988),
 *   "Developing joint probability distributions of soil water retention
 *   characteristics", Water Resources Research 24:755–769 — measured on field
 *   soils, and applied here to a pot, where the soil has been dug and repacked.
 *
 *   HORTICULTURAL MEDIA (peat, coir, bark, perlite …) are not soils and have no
 *   texture class. They are characterised by total porosity, container capacity
 *   and air space. Values here are anchored on published container measurements
 *   where one exists, and are otherwise typical magnitudes from the growing-media
 *   literature. Every entry says which.
 *
 * ─────────────────────── HOW MUCH TO TRUST EACH NUMBER ───────────────────────
 *
 *   'published-parameters'  the van Genuchten parameters themselves are published
 *   'published-anchors'     porosity and container capacity come from a cited
 *                           table; the curve between them is fitted
 *   'typical-magnitude'     representative of the literature range, not traceable
 *                           to one measurement. Treat as a starting estimate.
 *
 * Nothing here has been measured on a Greenr bench. Two bags with the same label
 * differ (grade, age, compaction, how wet it was when potted), which is why every
 * horticultural entry carries a spread and why the pot's own measured behaviour
 * (lib/soilRetention, lib/substrateCalibration) outranks this table as soon as it
 * exists.
 */

export type ComponentTier = 'published-parameters' | 'published-anchors' | 'typical-magnitude';
export type ComponentFamily = 'mineral' | 'organic' | 'aggregate' | 'blend';

/**
 * How the particles behave when blended.
 *   'matrix'    fine material that fills space between larger particles
 *   'skeleton'  coarse particles that form a frame with voids between them
 */
export type PackingRole = 'matrix' | 'skeleton';

export interface SubstrateComponent {
  id: string;
  label: string;
  family: ComponentFamily;
  role: PackingRole;
  /** total porosity, v/v — the saturated water content */
  totalPorosity: number;
  /**
   * For skeleton materials: the share of their bulk volume that is empty space
   * BETWEEN particles, where finer material can nest. 0 for matrix materials.
   */
  interparticleVoid: number;
  /** ± v/v on container capacity between products sold under this name */
  spread: number;
  vg: VanGenuchten;
  /** RMSE of the fitted curve against its anchors (0 when parameters are published) */
  fitRmse: number;
  tier: ComponentTier;
  source: string;
  note?: string;
}

/* ─────────────────────────── mineral textures ─────────────────────────── */

/** Carsel & Parrish (1988) class averages. α in 1/cm. Cross-checked 2026-11-11. */
const CP88: [id: string, label: string, thetaR: number, thetaS: number, alpha: number, n: number][] = [
  ['sand', 'Sand', 0.045, 0.43, 0.145, 2.68],
  ['loamy-sand', 'Loamy sand', 0.057, 0.41, 0.124, 2.28],
  ['sandy-loam', 'Sandy loam', 0.065, 0.41, 0.075, 1.89],
  ['loam', 'Loam', 0.078, 0.43, 0.036, 1.56],
  ['silt-loam', 'Silt loam', 0.067, 0.45, 0.02, 1.41],
  ['silt', 'Silt', 0.034, 0.46, 0.016, 1.37],
  ['sandy-clay-loam', 'Sandy clay loam', 0.1, 0.39, 0.059, 1.48],
  ['clay-loam', 'Clay loam', 0.095, 0.41, 0.019, 1.31],
  ['silty-clay-loam', 'Silty clay loam', 0.089, 0.43, 0.01, 1.23],
  ['sandy-clay', 'Sandy clay', 0.1, 0.38, 0.027, 1.23],
  ['silty-clay', 'Silty clay', 0.07, 0.36, 0.005, 1.09],
  ['clay', 'Clay', 0.068, 0.38, 0.008, 1.09],
];

export const MINERAL_TEXTURE_IDS = CP88.map((r) => r[0]);

const mineral: SubstrateComponent[] = CP88.map(([id, label, thetaR, thetaS, alpha, n]) => ({
  id,
  label,
  family: 'mineral',
  role: 'matrix',
  totalPorosity: thetaS,
  interparticleVoid: 0,
  // Class averages hide a wide within-class range; Carsel & Parrish report
  // coefficients of variation of 10–20% on θs alone.
  spread: 0.05,
  vg: { alpha, n, thetaS, thetaR },
  fitRmse: 0,
  tier: 'published-parameters',
  source: 'Carsel & Parrish (1988), Water Resour. Res. 24:755–769, class averages',
  note: 'Field-soil parameters. Dug, repacked soil in a pot is usually denser and drains worse than this suggests.',
}));

/* ─────────────────────────── horticultural media ─────────────────────────── */

interface Anchored {
  id: string;
  label: string;
  family: ComponentFamily;
  role: PackingRole;
  totalPorosity: number;
  /** water held in a drained 10 cm container (mean suction ≈ 5 cm), v/v */
  capacity: number;
  /** water remaining at 50 cm and 100 cm of suction, v/v */
  at50: number;
  at100: number;
  /** water no houseplant can extract, v/v */
  residual: number;
  interparticleVoid: number;
  spread: number;
  tier: ComponentTier;
  source: string;
  note?: string;
}

const ARKANSAS =
  'University of Arkansas Greenhouse Management, Unit 7 (substrate physical properties, 4-inch container)';
const LITERATURE =
  'Typical magnitude from the container-media literature (De Boodt & Verdonck 1972; Bunt 1988; Handreck & Black 2002); not a single measurement';

/**
 * A "container capacity" quoted for a 10 cm pot is the AVERAGE over a drained
 * column whose suction runs from 0 at the base to 10 cm at the top. It is entered
 * here at the column's mean suction, 5 cm. That is an approximation (the curve is
 * not linear), good to a point or two for a column this short.
 */
const CAPACITY_PSI_CM = 5;

const ANCHORED: Anchored[] = [
  {
    id: 'peat', label: 'Sphagnum peat', family: 'organic', role: 'matrix',
    totalPorosity: 0.84, capacity: 0.72, at50: 0.46, at100: 0.41, residual: 0.25,
    interparticleVoid: 0, spread: 0.07, tier: 'published-anchors',
    source: `${ARKANSAS}: chosen so an 80:20 peat–perlite blend reproduces the published 79% porosity / 68% water / 10% air`,
    note: 'Hard to re-wet once it dries right out.',
  },
  {
    id: 'coir', label: 'Coco coir', family: 'organic', role: 'matrix',
    totalPorosity: 0.86, capacity: 0.76, at50: 0.5, at100: 0.44, residual: 0.25,
    interparticleVoid: 0, spread: 0.08, tier: 'published-anchors',
    source: `${ARKANSAS}: chosen so an 80:20 coir–perlite blend reproduces the published 81% / 73% / 8%`,
    note: 'Varies widely between sources and with the pith-to-fibre ratio (Abad et al. 2005).',
  },
  {
    id: 'pine-bark', label: 'Pine bark fines', family: 'organic', role: 'matrix',
    totalPorosity: 0.8, capacity: 0.58, at50: 0.4, at100: 0.36, residual: 0.25,
    interparticleVoid: 0, spread: 0.08, tier: 'published-anchors',
    source: `${ARKANSAS}: about 80% porosity and 22% air space`,
    note: 'Aged, screened under about 1 cm. Fresh or coarser bark holds less.',
  },
  {
    id: 'perlite', label: 'Perlite', family: 'aggregate', role: 'skeleton',
    totalPorosity: 0.75, capacity: 0.45, at50: 0.3, at100: 0.27, residual: 0.2,
    interparticleVoid: 0.4, spread: 0.08, tier: 'published-anchors',
    source: `${ARKANSAS}: about 75% porosity and 30% air space`,
    note: 'Horticultural (coarse) grade.',
  },
  {
    id: 'pumice', label: 'Pumice', family: 'aggregate', role: 'skeleton',
    totalPorosity: 0.65, capacity: 0.38, at50: 0.27, at100: 0.24, residual: 0.18,
    interparticleVoid: 0.4, spread: 0.1, tier: 'typical-magnitude', source: LITERATURE,
    note: '3–8 mm grade.',
  },
  {
    id: 'vermiculite', label: 'Vermiculite', family: 'aggregate', role: 'skeleton',
    totalPorosity: 0.85, capacity: 0.6, at50: 0.42, at100: 0.38, residual: 0.25,
    interparticleVoid: 0.25, spread: 0.1, tier: 'typical-magnitude', source: LITERATURE,
    note: 'Collapses with handling and age, holding more water and less air over time.',
  },
  {
    id: 'orchid-bark', label: 'Orchid bark (chunks)', family: 'organic', role: 'skeleton',
    totalPorosity: 0.78, capacity: 0.3, at50: 0.24, at100: 0.22, residual: 0.15,
    interparticleVoid: 0.45, spread: 0.1, tier: 'typical-magnitude', source: LITERATURE,
    note: '12–25 mm chunks. Holds more as it breaks down over one to two years.',
  },
  {
    id: 'sphagnum-moss', label: 'Sphagnum moss', family: 'organic', role: 'matrix',
    totalPorosity: 0.95, capacity: 0.8, at50: 0.45, at100: 0.36, residual: 0.15,
    interparticleVoid: 0, spread: 0.12, tier: 'typical-magnitude', source: LITERATURE,
    note: 'Long-fibre moss. Depends heavily on how tightly it is packed.',
  },
  {
    id: 'compost', label: 'Compost', family: 'organic', role: 'matrix',
    totalPorosity: 0.65, capacity: 0.55, at50: 0.42, at100: 0.38, residual: 0.22,
    interparticleVoid: 0, spread: 0.1, tier: 'typical-magnitude', source: LITERATURE,
    note: 'Mature, screened. Slumps as it decomposes.',
  },
  {
    id: 'grit', label: 'Grit or coarse sand', family: 'aggregate', role: 'skeleton',
    totalPorosity: 0.4, capacity: 0.1, at50: 0.05, at100: 0.04, residual: 0.03,
    interparticleVoid: 0.38, spread: 0.05, tier: 'typical-magnitude', source: LITERATURE,
    note: '2–5 mm, non-porous: all of its pore space is between the grains.',
  },
];

function fromAnchors(a: Anchored): SubstrateComponent {
  const pts: RetentionPoint[] = [
    { psi: CAPACITY_PSI_CM, theta: a.capacity },
    { psi: 50, theta: a.at50 },
    { psi: 100, theta: a.at100 },
    // Pins the dry tail without dominating the fit.
    { psi: 15000, theta: a.residual + 0.01 },
  ];
  const fit = fitVg(pts, a.totalPorosity, a.residual);
  return {
    id: a.id, label: a.label, family: a.family, role: a.role,
    totalPorosity: a.totalPorosity, interparticleVoid: a.interparticleVoid,
    spread: a.spread, vg: fit.vg, fitRmse: fit.rmse, tier: a.tier, source: a.source, note: a.note,
  };
}

/** Bagged general-purpose compost as an ingredient, for "potting mix + perlite" blends. */
const pottingMix: SubstrateComponent = {
  id: 'potting-mix',
  label: 'Bagged potting mix',
  family: 'blend',
  role: 'matrix',
  totalPorosity: LEGACY_VG['Standard mix'].thetaS,
  interparticleVoid: 0,
  spread: 0.08,
  vg: LEGACY_VG['Standard mix'],
  fitRmse: 0,
  tier: 'published-anchors',
  source: 'Fitted to published peat-based container-mix figures (see lib/soilProfile.ts)',
  note: 'A peat- or coir-based multipurpose compost, usually already containing some perlite.',
};

export const COMPONENTS: SubstrateComponent[] = [pottingMix, ...ANCHORED.map(fromAnchors), ...mineral];

const BY_ID = new Map(COMPONENTS.map((c) => [c.id, c]));

export function componentById(id: string | null | undefined): SubstrateComponent | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** Water held by this component alone at suction `psiCm`, v/v. */
export function componentTheta(c: SubstrateComponent, psiCm: number): number {
  return psiCm <= 0 ? c.totalPorosity : Math.min(c.totalPorosity, vgTheta(c.vg, psiCm));
}

/** The ingredients offered in the custom-mix builder, in the order shown. */
export const MIX_BUILDER_IDS = [
  'potting-mix', 'peat', 'coir', 'perlite', 'pumice', 'vermiculite', 'pine-bark',
  'orchid-bark', 'sphagnum-moss', 'compost', 'grit', 'sandy-loam', 'loam', 'clay-loam',
] as const;
