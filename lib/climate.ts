/**
 * Location → climate → planting suggestions. The zone read is a coarse
 * latitude heuristic (plus month for season) — honest about being an
 * estimate, like everything else without a sensor.
 */

export type ClimateKind = 'tropical' | 'hot-dry' | 'temperate' | 'cold';

export interface ClimateRead {
  kind: ClimateKind;
  label: string;
  summary: string;
}

export interface PlantSuggestion {
  species: string; // must match the add-plant species catalog
  emoji: string;
  where: 'outdoor' | 'indoor';
  reason: string;
}

export function climateFromLatitude(latDeg: number): ClimateRead {
  const lat = Math.abs(latDeg);
  if (lat < 23.5) {
    return {
      kind: 'tropical',
      label: 'Tropical',
      summary: 'Warm year-round with high humidity — most houseplants can live outside.',
    };
  }
  if (lat < 35) {
    return {
      kind: 'hot-dry',
      label: 'Hot summers, mild winters',
      summary: 'Long growing season; heat-lovers thrive, but summer sun is intense.',
    };
  }
  if (lat < 50) {
    return {
      kind: 'temperate',
      label: 'Temperate',
      summary: 'Four seasons — a spring-to-fall outdoor window, indoor plants all year.',
    };
  }
  return {
    kind: 'cold',
    label: 'Cold winters',
    summary: 'Short outdoor season — hardy species outside, everything else indoors.',
  };
}

const NORTH_SUMMER = [4, 5, 6, 7, 8]; // May–Sep (0-indexed months)

export function suggestionsFor(kind: ClimateKind, latDeg: number, month: number): PlantSuggestion[] {
  const north = latDeg >= 0;
  const summer = north ? NORTH_SUMMER.includes(month) : !NORTH_SUMMER.includes(month);

  const indoorStaples: PlantSuggestion[] = [
    { species: 'Golden pothos', emoji: '🍃', where: 'indoor', reason: 'Nearly unkillable and happy in medium light — the safest first plant.' },
    { species: 'Snake plant', emoji: '🌵', where: 'indoor', reason: 'Tolerates low light and forgets you forgot to water.' },
    { species: 'Monstera', emoji: '🌿', where: 'indoor', reason: 'Fast, dramatic growth near any bright window.' },
  ];

  switch (kind) {
    case 'tropical':
      return [
        { species: 'Monstera', emoji: '🌿', where: 'outdoor', reason: 'Native to this climate — it will outgrow the pot outside.' },
        { species: 'Boston fern', emoji: '🌱', where: 'outdoor', reason: 'Loves your ambient humidity; a shaded porch is perfect.' },
        { species: 'Cherry tomato', emoji: '🍅', where: 'outdoor', reason: 'Fruits nearly year-round here with steady water.' },
        ...indoorStaples.slice(0, 2),
      ];
    case 'hot-dry':
      return [
        { species: 'Lavender', emoji: '💜', where: 'outdoor', reason: 'Built for hot sun and lean, dry soil — thrives on neglect here.' },
        { species: 'Rosemary', emoji: '🌿', where: 'outdoor', reason: 'Shrugs off heat and drought; you can cook with the trimmings.' },
        { species: 'Cherry tomato', emoji: '🍅', where: 'outdoor', reason: summer ? 'Peak season now — expect heavy fruiting with afternoon shade.' : 'Plant after the last cool night for a long season.' },
        ...indoorStaples.slice(0, 2),
      ];
    case 'temperate':
      return [
        { species: 'Cherry tomato', emoji: '🍅', where: 'outdoor', reason: summer ? 'In season right now — a sunny rail or bed will fruit until fall.' : 'Start it indoors; move it out after the last frost.' },
        { species: 'Basil', emoji: '🌿', where: 'outdoor', reason: summer ? 'Loves your warm months; pinch it weekly and it doubles.' : 'Grows happily on a warm windowsill until spring.' },
        { species: 'Lavender', emoji: '💜', where: 'outdoor', reason: 'Perennial here — full sun and it returns every year.' },
        ...indoorStaples,
      ];
    case 'cold':
      return [
        { species: 'Basil', emoji: '🌿', where: summer ? 'outdoor' : 'indoor', reason: summer ? 'Quick summer crop — harvest before the first cold night.' : 'Keep it on the warmest windowsill; outside would kill it now.' },
        ...indoorStaples,
        { species: 'Boston fern', emoji: '🌱', where: 'indoor', reason: 'Happy indoors year-round if you keep the air from going desert-dry.' },
      ];
  }
}
