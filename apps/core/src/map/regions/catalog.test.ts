import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadCatalog, resolveCatalogPath } from './catalog.js';

describe('regions catalog parsing', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    delete process.env.MAP_REGIONS_CATALOG_FILE;
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function writeCatalog(content: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), 'yapaja-catalog-'));
    tempDirs.push(dir);
    const path = join(dir, 'catalog.json');
    writeFileSync(path, JSON.stringify(content));
    process.env.MAP_REGIONS_CATALOG_FILE = path;
    return path;
  }

  it('resolveCatalogPath honors MAP_REGIONS_CATALOG_FILE when set', () => {
    const path = writeCatalog([]);
    expect(resolveCatalogPath()).toBe(path);
  });

  it('resolveCatalogPath falls back to the bundled default without the env override', () => {
    delete process.env.MAP_REGIONS_CATALOG_FILE;
    expect(resolveCatalogPath()).toMatch(/regions-catalog\.json$/);
  });

  it('parses a well-formed catalog', async () => {
    writeCatalog([
      {
        id: 'liechtenstein',
        name: 'Liechtenstein',
        url: 'http://127.0.0.1:9/liechtenstein.pmtiles',
        sizeBytes: 12345,
        bounds: [9.4716, 47.048, 9.6357, 47.2708],
      },
    ]);

    const catalog = await loadCatalog();
    expect(catalog).toHaveLength(1);
    expect(catalog[0].id).toBe('liechtenstein');
    expect(catalog[0].bounds).toEqual([9.4716, 47.048, 9.6357, 47.2708]);
  });

  it('drops entries with invalid bounds, missing fields, or unsafe ids', async () => {
    writeCatalog([
      { id: 'ok', name: 'OK', url: 'http://x/ok.pmtiles', sizeBytes: 10, bounds: [0, 0, 1, 1] },
      { id: 'bad-bounds', name: 'Bad', url: 'http://x/b.pmtiles', sizeBytes: 10, bounds: [200, 0, 1, 1] },
      { id: 'no-name', url: 'http://x/n.pmtiles', sizeBytes: 10, bounds: [0, 0, 1, 1] },
      { id: '../traversal', name: 'Evil', url: 'http://x/e.pmtiles', sizeBytes: 10, bounds: [0, 0, 1, 1] },
      { id: 'zero-size', name: 'Zero', url: 'http://x/z.pmtiles', sizeBytes: 0, bounds: [0, 0, 1, 1] },
      'not-an-object',
    ]);

    const catalog = await loadCatalog();
    expect(catalog.map((e) => e.id)).toEqual(['ok']);
  });

  // Diese beiden Tests halten fest, dass sich die BEDEUTUNG von `url`
  // geaendert hat, nicht nur eine Erwartung. Bis `feat/gui-install-path`
  // galt: kein `url` => ungueltiger Eintrag, weil ein Download die einzige
  // Bezugsquelle war. Seit klar ist, dass es keine fertigen PMTiles zum
  // Herunterladen gibt (die alten Geofabrik-`.pmtiles`-URLs waren 404),
  // ist "ohne url" der NORMALFALL: die Region wird aus dem OSM-Extrakt
  // gebaut. Ein Eintrag darf deshalb nicht mehr weggeworfen werden, nur
  // weil er keine fertige Datei nennt -- sonst verschwindet genau die
  // Region aus der GUI, die man bauen soll.
  it('keeps an entry without url -- that is a build-only region, not a defect', async () => {
    writeCatalog([
      {
        id: 'buildonly',
        name: 'Nur bauen',
        pbfUrl: 'http://x/region-latest.osm.pbf',
        sizeBytes: 10,
        bounds: [0, 0, 1, 1],
        buildEffort: 'small',
      },
    ]);

    const catalog = await loadCatalog();
    expect(catalog.map((e) => e.id)).toEqual(['buildonly']);
    expect(catalog[0].url).toBeUndefined();
    expect(catalog[0].pbfUrl).toBe('http://x/region-latest.osm.pbf');
    expect(catalog[0].buildEffort).toBe('small');
  });

  // Die Gegenprobe: "optional" heisst nicht "beliebig". Ein Eintrag, der
  // `url` oder `pbfUrl` in einer kaputten Form MITBRINGT, ist weiterhin
  // fehlerhaft und wird verworfen -- sonst wuerde die Lockerung oben
  // stillschweigend jede Quellenpruefung mit abschalten.
  it('still drops entries whose url or pbfUrl is present but malformed', async () => {
    writeCatalog([
      { id: 'ok', name: 'OK', pbfUrl: 'http://x/ok.osm.pbf', sizeBytes: 10, bounds: [0, 0, 1, 1] },
      { id: 'empty-url', name: 'Empty', url: '', sizeBytes: 10, bounds: [0, 0, 1, 1] },
      { id: 'num-url', name: 'Num', url: 42, sizeBytes: 10, bounds: [0, 0, 1, 1] },
      { id: 'empty-pbf', name: 'EmptyPbf', pbfUrl: '', sizeBytes: 10, bounds: [0, 0, 1, 1] },
      { id: 'null-pbf', name: 'NullPbf', pbfUrl: null, sizeBytes: 10, bounds: [0, 0, 1, 1] },
      {
        id: 'bad-effort',
        name: 'BadEffort',
        pbfUrl: 'http://x/e.osm.pbf',
        sizeBytes: 10,
        bounds: [0, 0, 1, 1],
        buildEffort: 'gigantic',
      },
    ]);

    const catalog = await loadCatalog();
    expect(catalog.map((e) => e.id)).toEqual(['ok']);
  });

  it('accepts an optional sha256 field', async () => {
    writeCatalog([
      {
        id: 'withhash',
        name: 'WithHash',
        url: 'http://x/withhash.pmtiles',
        sizeBytes: 10,
        bounds: [0, 0, 1, 1],
        sha256: 'abc123',
      },
    ]);
    const catalog = await loadCatalog();
    expect(catalog[0].sha256).toBe('abc123');
  });

  it('rejects a catalog file that is not a JSON array', async () => {
    writeCatalog({ not: 'an array' });
    await expect(loadCatalog()).rejects.toThrow(/must be a JSON array/);
  });

  it('loads the real bundled default catalog with plausible WGS84 bounds', async () => {
    delete process.env.MAP_REGIONS_CATALOG_FILE;
    const catalog = await loadCatalog();
    expect(catalog.length).toBeGreaterThan(0);
    for (const entry of catalog) {
      const [minLon, minLat, maxLon, maxLat] = entry.bounds;
      expect(minLon).toBeGreaterThanOrEqual(-180);
      expect(maxLon).toBeLessThanOrEqual(180);
      expect(minLat).toBeGreaterThanOrEqual(-90);
      expect(maxLat).toBeLessThanOrEqual(90);
      expect(entry.sizeBytes).toBeGreaterThan(0);
      // Jeder ausgelieferte Eintrag muss MINDESTENS EINEN Bezugsweg nennen.
      // Genau das fehlte vorher nicht -- es war schlimmer: die Eintraege
      // nannten einen Weg, den es nicht gab. `isValidCatalogEntry` allein
      // faengt das nicht, weil beide Felder optional sind; ein Eintrag ohne
      // beides waere formal gueltig und in der GUI eine Sackgasse.
      expect(
        entry.url ?? entry.pbfUrl,
        `Katalogeintrag "${entry.id}" nennt weder url noch pbfUrl`,
      ).toBeTruthy();
    }
  });
});
