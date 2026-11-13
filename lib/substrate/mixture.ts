import { componentById, componentTheta, type ComponentTier, type SubstrateComponent } from './components';
import { fitVg, type RetentionPoint, type VanGenuchten } from './vg';

/**
 * WHAT A BLEND OF INGREDIENTS DOES — and why it is not the average of its parts.
 *
 * Mix a litre of perlite into a litre of peat and you do not get two litres. The
 * peat settles into the gaps between the perlite grains, the blend shrinks, and
 * those gaps — which were the air space the perlite was added to provide — are
 * now full of peat. So a volume-weighted average over-states air space and
 * under-states water held, by an amount that depends on the proportions.
 *
 * The consequence is a threshold. While there is more fine material than the
 * coarse particles have room for between them, the coarse particles are simply
 * suspended in it: each one displaces peat with something that holds less water,
 * but the pores that govern drainage are still the peat's. Only once the coarse
 * fraction is large enough to touch and form its own frame do large air-filled
 * voids appear. That threshold proportion (Spomer 1979, "Three simple
 * demonstrations of the physical effects of soil amendment", HortScience 14:75)
 * is why "I added a handful of perlite" changes much less than people expect.
 *
 * ───────────────────────────── THE MODEL ─────────────────────────────
 *
 * Ingredients are entered as bulk-volume fractions f_i (Σ f_i = 1) and split into
 * SKELETON (coarse, fraction f_c, with interparticle void e) and MATRIX (fine,
 * fraction f_f).
 *
 * Ideal packing (every fine particle finds a gap) gives the blended volume
 *
 *     V_ideal = f_c                    if f_f ≤ e·f_c   (skeleton holds, gaps part-filled)
 *     V_ideal = f_c·(1 − e) + f_f      otherwise        (matrix holds, coarse suspended)
 *
 * and no packing at all gives V = 1. Real blends fall between, so both are
 * computed and reported as a range, with the midpoint (nesting efficiency
 * η = 0.5) as the working estimate:
 *
 *     V(η) = 1 − η·(1 − V_ideal)
 *
 * Water is conserved — each ingredient holds what it holds at a given suction —
 * so per unit of blended volume
 *
 *     θ_mix(ψ) = Σ f_i·θ_i(ψ) / V
 *
 * and the pore space lost is exactly the shrinkage:
 *
 *     TP_mix = (Σ f_i·TP_i − (1 − V)) / V
 *
 * The threshold coarse fraction, where the two regimes meet, is 1 / (1 + e):
 * about 0.71 for e = 0.40, matching Spomer's 70–75%.
 *
 * ──────────────────────────── WHAT IT IS NOT ────────────────────────────
 *
 * It assumes two particle populations, rigid particles, and that an ingredient
 * holds the same water in a blend as alone. It ignores compaction at potting and
 * decomposition afterwards, both of which move a real pot further than the
 * difference between the two bounds. It is checked against three published
 * blends (tests/substrate.test.ts) and nothing else. The result is an ESTIMATE
 * with a stated range, and it is labelled as one everywhere it is shown.
 */

export interface MixturePart {
  component: string;
  /** relative amount — any positive unit, normalised internally */
  parts: number;
}

export interface Range {
  low: number;
  mid: number;
  high: number;
}

export type MixtureRegime = 'single' | 'matrix-held' | 'skeleton-held';
export type PropertyBasis = ComponentTier | 'estimated-mixture';

