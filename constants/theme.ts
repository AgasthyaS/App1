/**
 * GREENR 2.0 design tokens — Interface Spec §1.
 * Instrument surfaces are dark; ritual surfaces (onboarding, Care Mode,
 * education) are light. Numbers always render one weight heavier than labels,
 * with tabular numerals.
 */

export const dark = {
  bg: '#0F1713', // Midnight Canopy
  surface1: '#16211A',
  surface2: '#1B2820',
  hairline: '#243329',
  ink: '#E9EDE6',
  inkMuted: '#8B968C',
} as const;

export const light = {
  bg: '#F5F2E9', // Greenhouse
  surface1: '#FFFFFF',
  surface2: '#FFFFFF',
  hairline: '#E2DDCE',
  ink: '#3D2B1F', // Soil
  inkMuted: '#8A7E6F',
} as const;

export const accent = {
  sage: '#8A9B6E', // healthy / in-range
  sunbeam: '#E0A526', // caution / declining
  sunbeamText: '#B5851E', // darkened variant for small text on light (§14)
  clay: '#B5542D', // critical — sparingly
  verdant: '#5B8A72', // interactive
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
  scoreXL: { fontFamily: 'Inter_700Bold', fontSize: 64, fontVariant: ['tabular-nums'] as any },
  screenTitle: { fontFamily: 'Inter_700Bold', fontSize: 28 },
  sectionHeader: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    textTransform: 'uppercase' as const,
    letterSpacing: 13 * 0.08,
  },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 17 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 15 },
  caption: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  micro: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  // numbers render one weight heavier than their labels
  num: { fontFamily: 'Inter_600SemiBold', fontVariant: ['tabular-nums'] as any },
  numBold: { fontFamily: 'Inter_700Bold', fontVariant: ['tabular-nums'] as any },
  ritualHeadline: { fontFamily: 'Figtree_700Bold', fontSize: 32 },
  ritualTitle: { fontFamily: 'Figtree_700Bold', fontSize: 28 },
} as const;

/** Layout (§1.3): 4pt grid, 16pt margins, 20pt card radius. */
export const layout = {
  margin: 16,
  cardPadding: 16,
  cardRadius: 20,
  tabBar: 56,
  touchTarget: 44,
} as const;
