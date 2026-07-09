import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync } from 'fs';
import { Buffer } from 'node:buffer';
import { tmpdir } from 'os';
import { join } from 'path';
import { listRegions } from './regions.js';
import { createFixtureTilesDir, FIXTURE_BOUNDS } from './__fixtures__/pmtiles-fixture.js';

describe('listRegions', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('returns an empty list when tilesDir does not exist', async () => {
    const missingDir = join(tmpdir(), 'yapaja-does-not-exist-' + Date.now());
    const warnings: unknown[] = [];
    const regions = await listRegions(missingDir, { warn: (o) => warnings.push(o) });
    expect(regions).toEqual([]);
  });

  it('parses fixture region metadata with plausible WGS84 bounds', async () => {
    const fixture = createFixtureTilesDir({ germany: {} });
    cleanup = fixture.cleanup;

    const warnings: unknown[] = [];
    const regions = await listRegions(fixture.dir, { warn: (o) => warnings.push(o) });

    expect(regions).toHaveLength(1);
    const region = regions[0];
    expect(region.region).toBe('germany');
    expect(region.file).toBe('germany.pmtiles');
    expect(region.size_bytes).toBeGreaterThan(0);
    expect(region.minzoom).toBe(0);
    expect(region.maxzoom).toBe(14);
    expect(region.tile_type).toBe('mvt');
    expect(region.compression).toBe('gzip');

    const [minLon, minLat, maxLon, maxLat] = region.bounds;
    expect(minLon).toBeCloseTo(FIXTURE_BOUNDS.minLon, 5);
    expect(minLat).toBeCloseTo(FIXTURE_BOUNDS.minLat, 5);
    expect(maxLon).toBeCloseTo(FIXTURE_BOUNDS.maxLon, 5);
    expect(maxLat).toBeCloseTo(FIXTURE_BOUNDS.maxLat, 5);

    // WGS84 plausibility
    expect(minLon).toBeGreaterThanOrEqual(-180);
    expect(maxLon).toBeLessThanOrEqual(180);
    expect(minLat).toBeGreaterThanOrEqual(-90);
    expect(maxLat).toBeLessThanOrEqual(90);
  });

  it('lists multiple regions sorted by name', async () => {
    const fixture = createFixtureTilesDir({ zurich: {}, austria: {} });
    cleanup = fixture.cleanup;

    const regions = await listRegions(fixture.dir, { warn: () => {} });
    expect(regions.map((r) => r.region)).toEqual(['austria', 'zurich']);
  });

  it('skips a corrupt .pmtiles file with a warning instead of crashing', async () => {
    const fixture = createFixtureTilesDir({ good: {} });
    cleanup = fixture.cleanup;
    writeFileSync(join(fixture.dir, 'broken.pmtiles'), Buffer.from('not a pmtiles file'));

    const warnings: unknown[] = [];
    const regions = await listRegions(fixture.dir, { warn: (o) => warnings.push(o) });

    expect(regions.map((r) => r.region)).toEqual(['good']);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });

  it('skips an empty .pmtiles file with a warning instead of crashing', async () => {
    const fixture = createFixtureTilesDir({ good: {} });
    cleanup = fixture.cleanup;
    writeFileSync(join(fixture.dir, 'empty.pmtiles'), Buffer.alloc(0));

    const warnings: unknown[] = [];
    const regions = await listRegions(fixture.dir, { warn: (o) => warnings.push(o) });

    expect(regions.map((r) => r.region)).toEqual(['good']);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });

  it('skips non-.pmtiles files silently', async () => {
    const fixture = createFixtureTilesDir({ good: {} });
    cleanup = fixture.cleanup;
    writeFileSync(join(fixture.dir, 'readme.txt'), 'hello');

    const regions = await listRegions(fixture.dir, { warn: () => {} });
    expect(regions.map((r) => r.region)).toEqual(['good']);
  });
});
