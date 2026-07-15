/**
 * Contract test for SearchResult (E05-T1).
 * Verifies the JSON Schema stays in sync with the `SearchResult` interface
 * and rejects malformed payloads (unknown `source`, missing fields, extra
 * properties).
 */

import { describe, it, expect } from 'vitest';
import { validateSearchResult, getValidationErrorsSearchResult } from '../validators';
import type { SearchResult } from '../types';

function validResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    name: 'Vaduz',
    label: 'Vaduz, Liechtenstein',
    latlng: { lat: 47.141, lon: 9.5215 },
    type: 'city',
    source: 'photon',
    ...overrides,
  };
}

describe('SearchResult schema (contract)', () => {
  it('accepts a valid photon result', () => {
    expect(validateSearchResult(validResult())).toBe(true);
  });

  it('accepts a valid nominatim result', () => {
    expect(validateSearchResult(validResult({ source: 'nominatim' }))).toBe(true);
  });

  it('accepts a valid coords result', () => {
    expect(validateSearchResult(validResult({ source: 'coords', type: 'coordinates' }))).toBe(true);
  });

  it('accepts out_of_coverage true/false', () => {
    expect(validateSearchResult(validResult({ out_of_coverage: true }))).toBe(true);
    expect(validateSearchResult(validResult({ out_of_coverage: false }))).toBe(true);
  });

  it('accepts a result without out_of_coverage (optional field)', () => {
    const { out_of_coverage: _unused, ...rest } = validResult() as SearchResult & {
      out_of_coverage?: boolean;
    };
    expect(validateSearchResult(rest)).toBe(true);
  });

  it('rejects an unknown source', () => {
    expect(validateSearchResult(validResult({ source: 'bing' as SearchResult['source'] }))).toBe(
      false,
    );
  });

  it('rejects a missing required field', () => {
    const { label: _unused, ...rest } = validResult();
    expect(validateSearchResult(rest)).toBe(false);
  });

  it('rejects an invalid latlng', () => {
    expect(validateSearchResult(validResult({ latlng: { lat: 999, lon: 9.5 } }))).toBe(false);
  });

  it('rejects additional/unexpected properties', () => {
    expect(validateSearchResult({ ...validResult(), extra: 'nope' })).toBe(false);
  });

  it('surfaces human-readable validation errors', () => {
    const errors = getValidationErrorsSearchResult({ name: 'x' });
    expect(errors.length).toBeGreaterThan(0);
  });
});
