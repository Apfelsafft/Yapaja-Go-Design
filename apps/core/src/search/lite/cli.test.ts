/**
 * `cli.ts` tests (E05-T5, W-12): the glue between `osmium export`'s
 * GeoJSONSeq output and `buildLiteIndexFile`, including the atomic
 * temp-file-then-rename swap (`build-lite-index.sh`'s Node half; the shell
 * half that runs `osmium` itself is CI-only-verified, see the new
 * `lite-search-li-build` CI job -- this test fixture stands in for what
 * `osmium export --geometry-types=point -f geojsonseq` would produce).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { runCli } from './cli.js';

function point(lon: number, lat: number): unknown {
  return { type: 'Point', coordinates: [lon, lat] };
}

describe('runCli', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeGeoJsonSeq(path: string, features: unknown[]): void {
    writeFileSync(path, features.map((f) => JSON.stringify(f)).join('\n') + '\n', 'utf8');
  }

  it('builds a queryable lite_search.db from places + streets GeoJSONSeq fixtures', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lite-cli-test-'));
    const placesPath = join(tmpDir, 'places.geojsonseq');
    const streetsPath = join(tmpDir, 'streets.geojsonseq');
    const outPath = join(tmpDir, 'lite_search.db');

    writeGeoJsonSeq(placesPath, [
      { geometry: point(9.5215, 47.141), properties: { place: 'city', name: 'Vaduz' } },
      { geometry: point(9.5091, 47.166), properties: { place: 'town', name: 'Schaan' } },
      // A place kind this index doesn't index -- must be skipped, not crash the build.
      { geometry: point(9.5, 47.1), properties: { place: 'hamlet', name: 'Irrelevant' } },
    ]);
    writeGeoJsonSeq(streetsPath, [
      { geometry: point(9.522, 47.142), properties: { highway: 'residential', name: 'Vaduzer Straße' } },
      // Unnamed way -- must be skipped.
      { geometry: point(9.5, 47.1), properties: { highway: 'residential' } },
    ]);

    await runCli(['--places', placesPath, '--streets', streetsPath, '--out', outPath]);

    expect(existsSync(outPath)).toBe(true);
    // No leftover temp file after a successful swap.
    const leftovers = readdirSync(tmpDir).filter((f) => f.includes('.tmp-'));
    expect(leftovers).toEqual([]);

    const db = new Database(outPath, { readonly: true });
    try {
      const names = db.prepare('SELECT name FROM places ORDER BY name').all() as { name: string }[];
      expect(names.map((r) => r.name)).toEqual(['Schaan', 'Vaduz', 'Vaduzer Straße']);

      const vaduzHit = db
        .prepare(
          `SELECT p.name FROM lite_search JOIN places p ON p.id = lite_search.rowid WHERE lite_search MATCH ?`,
        )
        .all('"Vadu"') as { name: string }[];
      expect(vaduzHit.map((r) => r.name).sort()).toEqual(['Vaduz', 'Vaduzer Straße']);
    } finally {
      db.close();
    }
  });

  it('places-only input (no --streets) still builds a valid index', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lite-cli-test-places-only-'));
    const placesPath = join(tmpDir, 'places.geojsonseq');
    const outPath = join(tmpDir, 'lite_search.db');
    writeGeoJsonSeq(placesPath, [
      { geometry: point(9.5215, 47.141), properties: { place: 'city', name: 'Vaduz' } },
    ]);

    await runCli(['--places', placesPath, '--out', outPath]);

    expect(existsSync(outPath)).toBe(true);
  });

  it('rejects (throws) when neither input yields any usable record', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lite-cli-test-empty-'));
    const placesPath = join(tmpDir, 'places.geojsonseq');
    const outPath = join(tmpDir, 'lite_search.db');
    writeGeoJsonSeq(placesPath, [{ geometry: point(9.5, 47.1), properties: { place: 'hamlet', name: 'X' } }]);

    await expect(runCli(['--places', placesPath, '--out', outPath])).rejects.toThrow(/Keine Datensaetze/);
    expect(existsSync(outPath)).toBe(false);
  });

  it('throws a clear usage error when --out is missing', async () => {
    await expect(runCli(['--places', 'x.geojsonseq'])).rejects.toThrow(/Usage/);
  });

  it('replaces an existing lite_search.db atomically (rebuild scenario)', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lite-cli-test-rebuild-'));
    const placesPath = join(tmpDir, 'places.geojsonseq');
    const outPath = join(tmpDir, 'lite_search.db');

    writeGeoJsonSeq(placesPath, [
      { geometry: point(9.5215, 47.141), properties: { place: 'city', name: 'Vaduz' } },
    ]);
    await runCli(['--places', placesPath, '--out', outPath]);

    writeGeoJsonSeq(placesPath, [
      { geometry: point(9.5091, 47.166), properties: { place: 'town', name: 'Schaan' } },
    ]);
    await runCli(['--places', placesPath, '--out', outPath]);

    const db = new Database(outPath, { readonly: true });
    try {
      const names = db.prepare('SELECT name FROM places').all() as { name: string }[];
      // Fully replaced, not merged/appended -- exactly one row, the new one.
      expect(names).toEqual([{ name: 'Schaan' }]);
    } finally {
      db.close();
    }
  });
});
