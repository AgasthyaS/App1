import { Appearance } from 'react-native';

/**
 * GREENR design tokens.
 *
 * The palette follows the phone's appearance (light or dark), the way every
 * Apple app does. `dark` is the name the whole codebase already reads its
 * surface colours from (884 call sites), so rather than thread a hook through
 * every screen, these objects are the LIVE palette: `applyAppearance` rewrites
 * their values in place and the root layout remounts the tree. Everything reads
 * colours at render time, so one remount repaints the app.
 *
 * Ritual surfaces (onboarding, Care Mode) keep the warm `light` palette in both
 * appearances. Numbers render one weight heavier than labels, tabular.
 */

type Palette = {
  bg: string;
  surface1: string;
  surface2: string;
  hairline: string;
  ink: string;
  inkMuted: string;
  /** hero gradient stops (top of Plant Detail) */
  heroTop: string;
  heroBottom: string;
  /** the whisper of an edge around a card */
  cardBorder: string;
  /** translucent chrome (tab bar, floating buttons) */
  glass: string;
};

const DARK: Palette = {
  bg: '#0B120E',
  surface1: '#141D17',
  surface2: '#1C2720',
  hairline: '#243129',
  ink: '#EDF1EA',
  inkMuted: '#97A499',
  heroTop: '#1C2A21',
  heroBottom: '#0B120E',
  cardBorder: 'rgba(255,255,255,0.05)',
  glass: 'rgba(24,34,27,0.78)',
};

const LIGHT: Palette = {
  bg: '#F2F4EF',
  surface1: '#FFFFFF',
  surface2: '#F3F5F1',
  hairline: '#E1E6DE',
  ink: '#111A14',
  inkMuted: '#67736A',
  heroTop: '#E2ECE0',
  heroBottom: '#F2F4EF',
  cardBorder: 'rgba(17,26,20,0.05)',
  glass: 'rgba(255,255,255,0.80)',
};

type Accents = {
  sage: string;
  sunbeam: string;
  sunbeamText: string;
  clay: string;
  verdant: string;
  verdantDeep: string;
  warm: string;
};

const ACCENT_DARK: Accents = {
  sage: '#96A878', // healthy / in-range
  sunbeam: '#E3AA30', // caution / declining
  sunbeamText: '#E3AA30',
  clay: '#D0663A', // critical — sparingly
  verdant: '#5E9178', // interactive
  verdantDeep: '#3F6B57',
  warm: '#C9A227',
};

// Darker on white so small text still clears contrast.
const ACCENT_LIGHT: Accents = {
  sage: '#557A3C',
  sunbeam: '#B57F0C',
  sunbeamText: '#94680A',
  clay: '#B4461D',
  verdant: '#3B7A5C',
  verdantDeep: '#2B5C45',
  warm: '#A3801A',
};

/** The live surface palette (name kept for history — it is not always dark). */
export const dark: Palette = { ...DARK };

/** The warm "ritual" palette — onboarding, Care Mode, legal pages. */
export const light = {
  bg: '#F6F3EA',
  surface1: '#FFFFFF',
  surface2: '#FFFFFF',
  hairline: '#E5DFD0',
  ink: '#3A2B1E',
  inkMuted: '#8B7E6E',
  heroTop: '#EAE9DA',
  heroBottom: '#F6F3EA',
} as const;

export const accent: Accents = { ...ACCENT_DARK };

export type Scheme = 'light' | 'dark';
let current: Scheme = 'dark';

/** Repaint the live palette. Returns true when anything changed. */
export function applyAppearance(scheme: Scheme | null | undefined): boolean {
  const next: Scheme = scheme === 'light' ? 'light' : 'dark';
  if (next === current) return false;
  current = next;
  Object.assign(dark, next === 'light' ? LIGHT : DARK);
  Object.assign(accent, next === 'light' ? ACCENT_LIGHT : ACCENT_DARK);
  return true;
}

export function currentScheme(): Scheme {
  return current;
}

// Apply before any screen module reads a colour.
try {
  applyAppearance(Appearance.getColorScheme());
} catch {
  /* server render — stays dark until the client mounts */
}

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

/**
 * Typography — Apple's text-style scale in the system font (San Francisco on
 * Apple devices, Segoe on Windows, Roboto on Android). 'System' is resolved by
 * React Native and react-native-web to the platform's own UI font.
 */
const sys = (weight: '400' | '500' | '600' | '700' | '800') => ({
  fontFamily: 'System',
  fontWeight: weight,
});

export const type = {
  scoreXL: { ...sys('700'), fontSize: 64, fontVariant: ['tabular-nums'] as any, letterSpacing: -1 },
  /** Large Title — 34pt bold */
  screenTitle: { ...sys('700'), fontSize: 34, letterSpacing: 0.2 },
  /** Grouped-list header — footnote, uppercase, muted */
  sectionHeader: {
    ...sys('500'),
    fontSize: 13,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  /** Headline — 17pt semibold */
  cardTitle: { ...sys('600'), fontSize: 17, letterSpacing: -0.2 },
  /** Body — 16pt (a touch under Apple's 17 for these dense cards) */
  body: { ...sys('400'), fontSize: 16, lineHeight: 22 },
  /** Footnote — 13pt */
  caption: { ...sys('400'), fontSize: 13.5 },
  /** Caption 1 — 12pt */
  micro: { ...sys('500'), fontSize: 12 },
  num: { ...sys('600'), fontVariant: ['tabular-nums'] as any },
  numBold: { ...sys('700'), fontVariant: ['tabular-nums'] as any },
  numHero: { ...sys('800'), fontVariant: ['tabular-nums'] as any },
  ritualHeadline: { ...sys('700'), fontSize: 34, letterSpacing: 0.2 },
  /** Title 1 — 28pt bold */
  ritualTitle: { ...sys('700'), fontSize: 28, letterSpacing: 0.1 },
};

/** Layout (§1.3): 4pt grid, 16pt margins, continuous-feeling card radius. */
export const layout = {
  margin: 16,
  cardPadding: 16,
  cardRadius: 20,
  tabBar: 64,
  touchTarget: 44,
} as const;
