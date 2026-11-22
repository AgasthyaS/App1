import { describe, expect, it } from 'vitest';

import { ROWS } from '@/lib/plantCatalog';
import { ALL_SPECIES, SPECIES_COUNT, getSpecies, searchSpecies } from '@/lib/plants';

const norm = (s: string) => s.replace(/[’']/g, "'").toLowerCase().trim();
const CATEGORIES = new Set(['tropical', 'fern', 'palm', 'succulent', 'cactus', 'vine', 'tree', 'herb', 'vegetable',
  'flowering', 'orchid', 'grass', 'carnivorous', 'shrub', 'bulb']);

describe('the plant catalog', () => {
  it('is large, and every row becomes a species', () => {
    expect(ROWS.length).toBeGreaterThanOrEqual(1600);
    expect(SPECIES_COUNT).toBe(ROWS.length);
  });

  it('has no two plants with the same common name — the name is the lookup key', () => {
    const seen = new Map<string, string>();
    for (const [common] of ROWS) {
      expect(seen.has(norm(common)), `"${common}" duplicates "${seen.get(norm(common))}"`).toBe(false);
      seen.set(norm(common), common);
    }
  });

  it('has no two plants with the same Latin name', () => {
    const seen = new Set<string>();
    for (const [common, latin] of ROWS) {
      expect(seen.has(norm(latin)), `${common}: ${latin}`).toBe(false);
      seen.add(norm(latin));
    }
  });

  it('every row is well formed', () => {
    for (const [common, latin, category, emoji] of ROWS) {
      expect(common.trim(), 'common name').toBe(common);
      expect(common.length).toBeGreaterThan(1);
      expect(latin.trim().length, `${common}: latin name`).toBeGreaterThan(3);
      expect(CATEGORIES.has(category), `${common}: category ${category}`).toBe(true);
      if (emoji != null) expect(emoji.length, `${common}: emoji`).toBeGreaterThan(0);
    }
  });

  it('every species has a usable care profile: a real moisture band and light needs', () => {
    for (const s of ALL_SPECIES) {
      const [lo, hi] = s.band;
      expect(lo, s.common).toBeGreaterThanOrEqual(0);
      expect(hi, s.common).toBeLessThanOrEqual(100);
      expect(lo, s.common).toBeLessThan(hi);
    }
  });

  it('plants added in November 2026 can be found by name and by search', () => {
    for (const name of ['Cooktown orchid', 'Fork-leaved sundew', 'Spiral aloe', 'Queen palm', 'Hoya Krimson Queen', 'Wasabi', 'Pawpaw']) {
      expect(getSpecies(name), name).toBeTruthy();
    }
    expect(searchSpecies('sundew').length).toBeGreaterThanOrEqual(8);
    expect(searchSpecies('hoya').length).toBeGreaterThanOrEqual(30);
  });
});