export interface SubstrateProperties {
  /** all v/v, 0–1 */
  totalPorosity: Range;
  /** water held at 10 cm of suction — container capacity (EN 13041 / De Boodt) */
  containerCapacity: Range;
  /** air-filled pore space at container capacity */
  airSpace: Range;
  /** water released between 10 and 50 cm — taken up without effort */
  easilyAvailable: Range;
  /** water released between 50 and 100 cm — the reserve */
  buffer: Range;
  /** volume lost on blending, as a fraction of the ingredients' combined volume */
  shrinkage: Range;
  /** one curve standing in for the blend, for the container model */
  vg: VanGenuchten;
  /** how badly that one curve fits the blend, v/v. Above ~0.03 it is a poor stand-in. */
  fitRmse: number;
  regime: MixtureRegime;
  /** share of the ingredients (by volume) that is coarse skeleton material */
  coarseFraction: number;
  /** the coarse share at which large air-filled voids start to appear; null if no coarse material */
  thresholdCoarseFraction: number | null;
  basis: PropertyBasis;
  /** the least well-sourced ingredient — the estimate is no better than this */
  weakestInput: ComponentTier;
  notes: string[];
}

export const MAX_MIX_COMPONENTS = 6;

/** Suctions the blended curve is sampled at for fitting, cm. */
const FIT_PSI = [1, 2, 5, 10, 20, 50, 100, 300, 1000, 15000];

interface Resolved {
  c: SubstrateComponent;
  f: number;
}

/** Valid, known ingredients as fractions summing to 1. Empty when nothing usable was given. */
export function normaliseParts(parts: MixturePart[] | null | undefined): { component: string; fraction: number }[] {
  const merged = new Map<string, number>();
  for (const p of parts ?? []) {
    if (!p || !componentById(p.component)) continue;
    if (typeof p.parts !== 'number' || !Number.isFinite(p.parts) || p.parts <= 0) continue;
    merged.set(p.component, (merged.get(p.component) ?? 0) + p.parts);
  }
  const kept = [...merged.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_MIX_COMPONENTS);
  const total = kept.reduce((s, [, v]) => s + v, 0);
  if (!(total > 0)) return [];
  return kept.map(([component, v]) => ({ component, fraction: v / total }));
}

const WORST: ComponentTier[] = ['published-parameters', 'published-anchors', 'typical-magnitude'];

const cache = new Map<string, SubstrateProperties | null>();

/** Stable identity for a blend: ingredients by id with whole-percent shares. */
export function mixtureKey(parts: MixturePart[] | null | undefined): string {
  return normaliseParts(parts)
    .map((p) => `${p.component}:${Math.round(p.fraction * 100)}`)
    .sort()
    .join('+');
}

/** Estimated physical properties of a blend. Null when no valid ingredient was given. */
export function mixtureProperties(parts: MixturePart[] | null | undefined): SubstrateProperties | null {
  const key = mixtureKey(parts);
  if (cache.has(key)) return cache.get(key) ?? null;
  const result = compute(parts);
  if (cache.size < 300) cache.set(key, result);
  return result;
}

