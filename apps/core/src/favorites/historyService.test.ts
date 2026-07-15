/**
 * Unit tests for HistoryService (E05-T3): recording, FIFO eviction at the
 * 100-entry cap, and validation (at least one of query/destination).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { closeDb } from '../db/index.js';
import { HistoryService, HistoryError, HISTORY_MAX_ENTRIES } from './historyService.js';

describe('HistoryService', () => {
  let service: HistoryService;

  beforeEach(() => {
    process.env.DB_PATH = ':memory:';
    closeDb();
    service = new HistoryService();
  });

  afterEach(() => {
    closeDb();
  });

  /** Deterministic, strictly increasing timestamps -- avoids same-millisecond
   *  collisions from calling `new Date().toISOString()` in a tight loop. */
  function tsAt(offsetSeconds: number): string {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, offsetSeconds)).toISOString();
  }

  describe('add()', () => {
    it('records a query-only entry', () => {
      const entry = service.add({ query: 'Vaduz', ts: tsAt(0) });
      expect(entry.id).toBeDefined();
      expect(entry.query).toBe('Vaduz');
      expect(entry.destination).toBeNull();
    });

    it('records a destination-only entry', () => {
      const entry = service.add({
        destination: { latlng: { lat: 47.14, lon: 9.52 }, name: 'Vaduz' },
        ts: tsAt(0),
      });
      expect(entry.query).toBeNull();
      expect(entry.destination).toEqual({ latlng: { lat: 47.14, lon: 9.52 }, name: 'Vaduz' });
    });

    it('records an entry with both query and destination', () => {
      const entry = service.add({
        query: 'Vaduz',
        destination: { latlng: { lat: 47.14, lon: 9.52 }, name: 'Vaduz' },
        ts: tsAt(0),
      });
      expect(entry.query).toBe('Vaduz');
      expect(entry.destination).not.toBeNull();
    });

    it('rejects an entry with neither query nor destination', () => {
      expect(() => service.add({ ts: tsAt(0) })).toThrow(HistoryError);
      try {
        service.add({});
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as HistoryError).code).toBe('VALIDATION_ERROR');
      }
    });

    it('defaults ts to "now" when not provided', () => {
      const before = Date.now();
      const entry = service.add({ query: 'Vaduz' });
      const after = Date.now();
      const entryMs = new Date(entry.ts).getTime();
      expect(entryMs).toBeGreaterThanOrEqual(before);
      expect(entryMs).toBeLessThanOrEqual(after);
    });
  });

  describe('getAll()', () => {
    it('returns entries newest-first', () => {
      service.add({ query: 'A', ts: tsAt(0) });
      service.add({ query: 'B', ts: tsAt(10) });
      service.add({ query: 'C', ts: tsAt(5) });

      expect(service.getAll().map((e) => e.query)).toEqual(['B', 'C', 'A']);
    });
  });

  describe('FIFO cap at 100 entries', () => {
    it('evicts the oldest entries once the cap is exceeded', () => {
      const total = HISTORY_MAX_ENTRIES + 5;
      for (let i = 0; i < total; i++) {
        service.add({ query: `q-${i}`, ts: tsAt(i) });
      }

      const all = service.getAll();
      expect(all).toHaveLength(HISTORY_MAX_ENTRIES);

      // The 5 oldest (q-0..q-4) were evicted; the most recent 100 remain.
      const queries = all.map((e) => e.query).sort();
      const expected = Array.from({ length: HISTORY_MAX_ENTRIES }, (_, i) => `q-${i + 5}`).sort();
      expect(queries).toEqual(expected);
    });

    it('never exceeds the cap even one entry at a time past the boundary', () => {
      for (let i = 0; i < HISTORY_MAX_ENTRIES; i++) {
        service.add({ query: `q-${i}`, ts: tsAt(i) });
      }
      expect(service.getAll()).toHaveLength(HISTORY_MAX_ENTRIES);

      // One more push -- cap must still hold, and the oldest (q-0) is gone.
      service.add({ query: 'newest', ts: tsAt(HISTORY_MAX_ENTRIES) });
      const all = service.getAll();
      expect(all).toHaveLength(HISTORY_MAX_ENTRIES);
      expect(all.some((e) => e.query === 'q-0')).toBe(false);
      expect(all.some((e) => e.query === 'newest')).toBe(true);
    });
  });

  describe('deleteOne()', () => {
    it('deletes a single entry', () => {
      const entry = service.add({ query: 'Vaduz', ts: tsAt(0) });
      service.deleteOne(entry.id);
      expect(service.getAll()).toHaveLength(0);
    });

    it('throws NOT_FOUND for a non-existent id', () => {
      expect(() => service.deleteOne('nope')).toThrow(HistoryError);
    });
  });

  describe('clear()', () => {
    it('deletes all entries', () => {
      service.add({ query: 'A', ts: tsAt(0) });
      service.add({ query: 'B', ts: tsAt(1) });
      service.clear();
      expect(service.getAll()).toHaveLength(0);
    });
  });
});
