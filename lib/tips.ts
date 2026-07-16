import { getSpecies } from './plants';
import { currentSeason, type Season } from './season';

/**
 * Experience-aware gardening tips. The onboarding survey asks how long the
 * user has gardened and what goes wrong most often — this is where those
 * answers actually change the app. A beginner is told to cut yellow leaves;
 * a 5+ year gardener isn't lectured about drainage holes.
 */

export type ExperienceLevel = 'beginner' | 'intermediate' | 'expert';

/** Map the survey's experience answer to a level. Unknown answers → beginner (explain more, not less). */
export function experienceLevel(experience?: string | null): ExperienceLevel {
  switch (experience) {
    case '5+ years': return 'expert';
    case '1–5 years': return 'intermediate';
    default: return 'beginner';
  }
}

export interface Tip {
  icon: string; // Ionicons name
  text: string;
}

interface RankedTip extends Tip {
  levels: ExperienceLevel[];
  seasons?: Season[]; // omit = all year
  struggles?: string[]; // survey `struggle` answers this speaks to (boosted, not required)
}

const TIPS: RankedTip[] = [
  // ── beginner fundamentals ──
  { icon: 'cut-outline', text: 'Trim leaves that have gone fully yellow — they won’t recover, and the plant stops wasting energy on them.', levels: ['beginner'] },
  { icon: 'water-outline', text: 'When in doubt, don’t water. Far more houseplants die from soggy roots than from a dry day.', levels: ['beginner'], struggles: ['Watering', 'Honestly, not sure'] },
  { icon: 'water-outline', text: 'Water slowly until it runs from the drainage holes, then empty the saucer — roots sitting in water rot.', levels: ['beginner'], struggles: ['Watering'] },
  { icon: 'hand-left-outline', text: 'Poke a finger an inch into the soil before watering — dry there means water, damp means wait.', levels: ['beginner'], struggles: ['Watering'] },
  { icon: 'sunny-outline', text: '"Bright indirect light" means near a window but out of the direct beam — a few feet back from a south window is right for most plants.', levels: ['beginner'], struggles: ['Light'] },
  { icon: 'swap-horizontal-outline', text: 'Don’t move a plant around constantly — most sulk after a move. Pick a good spot and give it a few weeks.', levels: ['beginner'] },
  { icon: 'search-outline', text: 'Check under leaves when you water — pests (tiny webs, sticky spots, white fuzz) start there and are easy to beat early.', levels: ['beginner', 'intermediate'], struggles: ['Pests'] },
  // ── intermediate ──
  { icon: 'flask-outline', text: 'Feed at half the label strength twice as often — steadier nutrition, no fertilizer burn.', levels: ['intermediate'] },
  { icon: 'swap-vertical-outline', text: 'If roots circle the pot’s base or push out of drainage holes, repot one size up (2–3 cm wider), ideally in spring.', levels: ['intermediate'], seasons: ['spring', 'summer'] },
  { icon: 'refresh-outline', text: 'Rotate pots a quarter turn each watering so growth stays even instead of leaning to the light.', levels: ['beginner', 'intermediate'] },
  { icon: 'water-outline', text: 'Bottom-water compacted pots: sit them in 2–3 cm of water for 20 minutes so the root ball rehydrates evenly.', levels: ['intermediate', 'expert'], struggles: ['Watering'] },
  { icon: 'sparkles-outline', text: 'Dust on leaves blocks real light — wipe broad leaves monthly with a damp cloth.', levels: ['intermediate'], struggles: ['Light'] },
  // ── expert ──
  { icon: 'leaf-outline', text: 'Chunk up your mix: adding ~30% bark or perlite to standard potting soil prevents the compaction that slowly suffocates roots.', levels: ['expert'] },
  { icon: 'cut-outline', text: 'Take spring cuttings when you prune — most aroids and vines root in water in 2–3 weeks and back up your favorites.', levels: ['expert'], seasons: ['spring', 'summer'] },
  { icon: 'analytics-outline', text: 'Flush pots every couple of months: run water through generously to wash out accumulated fertilizer salts.', levels: ['expert'] },
  { icon: 'bug-outline', text: 'A monthly preventative wipe-down with dilute neem or insecticidal soap keeps spider mites from ever establishing.', levels: ['expert'], struggles: ['Pests'] },
  // ── seasonal (all levels; season does the filtering) ──
  { icon: 'snow-outline', text: 'Cold drafts from doors and single-pane windows can drop leaf temperature far below room temperature — keep tropicals clear of both.', levels: ['beginner', 'intermediate', 'expert'], seasons: ['winter'] },
  { icon: 'sunny-outline', text: 'Summer heat waves can double water use — check soil a day earlier than usual when it’s hot.', levels: ['beginner', 'intermediate', 'expert'], seasons: ['summer'] },
];

/**
 * The tips this user should actually see: filtered to their experience level
 * and the current season, with tips matching their declared struggle first.
 */
export function tipsFor(opts: {
  experience?: string | null;
  struggle?: string | null;
  season?: Season;
  count?: number;
}): Tip[] {
  const level = experienceLevel(opts.experience);
  const season = opts.season ?? currentSeason();
  const eligible = TIPS.filter(
    (t) => t.levels.includes(level) && (!t.seasons || t.seasons.includes(season)),
  );
  const boosted = eligible
    .map((t, i) => ({ t, i, boost: opts.struggle && t.struggles?.includes(opts.struggle) ? 1 : 0 }))
    .sort((a, b) => b.boost - a.boost || a.i - b.i)
    .map((x) => x.t);
  return boosted.slice(0, opts.count ?? 3).map(({ icon, text }) => ({ icon, text }));
}

/**
 * A species-specific pruning/grooming pointer, gated by experience: beginners
 * get the basic "remove yellow leaves"; experts get nothing generic.
 */
export function groomingTip(speciesCommon: string, experience?: string | null): Tip | null {
  const level = experienceLevel(experience);
  if (level === 'expert') return null;
  const s = getSpecies(speciesCommon);
  const name = s?.common ?? speciesCommon;
  if (level === 'beginner') {
    return { icon: 'cut-outline', text: `Snip off fully yellow or crispy-brown leaves at the base — ${name} redirects that energy into healthy growth.` };
  }
  return { icon: 'cut-outline', text: `Groom ${name} when you water: spent leaves off, quick pest check under the foliage.` };
}