function compute(parts: MixturePart[] | null | undefined): SubstrateProperties | null {
  const norm = normaliseParts(parts);
  if (!norm.length) return null;
  const items: Resolved[] = norm.map((p) => ({ c: componentById(p.component)!, f: p.fraction }));

  const tier = items.reduce<ComponentTier>(
    (worst, it) => (WORST.indexOf(it.c.tier) > WORST.indexOf(worst) ? it.c.tier : worst),
    'published-parameters',
  );

  // One ingredient is not a blend: its own curve, no packing, no refit.
  if (items.length === 1) {
    const c = items[0].c;
    const at = (psi: number) => componentTheta(c, psi);
    const band = (v: number, s: number): Range => ({
      low: Math.max(0, v - s), mid: v, high: Math.min(c.totalPorosity, v + s),
    });
    const cc = at(10);
    return {
      totalPorosity: band(c.totalPorosity, c.spread / 2),
      containerCapacity: band(cc, c.spread),
      airSpace: { low: Math.max(0, c.totalPorosity - cc - c.spread), mid: c.totalPorosity - cc, high: Math.min(c.totalPorosity, c.totalPorosity - cc + c.spread) },
      easilyAvailable: band(at(10) - at(50), c.spread / 2),
      buffer: band(at(50) - at(100), c.spread / 4),
      shrinkage: { low: 0, mid: 0, high: 0 },
      vg: c.vg,
      fitRmse: c.fitRmse,
      regime: 'single',
      coarseFraction: c.role === 'skeleton' ? 1 : 0,
      thresholdCoarseFraction: null,
      basis: c.tier,
      weakestInput: c.tier,
      notes: c.note ? [c.note] : [],
    };
  }

  const coarse = items.filter((it) => it.c.role === 'skeleton');
  const fC = coarse.reduce((s, it) => s + it.f, 0);
  const fF = 1 - fC;
  // Interparticle void of the pooled skeleton, weighted by each ingredient's share of it.
  const e = fC > 0 ? coarse.reduce((s, it) => s + it.f * it.c.interparticleVoid, 0) / fC : 0;
  const skeletonHeld = fC > 0 && fF <= e * fC;
  const vIdeal = fC <= 0 || fF <= 0 ? 1 : skeletonHeld ? fC : fC * (1 - e) + fF;

  const poreSum = items.reduce((s, it) => s + it.f * it.c.totalPorosity, 0);
  const water = (psi: number) => items.reduce((s, it) => s + it.f * componentTheta(it.c, psi), 0);
  // Independent product-to-product variation, combined in quadrature.
  const spread = Math.sqrt(items.reduce((s, it) => s + (it.f * it.c.spread) ** 2, 0));

  const at = (eta: number) => {
    const v = 1 - eta * (1 - vIdeal);
    const tp = Math.max(0.05, (poreSum - (1 - v)) / v);
    const theta = (psi: number) => Math.min(tp, water(psi) / v);
    return { v, tp, theta };
  };
  const none = at(0);
  const mid = at(0.5);
  const full = at(1);

  const range = (pick: (m: ReturnType<typeof at>) => number, s: number): Range => {
    const a = pick(none);
    const b = pick(full);
    return {
      low: Math.max(0, Math.min(a, b) - s),
      mid: pick(mid),
      high: Math.min(1, Math.max(a, b) + s),
    };
  };

  const points: RetentionPoint[] = FIT_PSI.map((psi) => ({ psi, theta: mid.theta(psi) }));
  const fit = fitVg(points, mid.tp, mid.theta(1e6));

  const threshold = fC > 0 && e > 0 ? 1 / (1 + e) : null;
  const notes: string[] = [];
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  if (threshold != null && !skeletonHeld && fC >= 0.05) {
    notes.push(
      `At ${pct(fC)} coarse material the finer ingredients still fill the gaps between the coarse particles, so this drains and holds air less than the proportion suggests. Large air pockets only start to form above about ${pct(threshold)} coarse.`,
    );
  }
  if (skeletonHeld) {
    notes.push(
      `The coarse ingredients (${pct(fC)}) form the frame here and the fine material only part-fills the gaps, so this drains fast and holds a lot of air.`,
    );
  }
  if (fit.rmse > 0.03) {
    notes.push(
      'This blend has two distinct pore sizes, so a single retention curve describes it only roughly. Treat the thresholds as approximate until the pot has been watched drying.',
    );
  }
  if (items.some((it) => it.c.family === 'mineral')) {
    notes.push('Mineral soil in a pot compacts with watering; expect it to hold more water and less air over time than estimated here.');
  }

  return {
    totalPorosity: range((m) => m.tp, spread / 2),
    containerCapacity: range((m) => m.theta(10), spread),
    airSpace: range((m) => m.tp - m.theta(10), spread),
    easilyAvailable: range((m) => m.theta(10) - m.theta(50), spread / 2),
    buffer: range((m) => m.theta(50) - m.theta(100), spread / 4),
    shrinkage: { low: 0, mid: 1 - mid.v, high: 1 - full.v },
    vg: fit.vg,
    fitRmse: fit.rmse,
    regime: skeletonHeld ? 'skeleton-held' : 'matrix-held',
    coarseFraction: fC,
    thresholdCoarseFraction: threshold,
    basis: 'estimated-mixture',
    weakestInput: tier,
    notes,
  };
}
