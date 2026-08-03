import { describe, it, expect } from 'vitest';
import { distinctCategories, filterByCategory } from './filterPois.js';
import type { CampsitePoi } from './types.js';

function poi(overrides: Partial<CampsitePoi> = {}): CampsitePoi {
  return {
    id: 'poi-1',
    name: 'Test Platz',
    category: 'stellplatz',
    categoryLabel: 'Stellplatz',
    pricePerNightEur: 10,
    amenities: [],
    description: '',
    lat: 47.4,
    lng: 9.6,
    ...overrides,
  };
}

describe('distinctCategories', () => {
  it('returns each category once, in first-seen order', () => {
    const pois = [
      poi({ id: 'a', category: 'stellplatz', categoryLabel: 'Stellplatz' }),
      poi({ id: 'b', category: 'campingplatz', categoryLabel: 'Campingplatz' }),
      poi({ id: 'c', category: 'stellplatz', categoryLabel: 'Stellplatz' }),
      poi({ id: 'd', category: 'wildcamping', categoryLabel: 'Wildcamping-Spot' }),
    ];
    expect(distinctCategories(pois)).toEqual([
      { id: 'stellplatz', label: 'Stellplatz' },
      { id: 'campingplatz', label: 'Campingplatz' },
      { id: 'wildcamping', label: 'Wildcamping-Spot' },
    ]);
  });

  it('returns an empty list for an empty input', () => {
    expect(distinctCategories([])).toEqual([]);
  });
});

describe('filterByCategory', () => {
  const pois = [
    poi({ id: 'a', category: 'stellplatz' }),
    poi({ id: 'b', category: 'campingplatz' }),
    poi({ id: 'c', category: 'wildcamping' }),
    poi({ id: 'd', category: 'stellplatz' }),
  ];

  it('keeps only POIs whose category is active', () => {
    const result = filterByCategory(pois, new Set(['stellplatz']));
    expect(result.map((p) => p.id)).toEqual(['a', 'd']);
  });

  it('supports multiple active categories', () => {
    const result = filterByCategory(pois, new Set(['stellplatz', 'wildcamping']));
    expect(result.map((p) => p.id)).toEqual(['a', 'c', 'd']);
  });

  it('returns nothing when no category is active (explicit empty state, not "show all")', () => {
    expect(filterByCategory(pois, new Set())).toEqual([]);
  });

  it('is a pure function: does not mutate its input', () => {
    const copy = pois.map((p) => ({ ...p }));
    filterByCategory(pois, new Set(['stellplatz']));
    expect(pois).toEqual(copy);
  });
});
