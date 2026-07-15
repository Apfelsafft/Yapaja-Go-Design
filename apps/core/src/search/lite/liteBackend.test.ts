/**
 * `LiteBackend` (`GeocoderBackend` contract) tests -- E05-T5, W-12.
 * Builds a real (temp-file) `lite_search.db` via `buildLiteIndexFile` and
 * exercises `LiteBackend` against it, plus the "index not built yet"
 * failure path (missing db file -> typed `GeocoderBackendError`, never an
 * uncaught throw of something else).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { NormalizedRecord } from './extract.js';
import { buildLiteIndexFile } from './buildIndex.js';
import { LiteBackend } from './liteBackend.js';
import { isGeocoderBackendError } from '../errors.js';

const FIXTURE: NormalizedRecord[] = [
  { kind: 'city', name: 'Vaduz', lat: 47.141, lon: 9.5215 },
  { kind: 'town', name: 'Schaan', lat: 47.166, lon: 9.5091 },
  { kind: 'street', name: 'Vaduzer Straße', lat: 47.142, lon: 9.522 },
];

describe('LiteBackend', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  function buildFixtureDb(records: NormalizedRecord[] = FIXTURE): string {
    tmpDir = mkdtempSync(join(tmpdir(), 'lite-backend-test-'));
    const dbPath = join(tmpDir, `lite_search-${randomUUID()}.db`);
    buildLiteIndexFile(records, dbPath);
    return dbPath;
  }

  it('has source "lite"', () => {
    const backend = new LiteBackend({ dbPath: buildFixtureDb() });
    expect(backend.source).toBe('lite');
  });

  it('search() returns ranked SearchResult[] with source "lite"', async () => {
    const backend = new LiteBackend({ dbPath: buildFixtureDb() });
    const results = await backend.search({ q: 'Vadu', limit: 10 });
    expect(results.map((r) => r.name)).toEqual(['Vaduz', 'Vaduzer Straße']);
    expect(results.every((r) => r.source === 'lite')).toBe(true);
    expect(results[0].latlng).toEqual({ lat: 47.141, lon: 9.5215 });
    expect(results[0].type).toBe('city');
  });

  it('search() respects the limit', async () => {
    const backend = new LiteBackend({ dbPath: buildFixtureDb() });
    const results = await backend.search({ q: 'Vadu', limit: 1 });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Vaduz');
  });

  it('search() applies distance-bias when lat/lon are given', async () => {
    // Same name/kind at two locations -> identical prefix tier, identical
    // kind tier, and (same tokens, same length) an identical bm25 score --
    // the ONLY thing left to break the tie is the distance-bias tier, so
    // this proves `query.lat`/`query.lon` actually reach the ranking step.
    const records: NormalizedRecord[] = [
      { kind: 'city', name: 'Doppelstadt', lat: 48.5, lon: 11.5 }, // far
      { kind: 'city', name: 'Doppelstadt', lat: 47.14, lon: 9.52 }, // near the origin below
    ];
    const backend = new LiteBackend({ dbPath: buildFixtureDb(records) });
    const results = await backend.search({ q: 'Doppelstadt', limit: 10, lat: 47.14, lon: 9.52 });
    expect(results).toHaveLength(2);
    expect(results[0].latlng).toEqual({ lat: 47.14, lon: 9.52 });
  });

  it('search() returns [] for a genuinely unmatched query (not an error)', async () => {
    const backend = new LiteBackend({ dbPath: buildFixtureDb() });
    const results = await backend.search({ q: 'Nirgendwo', limit: 10 });
    expect(results).toEqual([]);
  });

  it('reverse() returns the nearest candidate as a SearchResult', async () => {
    const backend = new LiteBackend({ dbPath: buildFixtureDb() });
    const results = await backend.reverse({ lat: 47.1411, lon: 9.5214, limit: 1 });
    expect(results[0]?.name).toBe('Vaduz');
    expect(results[0]?.source).toBe('lite');
  });

  it('throws a typed GeocoderBackendError when the index file does not exist ("not built yet")', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lite-backend-missing-'));
    const missingPath = join(tmpDir, 'does-not-exist.db');
    const backend = new LiteBackend({ dbPath: missingPath });

    await expect(backend.search({ q: 'Vaduz', limit: 10 })).rejects.toSatisfy((err: unknown) => {
      expect(isGeocoderBackendError(err)).toBe(true);
      return isGeocoderBackendError(err) && err.backend === 'lite' && err.code === 'UNAVAILABLE';
    });
  });

  it('reverse() also throws the same typed error when the index is missing', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lite-backend-missing-reverse-'));
    const missingPath = join(tmpDir, 'does-not-exist.db');
    const backend = new LiteBackend({ dbPath: missingPath });

    await expect(backend.reverse({ lat: 47.14, lon: 9.52, limit: 5 })).rejects.toSatisfy(
      (err: unknown) => isGeocoderBackendError(err) && err.backend === 'lite',
    );
  });
});
