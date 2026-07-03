/**
 * GREENR 2.0 design tokens — Interface Spec §1, v2 polish pass.
 * Instrument surfaces are dark; ritual surfaces (onboarding, Care Mode,
 * education) are light. Numbers always render one weight heavier than labels,
 * with tabular numerals.
 */

export const dark = {
  bg: '#0B120E', // Midnight Canopy, deepened
  surface1: '#141D17',
  surface2: '#1A2620',
  hairline: '#233128',
  ink: '#EDF1EA',
  inkMuted: '#93A095',
  /** hero gradient stops (top of Plant Detail, headers) */
  heroTop: '#1C2A21',
  heroBottom: '#0B120E',
} as const;

export const light = {
  bg: '#F6F3EA', // Greenhouse
  surface1: '#FFFFFF',
  surface2: '#FFFFFF',
  hairline: '#E5DFD0',
  ink: '#3A2B1E', // Soil
  inkMuted: '#8B7E6E',
  heroTop: '#EAE9DA',
  heroBottom: '#F6F3EA',
} as const;

export const accent = {
  sage: '#96A878', // healthy / in-range
  sunbeam: '#E3AA30', // caution / declining
  sunbeamText: '#B5851E', // darkened variant for small text on light (§14)
  clay: '#BE5A30', // critical — sparingly
  verdant: '#5E9178', // interactive
  verdantDeep: '#3F6B57', // gradient partner for buttons/hero
  warm: '#C9A227', // occasional warm accent (records, sun)
} as const;

/** Score band → color + word (§1.4 Vitality Ring). */
export function bandFor(score: number): {
  word: 'Thriving' | 'Stable' | 'Stressed' | 'Critical';
  color: string;
} {
  if (score >= 85) return { word: 'Thriving', color: accent.sage };
  if (score >= 70) return { word: 'Stable', color: accent.sage };
  if (score >= 50) return { word: 'Stressed', color: accent.sunbeam };
  return { word: 'Critical', color: accent.clay };
}

/** Typography scale (§1.2). Inter for UI/data, Figtree for ritual headlines. */
export const type = {
  scoreXL: { fontFamily: 'Inter_800ExtraBold', fontSize: 64, fontVariant: ['tabular-nums'] as any },
  screenTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 32, letterSpacing: -0.5 },
  sectionHeader: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    textTransform: 'uppercase' as const,
    letterSpacing: 12 * 0.1,
  },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, letterSpacing: -0.2 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 21 },
  caption: { fontFamily: 'Inter_400Regular', fontSize: 12.5 },
  micro: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  // numbers render one weight heavier than their labels
  num: { fontFamily: 'Inter_600SemiBold', fontVariant: ['tabular-nums'] as any },
  numBold: { fontFamily: 'Inter_700Bold', fontVariant: ['tabular-nums'] as any },
  numHero: { fontFamily: 'Inter_800ExtraBold', fontVariant: ['tabular-nums'] as any },
  ritualHeadline: { fontFamily: 'Figtree_700Bold', fontSize: 34, letterSpacing: -0.5 },
  ritualTitle: { fontFamily: 'Figtree_700Bold', fontSize: 28, letterSpacing: -0.3 },
} as const;

/** Layout (§1.3): 4pt grid, 16pt margins, 20pt card radius. */
export const layout = {
  margin: 16,
  cardPadding: 16,
  cardRadius: 22,
  tabBar: 56,
  touchTarget: 44,
} as const;
