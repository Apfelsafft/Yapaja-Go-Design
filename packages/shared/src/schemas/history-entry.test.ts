/**
 * Contract test for HistoryEntry (E05-T3).
 * Verifies the JSON Schema stays in sync with the `HistoryEntry` interface.
 * The "at least one of query/destination" business rule is NOT a structural
 * schema concern (see the schema file's doc comment) -- it's covered by the
 * Core's history route/service tests instead.
 */

import { describe, it, expect } from 'vitest';
import { validateHistoryEntry, getValidationErrorsHistoryEntry } from '../validators';
import type { HistoryEntry } from '../types';

function validEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 'hist-1',
    query: 'Vaduz',
    destination: null,
    ts: '2026-07-15T10:00:00.000Z',
    ...overrides,
  };
}

describe('HistoryEntry schema (contract)', () => {
  it('accepts a query-only entry', () => {
    expect(validateHistoryEntry(validEntry())).toBe(true);
  });

  it('accepts a destination-only entry', () => {
    expect(
      validateHistoryEntry(
        validEntry({
          query: null,
          destination: { latlng: { lat: 47.14, lon: 9.52 }, name: 'Vaduz' },
        }),
      ),
    ).toBe(true);
  });

  it('accepts an entry with both query and destination', () => {
    expect(
      validateHistoryEntry(
        validEntry({ destination: { latlng: { lat: 47.14, lon: 9.52 }, name: 'Vaduz' } }),
      ),
    ).toBe(true);
  });

  it('rejects a missing required field', () => {
    const { ts: _unused, ...rest } = validEntry();
    expect(validateHistoryEntry(rest)).toBe(false);
  });

  it('rejects an invalid destination latlng', () => {
    expect(
      validateHistoryEntry(
        validEntry({ destination: { latlng: { lat: 999, lon: 9.5 }, name: 'x' } }),
      ),
    ).toBe(false);
  });

  it('rejects additional/unexpected properties', () => {
    expect(validateHistoryEntry({ ...validEntry(), extra: 'nope' })).toBe(false);
  });

  it('surfaces human-readable validation errors', () => {
    const errors = getValidationErrorsHistoryEntry({ id: 'x' });
    expect(errors.length).toBeGreaterThan(0);
  });
});
