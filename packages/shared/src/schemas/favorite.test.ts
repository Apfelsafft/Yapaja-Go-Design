/**
 * Contract test for Favorite (E05-T3).
 * Verifies the JSON Schema stays in sync with the `Favorite` interface and
 * rejects malformed payloads (unknown category, missing fields, extra
 * properties).
 */

import { describe, it, expect } from 'vitest';
import { validateFavorite, getValidationErrorsFavorite } from '../validators';
import type { Favorite } from '../types';

function validFavorite(overrides: Partial<Favorite> = {}): Favorite {
  return {
    id: 'fav-1',
    name: 'Zuhause',
    latlng: { lat: 47.141, lon: 9.5215 },
    icon: 'home',
    category: 'home',
    sort_order: 0,
    ...overrides,
  };
}

describe('Favorite schema (contract)', () => {
  it('accepts a valid home favorite', () => {
    expect(validateFavorite(validFavorite())).toBe(true);
  });

  it('accepts each valid category', () => {
    for (const category of ['home', 'campsite', 'poi', 'custom'] as const) {
      expect(validateFavorite(validFavorite({ category }))).toBe(true);
    }
  });

  it('rejects an unknown category', () => {
    expect(validateFavorite(validFavorite({ category: 'bogus' as Favorite['category'] }))).toBe(
      false,
    );
  });

  it('rejects a missing required field', () => {
    const { name: _unused, ...rest } = validFavorite();
    expect(validateFavorite(rest)).toBe(false);
  });

  it('rejects an invalid latlng', () => {
    expect(validateFavorite(validFavorite({ latlng: { lat: 999, lon: 9.5 } }))).toBe(false);
  });

  it('rejects additional/unexpected properties', () => {
    expect(validateFavorite({ ...validFavorite(), extra: 'nope' })).toBe(false);
  });

  it('surfaces human-readable validation errors', () => {
    const errors = getValidationErrorsFavorite({ name: 'x' });
    expect(errors.length).toBeGreaterThan(0);
  });
});
