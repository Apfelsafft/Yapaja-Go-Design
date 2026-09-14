import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { isValidCatalogEntry, loadCatalog, resolveCatalogPath } from './catalog.js';

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

/**
 * ─── DER AUSGELIEFERTE KATALOG SELBST ───────────────────────────────────────
 * Seit 0.8.5 stehen 49 europäische Länder darin. Die Adressen prüft der
 * wöchentliche Nightly gegen Geofabrik (`scripts/check-region-catalog.mjs`) —
 * hier geht es um das, was ohne Netz prüfbar ist und sonst still verrutscht.
 */
describe('regions-catalog.json — der ausgelieferte Katalog', () => {
  const eintraege = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'regions-catalog.json'), 'utf-8'),
  ) as Array<Record<string, unknown>>;

  it('jeder Eintrag ist gültig', () => {
    // Dieselbe Prüfung, die der Core beim Laden anwendet. Ein ungültiger
    // Eintrag verschwindet dort stillschweigend aus der Liste — der Betreiber
    // sähe nur ein Land, das nicht da ist.
    for (const eintrag of eintraege) {
      expect(isValidCatalogEntry(eintrag), `ungültig: ${String(eintrag.id)}`).toBe(true);
    }
  });

  it('die IDs sind eindeutig und taugen als Verzeichnisname', () => {
    // Die ID wird zum Ordner unter /share/yapaja/tiles. Ein Punkt oder
    // Schrägstrich darin wäre ein Pfad, kein Name.
    const ids = eintraege.map((e) => String(e.id));
    expect(new Set(ids).size, 'doppelte ID').toBe(ids.length);
    for (const id of ids) {
      expect(id, `ID taugt nicht als Verzeichnisname: ${id}`).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
  });

  it('jede pbfUrl folgt dem Geofabrik-Muster', () => {
    // Genau hier ist der Katalog schon einmal gescheitert: an einer
    // funktionierenden Adresse wurde die Endung getauscht, und heraus kam ein
    // sicherer 404. Die Form lässt sich ohne Netz prüfen, die Existenz nicht.
    for (const eintrag of eintraege) {
      const url = eintrag.pbfUrl as string | undefined;
      if (url === undefined) continue;
      expect(url, `${String(eintrag.id)}: keine .osm.pbf`).toMatch(
        /^https:\/\/download\.geofabrik\.de\/[a-z-]+(\/[a-z-]+)*\/[a-z-]+-latest\.osm\.pbf$/,
      );
      // Der Dateiname muss zur ID passen -- sonst baut man unter dem Namen
      // „austria" die Kacheln der Schweiz.
      expect(url, `${String(eintrag.id)}: Dateiname passt nicht zur ID`).toContain(
        `/${String(eintrag.id)}-latest.osm.pbf`,
      );
    }
  });

  it('die Grenzen sind plausibel und nicht entartet', () => {
    for (const eintrag of eintraege) {
      const [minLon, minLat, maxLon, maxLat] = eintrag.bounds as number[];
      expect(minLon, `${String(eintrag.id)}`).toBeLessThan(maxLon);
      expect(minLat, `${String(eintrag.id)}`).toBeLessThan(maxLat);
      expect(Math.abs(minLon)).toBeLessThanOrEqual(180);
      expect(Math.abs(maxLat)).toBeLessThanOrEqual(90);
    }
  });

  it('große Extrakte sind als solche markiert', () => {
    // `buildEffort` steuert, ob die GUI zum Bauen auf der HAOS-VM rät. Ein
    // falsch als „klein" markiertes Land ist ein Bauauftrag, der die VM
    // stundenlang belegt und dann am Speicher scheitert.
    for (const eintrag of eintraege) {
      const mb = (eintrag.sizeBytes as number) / 1_000_000;
      if (mb >= 1000) {
        expect(eintrag.buildEffort, `${String(eintrag.id)} (${mb} MB)`).toBe('large');
      }
    }
  });

  it('enthält die Nachbarländer Deutschlands', () => {
    // Der ausdrückliche Wunsch: „Wichtig wären bspw. Auch Schweiz, Österreich,
    // Frankreich bzw. Die an Deutschland angrenzenden Länder."
    const ids = new Set(eintraege.map((e) => String(e.id)));
    for (const nachbar of [
      'austria', 'switzerland', 'france', 'netherlands', 'belgium',
      'luxembourg', 'denmark', 'poland', 'czech-republic',
    ]) {
      expect(ids, `Nachbarland fehlt: ${nachbar}`).toContain(nachbar);
    }
  });
});
