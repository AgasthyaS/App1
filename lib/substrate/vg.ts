import type { SoilMix } from '../types';

/**
 * THE RETENTION CURVE — one definition, shared by the substrate library and the
 * container model (lib/soilProfile.ts).
 *
 * van Genuchten (1980):
 *
 *     θ(ψ) = θr + (θs − θr) / [1 + (α·ψ)^n]^m ,   m = 1 − 1/n
 *
 *   ψ   suction, cm of water, ≥ 0
 *   θ   volumetric water content, cm³ water per cm³ bulk substrate (0–1)
 *   θs  saturated water content (≈ total porosity)
 *   θr  residual water content (water no plant-relevant suction removes)
 *   α   1/cm, roughly the inverse of the air-entry suction (coarse → large)
 *   n   > 1, pore-size uniformity (large → sharp wet-to-dry transition)
 *
 * Valid for a single population of pores. A blend of chunky and fine material has
 * two, and a single curve then fits worse — `fitVg` reports how much worse, and
 * the caller is expected to say so rather than hide it.
 */
export interface VanGenuchten {
  alpha: number;
  n: number;
  thetaS: number;
  thetaR: number;
}

/** θ at suction `psiCm`, as a fraction 0–1. Total for any finite input. */
export function vgTheta(vg: VanGenuchten, psiCm: number): number {
  const psi = Number.isFinite(psiCm) ? Math.max(0, psiCm) : 0;
  const n = Math.max(1.01, vg.n);
  const m = 1 - 1 / n;
  return vg.thetaR + (vg.thetaS - vg.thetaR) / Math.pow(1 + Math.pow(Math.max(0, vg.alpha) * psi, n), m);
}

/**
 * The four classes the app shipped with. Parameters were least-squares fitted to
 * published container-media figures (see lib/soilProfile.ts for the derivation);
 * they are kept bit-for-bit so every existing plant behaves exactly as before.
 */
export const LEGACY_VG: Record<SoilMix, VanGenuchten> = {
  'Gritty / cactus': { alpha: 1.0, n: 1.3, thetaS: 0.65, thetaR: 0.05 },
  'Chunky / aroid': { alpha: 0.64, n: 1.27, thetaS: 0.78, thetaR: 0.04 },
  'Standard mix': { alpha: 0.143, n: 1.42, thetaS: 0.87, thetaR: 0.1 },
  'Dense / heavy': { alpha: 0.064, n: 1.79, thetaS: 0.82, thetaR: 0.18 },
};

export interface RetentionPoint {
  /** suction, cm of water */
  psi: number;
  /** volumetric water content, 0–1 */
  theta: number;
}

export interface VgFit {
  vg: VanGenuchten;
  /** root-mean-square error of the fit, in volumetric water content (0–1) */
  rmse: number;
}

const ALPHA_LOG_MIN = -3; // 0.001 /cm — finer than any clay
const ALPHA_LOG_MAX = 0.7; // ~5 /cm — coarser than orchid bark
const N_MIN = 1.05;
const N_MAX = 4;

function sse(points: RetentionPoint[], vg: VanGenuchten): number {
  let s = 0;
  for (const p of points) {
    const d = vgTheta(vg, p.psi) - p.theta;
    s += d * d;
  }
  return s;
}

/**
 * Least-squares α and n for a set of (suction, water content) points, with θs and
 * θr held at the values given.
 *
 * A coarse grid followed by three rounds of local refinement. A grid is used on
 * purpose: the surface has a long curved valley (α and n trade off), and gradient
 * methods started from a fixed guess land in different places for different
 * inputs. This is deterministic, has no convergence failures, and costs a few
 * thousand evaluations once per substrate — results are cached by the caller.
 */
export function fitVg(points: RetentionPoint[], thetaS: number, thetaR: number): VgFit {
  const pts = points.filter((p) => Number.isFinite(p.psi) && Number.isFinite(p.theta) && p.psi > 0);
  const s = Math.min(1, Math.max(0.01, thetaS));
  const r = Math.min(s - 0.005, Math.max(0, thetaR));
  if (!pts.length) return { vg: { alpha: 0.143, n: 1.42, thetaS: s, thetaR: r }, rmse: 0 };

  let best = { la: -1, n: 1.5, err: Infinity };
  const scan = (laLo: number, laHi: number, nLo: number, nHi: number, steps: number) => {
    for (let i = 0; i <= steps; i++) {
      const la = laLo + ((laHi - laLo) * i) / steps;
      for (let j = 0; j <= steps; j++) {
        const n = nLo + ((nHi - nLo) * j) / steps;
        const err = sse(pts, { alpha: Math.pow(10, la), n, thetaS: s, thetaR: r });
        if (err < best.err) best = { la, n, err };
      }
    }
  };
  scan(ALPHA_LOG_MIN, ALPHA_LOG_MAX, N_MIN, N_MAX, 60);
  let spanA = (ALPHA_LOG_MAX - ALPHA_LOG_MIN) / 60;
  let spanN = (N_MAX - N_MIN) / 60;
  for (let round = 0; round < 3; round++) {
    scan(
      Math.max(ALPHA_LOG_MIN, best.la - spanA), Math.min(ALPHA_LOG_MAX, best.la + spanA),
      Math.max(N_MIN, best.n - spanN), Math.min(N_MAX, best.n + spanN),
      20,
    );
    spanA /= 10;
    spanN /= 10;
  }
  return {
    vg: { alpha: Math.pow(10, best.la), n: best.n, thetaS: s, thetaR: r },
    rmse: Math.sqrt(best.err / pts.length),
  };
}
