/**
 * E05-T5 mandatory test (b): "the FTS5 index build + query + ranking
 * against a small in-code/JSON fixture dataset" -- this is the REAL thing,
 * not a mock: `buildLiteIndexFile` runs against this repo's actual pinned
 * `better-sqlite3` on a real temp file, `LiteIndexReader` queries it via
 * genuine FTS5 `MATCH` with the `trigram` tokenizer, and the raw rows are
 * fed through the already-unit-tested `rankLiteCandidates` to prove the
 * whole pipeline together produces the mandated ordering.
 *
 * This directly exercises the orchestrator's verified feasibility finding
 * ("FTS5 with the trigram tokenizer WORKS natively in this repo's pinned
 * better-sqlite3") against the ACTUAL schema this task ships (external-
 * content FTS5 table + companion metadata table), not just the throwaway
 * spike schema.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { NormalizedRecord } from './extract.js';
import { buildLiteIndexFile } from './buildIndex.js';
import { LiteIndexReader } from './reader.js';
import { rankLiteCandidates } from './ranking.js';

const FIXTURE: NormalizedRecord[] = [
  { kind: 'city', name: 'Vaduz', lat: 47.141, lon: 9.5215, population: 5696 },
  { kind: 'town', name: 'Schaan', lat: 47.166, lon: 9.5091 },
  { kind: 'village', name: 'Triesenberg', lat: 47.115, lon: 9.5314 },
  { kind: 'street', name: 'Vaduzer Straße', lat: 47.142, lon: 9.522 },
  { kind: 'street', name: 'Bahnhofstrasse', lat: 47.14, lon: 9.52 },
  { kind: 'city', name: 'Balzers', lat: 47.068, lon: 9.5024 },
];

describe('buildLiteIndexFile + LiteIndexReader (real SQLite FTS5, trigram)', () => {
  let tmpDir: string;
  let dbPath: string;
  let reader: LiteIndexReader | undefined;

  afterEach(() => {
    reader?.close();
    reader = undefined;
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  function buildFixture(records: NormalizedRecord[] = FIXTURE): LiteIndexReader {
    tmpDir = mkdtempSync(join(tmpdir(), 'lite-search-test-'));
    dbPath = join(tmpDir, `lite_search-${randomUUID()}.db`);
    buildLiteIndexFile(records, dbPath);
    reader = new LiteIndexReader(dbPath);
    return reader;
  }

  it('builds a queryable db file on disk', () => {
    buildFixture();
    expect(existsSync(dbPath)).toBe(true);
  });

  it('MANDATORY end-to-end: query "Vadu" finds Vaduz (city) ranked above Vaduzer Straße (street)', () => {
    const r = buildFixture();
    const raw = r.searchByPrefix('Vadu', 10);
    // Sanity: FTS5 trigram actually found both (proves the tokenizer/MATCH
    // pipeline works against this exact schema, not just the spike schema).
    expect(raw.map((c) => c.name).sort()).toEqual(['Vaduz', 'Vaduzer Straße']);

    const ranked = rankLiteCandidates(raw, 'Vadu');
    expect(ranked[0].name).toBe('Vaduz');
    expect(ranked[0].kind).toBe('city');
    expect(ranked[1].name).toBe('Vaduzer Straße');
  });

  it('trigram tolerance: an infix substring (not just a prefix) still matches', () => {
    const r = buildFixture();
    // "adu" is a substring of "Vaduz"/"Vaduzer" but not a prefix of either --
    // proves this is genuinely trigram substring matching, not a LIKE 'x%'.
    const raw = r.searchByPrefix('adu', 10);
    expect(raw.map((c) => c.name).sort()).toEqual(['Vaduz', 'Vaduzer Straße']);
  });

  it('a query with no matches returns an empty array, not an error', () => {
    const r = buildFixture();
    expect(r.searchByPrefix('xyzzyplugh', 10)).toEqual([]);
  });

  it('queries shorter than 3 chars return [] without ever touching FTS5 (trigram floor)', () => {
    const r = buildFixture();
    expect(r.searchByPrefix('va', 10)).toEqual([]);
    expect(r.searchByPrefix('', 10)).toEqual([]);
  });

  it('does not throw on FTS5-syntax-special characters in the query (escaped as a literal phrase)', () => {
    const r = buildFixture();
    expect(() => r.searchByPrefix('Vad" OR *', 10)).not.toThrow();
    expect(() => r.searchByPrefix('AND NOT foo', 10)).not.toThrow();
  });

  it('nearest() finds the closest place to a given point', () => {
    const r = buildFixture();
    // Very close to Vaduz's centroid.
    const nearest = r.nearest(47.1405, 9.5214, 1);
    expect(nearest[0]?.name).toBe('Vaduz');
  });

  it('nearest() returns [] far outside the fixture bounding box', () => {
    const r = buildFixture();
    expect(r.nearest(10, 10, 5)).toEqual([]);
  });

  it('carries population through as a raw rank input (currently unused by ranking, captured for later)', () => {
    const r = buildFixture();
    // population isn't exposed on LiteCandidate today (see extract.ts's doc
    // comment) -- this test just proves the build/insert step doesn't choke
    // on it and the row is still findable.
    const raw = r.searchByPrefix('Vaduz', 10);
    expect(raw.some((c) => c.name === 'Vaduz')).toBe(true);
  });

  it('an empty fixture still produces a valid (just empty) index', () => {
    const r = buildFixture([]);
    expect(r.searchByPrefix('Vaduz', 10)).toEqual([]);
  });
});
