/**
 * Tests for out_of_coverage marking (E05-T1, Vorgriff W-09).
 * Mirrors the fixture style of routing/coverageCheck.test.ts.
 */
import { describe, it, expect } from 'vitest';
import type { LatLng, SearchResult } from '@yapaja/shared';
import { markOutOfCoverage, type SearchRegionsProvider } from './coverage.js';

const REGION_LI = {
  id: 'li',
  name: 'Liechtenstein',
  bounds: [9.47, 47.04, 9.64, 47.27] as [number, number, number, number],
};

function mockProvider(installed: typeof REGION_LI[] = []): SearchRegionsProvider {
  return { getInstalledRegions: async () => installed };
}

function result(latlng: LatLng, overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    name: 'Test',
    label: 'Test',
    latlng,
    type: 'city',
    source: 'photon',
    ...overrides,
  };
}

describe('markOutOfCoverage', () => {
  it('does not mark a result inside an installed region', async () => {
    const provider = mockProvider([REGION_LI]);
    const results = [result({ lat: 47.14, lon: 9.52 })];

    const marked = await markOutOfCoverage(results, provider);

    expect(marked[0].out_of_coverage).toBeUndefined();
  });

  it('marks a result outside all installed regions with out_of_coverage: true', async () => {
    const provider = mockProvider([REGION_LI]);
    const results = [result({ lat: 48.0, lon: 10.0 })]; // e.g. somewhere near Munich

    const marked = await markOutOfCoverage(results, provider);

    expect(marked[0].out_of_coverage).toBe(true);
  });

  it('does not mark anything when no regions are installed (cannot check)', async () => {
    const provider = mockProvider([]);
    const results = [result({ lat: 48.0, lon: 10.0 })];

    const marked = await markOutOfCoverage(results, provider);

    expect(marked[0].out_of_coverage).toBeUndefined();
  });

  it('handles a mix of covered and uncovered results independently', async () => {
    const provider = mockProvider([REGION_LI]);
    const results = [result({ lat: 47.14, lon: 9.52 }), result({ lat: 0, lon: 0 })];

    const marked = await markOutOfCoverage(results, provider);

    expect(marked[0].out_of_coverage).toBeUndefined();
    expect(marked[1].out_of_coverage).toBe(true);
  });

  it('accepts a point exactly on the boundary as covered', async () => {
    const provider = mockProvider([REGION_LI]);
    const results = [result({ lat: 47.04, lon: 9.47 })];

    const marked = await markOutOfCoverage(results, provider);

    expect(marked[0].out_of_coverage).toBeUndefined();
  });

  it('is a no-op for an empty results array', async () => {
    const provider = mockProvider([REGION_LI]);
    const marked = await markOutOfCoverage([], provider);
    expect(marked).toEqual([]);
  });
});
