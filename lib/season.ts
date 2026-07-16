/**
 * Seasonal awareness. Plants don't live on a flat calendar — light halves in
 * winter, growth surges in spring, pots dry twice as fast in a summer heat
 * wave. Everything here derives from the current month (northern hemisphere)
 * and feeds the watering math, the care tasks, and the tips so the app adapts
 * automatically instead of asking the user to remember.
 */

export type Season = 'winter' | 'spring' | 'summer' | 'fall';

export function currentSeason(d: Date = new Date()): Season {
  const m = d.getMonth(); // 0-based
  if (m === 11 || m <= 1) return 'winter';
  if (m <= 4) return 'spring';
  if (m <= 7) return 'summer';
  return 'fall';
}

/** Multiply the watering interval by this (winter = longer gaps, summer = shorter). */
export function seasonIntervalFactor(season: Season): number {
  switch (season) {
    case 'winter': return 1.35;
    case 'summer': return 0.85;
    case 'spring': return 0.95;
    case 'fall': return 1.1;
  }
}

export const SEASON_LABEL: Record<Season, string> = {
  winter: 'Winter',
  spring: 'Spring',
  summer: 'Summer',
  fall: 'Fall',
};

export const SEASON_EMOJI: Record<Season, string> = {
  winter: '❄️',
  spring: '🌱',
  summer: '☀️',
  fall: '🍂',
};

export interface SeasonalNote {
  icon: string; // Ionicons name
  text: string;
}

/** What this season changes, in plain words — shown on the plant page and briefing. */
export function seasonalNotes(season: Season): SeasonalNote[] {
  switch (season) {
    case 'winter':
      return [
        { icon: 'water-outline', text: 'Growth slows — most plants want roughly a third less water. Let soil dry deeper between drinks.' },
        { icon: 'flask-outline', text: 'Pause fertilizing until spring; feeding a dormant plant burns roots.' },
        { icon: 'thermometer-outline', text: 'Keep leaves off cold windowpanes and away from radiators and heater vents — both stress plants.' },
        { icon: 'sunny-outline', text: 'Daylight is weak and short — move light-hungry plants closer to the brightest window.' },
      ];
    case 'spring':
      return [
        { icon: 'water-outline', text: 'Growth is restarting — watering needs climb week by week. Watch the soil, not the calendar.' },
        { icon: 'flask-outline', text: 'Start fertilizing again: half-strength every 4 weeks, ramping up as new leaves appear.' },
        { icon: 'swap-vertical-outline', text: 'Best season to repot — roots recover fastest now. Size up if roots circle the pot.' },
      ];
    case 'summer':
      return [
        { icon: 'water-outline', text: 'Heat dries pots fast — expect to water noticeably more often, sometimes twice as often on hot weeks.' },
        { icon: 'sunny-outline', text: 'Midday sun through glass can scorch — pull sensitive plants back or filter with a sheer curtain.' },
        { icon: 'flask-outline', text: 'Peak growing season — feed regularly (every 2–4 weeks at label strength).' },
      ];
    case 'fall':
      return [
        { icon: 'water-outline', text: 'Growth is winding down — stretch the time between waterings as days shorten.' },
        { icon: 'flask-outline', text: 'Taper feeding to monthly, then stop by late fall.' },
        { icon: 'sunny-outline', text: 'The sun sits lower — a spot that was fine in July may be too dim now; consider moving plants windowward.' },
      ];
  }
}
