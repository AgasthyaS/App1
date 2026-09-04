import { potVolume } from './watering';
import type { Plant } from './types';

/**
 * WHAT THIS PLANT IS MISSING, AND WHAT IT COSTS.
 *
 * The app degrades silently. A plant with no pot depth still gets a watering
 * amount — it just quietly comes from the least accurate path in the model, and
 * nothing on screen says so. In the live garden four of seven plants had no pot
 * dimensions and five had no soil mix, which means most of the accuracy work in
 * this codebase was switched off for most of the plants and nobody could tell.
 *
 * That is the worst kind of gap: invisible, free to fix, and quietly wrong.
 *
 * ─────────────────────────── RANKED BY WHAT IT BREAKS ───────────────────────
 *
 * These are not equally important, so they are not presented equally. The order
 * is by how much the missing field actually moves the numbers:
 *
 *   POT DEPTH is first because it is decisive twice over. Volume scales with
 *   diameter CUBED, and without a depth `responsiveVolume` cannot compute the
 *   top-slice fraction at all — it falls back to charging a pour for the whole
 *   pot, which is precisely the assumption that produced a 975 ml recommendation
 *   for a pot that overflowed at 400.
 *
 *   SOIL MIX sets the retention curve: the difference between gritty and dense
 *   is roughly a factor of three in how long the pot holds water.
 *
 *   DRAINAGE is binary but severe — a pot with no holes cannot leach, so the
 *   same amount of water behaves completely differently and the rot window
 *   shortens rather than lengthens.
 *
 * Each gap states the CONSEQUENCE rather than nagging. "Set the depth" is a
 * chore; "without it Greenr is guessing your pot's volume, and volume is the
 * single biggest lever on every amount it gives you" is a reason.
 */

export type SetupGapKey = 'potHeight' | 'potCm' | 'soilMix' | 'drainage' | 'potShape' | 'ownedSince';

export interface SetupGap {
  key: SetupGapKey;
  /** 0–100; higher means the model is more degraded without it */
  impact: number;
  label: string;
  /** what is actually wrong right now because it is missing */
  consequence: string;
  /** where the user goes to fix it */
  fix: 'pot-size' | 'repot' | 'edit';
}

/** Above this the plant's numbers should be treated as rough. */
export const SIGNIFICANT_GAP_IMPACT = 40;

export function setupGaps(plant: Plant): SetupGap[] {
  const gaps: SetupGap[] = [];
  const vol = potVolume(plant);

  if (plant.potHeightCm == null || !(plant.potHeightCm > 0)) {
    gaps.push({
      key: 'potHeight',
      impact: 100,
      label: 'Pot depth',
      consequence:
        `Without a depth Greenr cannot tell which part of the pot the probe is reading, so every watering amount is charged against the whole ${vol.liters.toFixed(1)} L rather than the layer that actually responds. This is the single biggest source of error in the app, and it is a ruler and ten seconds to fix.`,
      fix: 'pot-size',
    });
  }
  if (plant.potCm == null || !(plant.potCm > 0)) {
    gaps.push({
      key: 'potCm',
      impact: 95,
      label: 'Pot width',
      consequence:
        'Soil volume goes as the CUBE of the width, so a guess here is worth litres. Every millilitre figure rests on it.',
      fix: 'pot-size',
    });
  }
  if (!plant.soilMix) {
    gaps.push({
      key: 'soilMix',
      impact: 70,
      label: 'What it is potted in',
      consequence:
        'The mix sets how long the pot holds water — gritty and dense compost differ by roughly three times. Without it Greenr assumes standard compost, which is right for most plants and badly wrong for cacti and orchids.',
      fix: 'repot',
    });
  }
  if (plant.hasDrainage == null) {
    gaps.push({
      key: 'drainage',
      impact: 55,
      label: 'Drainage holes',
      consequence:
        'A pot with no holes cannot drain, so nothing leaches away and roots sit in whatever you pour. Greenr shortens the danger window sharply when it knows — but only if it knows.',
      fix: 'repot',
    });
  }
  if (!plant.potShape) {
    gaps.push({
      key: 'potShape',
      impact: 25,
      label: 'Pot shape',
      consequence:
        'A tapered pot holds about 20% less than a straight-sided one of the same width and depth, which moves every amount by the same 20%.',
      fix: 'pot-size',
    });
  }
  if (!plant.ownedSince) {
    gaps.push({
      key: 'ownedSince',
      impact: 15,
      label: 'When you got it',
      consequence:
        'A plant in its first few weeks is still settling in, and Greenr keeps its advice gentler during that window rather than reading normal droop as a fault.',
      fix: 'edit',
    });
  }

  return gaps.sort((a, b) => b.impact - a.impact);
}

export interface SetupCompleteness {
  gaps: SetupGap[];
  /** 0–100 — how much of the model this plant currently has switched on */
  score: number;
  /** the one worth fixing first, or null when nothing material is missing */
  worst: SetupGap | null;
  /** true when the missing fields are bad enough that amounts are rough */
  degraded: boolean;
  headline: string;
}

export function setupCompleteness(plant: Plant): SetupCompleteness {
  const gaps = setupGaps(plant);
  // Weighted by impact, so missing the pot depth costs far more than the shape.
  const lost = gaps.reduce((a, g) => a + g.impact, 0);
  const total = 100 + 95 + 70 + 55 + 25 + 15;
  const score = Math.max(0, Math.round(100 * (1 - lost / total)));
  const worst = gaps[0] ?? null;
  const degraded = !!worst && worst.impact >= SIGNIFICANT_GAP_IMPACT;

  return {
    gaps,
    score,
    worst,
    degraded,
    headline: !worst
      ? 'Greenr has everything it needs for this plant'
      : degraded
        ? `${worst.label} is missing — amounts for this plant are estimates until it is set`
        : `${worst.label} would sharpen this plant's numbers`,
  };
}
