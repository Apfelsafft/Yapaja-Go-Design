/**
 * Sonderziele im Offline-Index — mit dem Fehler, der sie beinahe unsichtbar
 * gemacht hätte.
 *
 * Der Betreiber hat gefragt: „Ich würde gerne in wahlfreier Reihenfolge Stadt
 * oder Straße oder einen poi wie einen Supermarkt, Campingplatz, Arzt oder
 * Ähnliches eingeben können." Der Kern daran: „Supermarkt" ist eine
 * KATEGORIE, der Laden heißt in den Daten „REWE". Beide Wege müssen auf
 * denselben Eintrag führen.
 *
 * ─── UND DER FEHLER, DEN DIESE DATEI FESTHÄLT ───────────────────────────────
 * Beim Einbau standen die Arten (`city`, `street`, …) an DREI Stellen: als
 * Typ in `ranking.ts`, als Typ in `extract.ts` und als Laufzeit-Menge
 * `KNOWN_KINDS` in `reader.ts`. Ich habe die ersten beiden gepflegt und die
 * dritte übersehen.
 *
 * Das Ergebnis war das denkbar leiseste: die Sonderziele standen korrekt im
 * Index, die Volltextsuche FAND sie (direkt gegen SQLite nachgewiesen: zwei
 * Treffer für „Supermarkt"), und `reader.ts` warf sie danach beim
 * Arten-Filter weg. Die Suche antwortete „nichts" — ohne Fehler, ohne
 * Hinweis, ohne Anhaltspunkt.
 *
 * Aufgefallen ist es nur, weil die Kette nach dem Einbau tatsächlich
 * abgefragt wurde statt angenommen, sie funktioniere. Die Arten kommen jetzt
 * aus einer Liste (`LITE_KINDS`); dieser Test hält fest, dass jede davon auch
 * wirklich durch den Filter kommt.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeGeoJsonSeqLine } from './extract';
import { buildLiteIndexFile } from './buildIndex';
import { LiteIndexReader } from './reader';
import { LITE_KINDS } from './ranking';
import { findPoiCategory, osmiumFilters, POI_CATEGORIES } from './poiCategories';

function feature(properties: Record<string, unknown>, lon = 8.46, lat = 49.48): string {
  return JSON.stringify({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties,
  });
}

describe('POI-Kategorien', () => {
  it('findet eine geführte Kategorie und lehnt eine nicht geführte ab', () => {
    expect(findPoiCategory('shop', 'supermarket')?.label).toBe('Supermarkt');
    expect(findPoiCategory('tourism', 'camp_site')?.label).toBe('Campingplatz');
    // Eine Parkbank ist kein Ziel, das jemand ansteuert.
    expect(findPoiCategory('amenity', 'bench')).toBeUndefined();
    expect(findPoiCategory('shop', 'gibt_es_nicht')).toBeUndefined();
  });

  /** Dieselbe Liste erzeugt den osmium-Filter und die Suchbegriffe. Liefen sie
   *  auseinander, filterte osmium Daten heraus, die niemand einordnet — oder
   *  der Normalisierer wartete auf Daten, die nie kommen. */
  it('der osmium-Filter deckt genau die geführten Kategorien ab', () => {
    const filters = osmiumFilters();
    expect(filters.length).toBe(Object.keys(POI_CATEGORIES).length);

    for (const [key, categories] of Object.entries(POI_CATEGORIES)) {
      const line = filters.find((f) => f.startsWith(`nwr/${key}=`));
      expect(line, `kein Filter fuer ${key}`).toBeDefined();
      for (const category of categories) {
        expect(line).toContain(category.value);
      }
    }

    // `nwr`, nicht `n`: ein Supermarkt ist meist ein Gebäude, ein
    // Campingplatz fast immer. Nur Knoten zu filtern verlöre die Mehrzahl
    // der interessanten Ziele — und zwar lautlos.
    for (const line of filters) {
      expect(line.startsWith('nwr/'), `"${line}" filtert nicht ueber nwr/`).toBe(true);
    }
  });
});

describe('POI-Normalisierung', () => {
  it('übernimmt einen benannten Supermarkt mit Kategorie und Suchbegriffen', () => {
    const record = normalizeGeoJsonSeqLine(feature({ shop: 'supermarket', name: 'REWE' }), 'poi');
    expect(record).not.toBeNull();
    expect(record?.kind).toBe('poi');
    expect(record?.name).toBe('REWE');
    expect(record?.category).toBe('supermarket');
    expect(record?.searchTerms).toContain('Supermarkt');
    expect(record?.searchTerms).toContain('lebensmittel');
  });

  /** Ein Campingplatz ohne `name` ist immer noch ein Campingplatz. Ihn
   *  wegzulassen wäre der größere Verlust — und er behauptet keinen Namen,
   *  den es nicht gibt: er heißt schlicht nach seiner Art. */
  it('nimmt ein unbenanntes Sonderziel unter seiner Kategoriebezeichnung auf', () => {
    const record = normalizeGeoJsonSeqLine(feature({ tourism: 'camp_site' }), 'poi');
    expect(record?.name).toBe('Campingplatz');
    expect(record?.category).toBe('camp_site');
  });

  it('verwirft eine nicht geführte Kategorie', () => {
    expect(normalizeGeoJsonSeqLine(feature({ amenity: 'bench', name: 'Bank am Weg' }), 'poi')).toBeNull();
  });

  it('verwirft ein Sonderziel ohne brauchbare Geometrie', () => {
    const broken = JSON.stringify({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [] },
      properties: { amenity: 'fuel' },
    });
    expect(normalizeGeoJsonSeqLine(broken, 'poi')).toBeNull();
  });

  /** Ein Supermarkt ist meistens eine Fläche, kein Punkt. */
  it('reduziert eine Fläche auf ihren Zentroid', () => {
    const area = JSON.stringify({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[8.0, 49.0], [8.2, 49.0], [8.2, 49.2], [8.0, 49.2]]],
      },
      properties: { shop: 'supermarket', name: 'Grosser Markt' },
    });
    const record = normalizeGeoJsonSeqLine(area, 'poi');
    expect(record?.lat).toBeCloseTo(49.1, 1);
    expect(record?.lon).toBeCloseTo(8.1, 1);
  });
});

describe('Suche im gebauten Index', () => {
  function buildIndex(): { dbPath: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), 'yapaja-poi-'));
    const dbPath = join(dir, 'lite_search.db');
    const lines = [
      feature({ place: 'city', name: 'Mannheim' }),
      feature({ shop: 'supermarket', name: 'REWE' }),
      feature({ tourism: 'camp_site' }),
      feature({ amenity: 'doctors', name: 'Dr. Müller' }),
      feature({ amenity: 'fuel', name: 'Aral' }),
    ];
    const records = [
      normalizeGeoJsonSeqLine(lines[0], 'place'),
      ...lines.slice(1).map((l) => normalizeGeoJsonSeqLine(l, 'poi')),
    ].filter((r): r is NonNullable<typeof r> => r !== null);
    expect(records.length, 'Vorbedingung: alle Testdaten wurden uebernommen').toBe(5);

    buildLiteIndexFile(records, dbPath);
    return { dbPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  // ─── DER GEMELDETE WUNSCH, GEGEN DEN ECHTEN INDEX ─────────────────────────
  it('findet ein Sonderziel sowohl über die Kategorie als auch über den Namen', () => {
    const { dbPath, cleanup } = buildIndex();
    try {
      const reader = new LiteIndexReader(dbPath);

      const byCategory = reader.searchByPrefix('Supermarkt', 5);
      expect(byCategory.map((r) => r.name)).toContain('REWE');

      const byName = reader.searchByPrefix('REWE', 5);
      expect(byName.map((r) => r.name)).toContain('REWE');

      // Und die Kategorie kommt mit -- sie waehlt spaeter das Symbol.
      expect(byName[0]?.category).toBe('supermarket');
    } finally {
      cleanup();
    }
  });

  it('findet den unbenannten Campingplatz unter „Campingplatz"', () => {
    const { dbPath, cleanup } = buildIndex();
    try {
      const reader = new LiteIndexReader(dbPath);
      expect(reader.searchByPrefix('Campingplatz', 5).map((r) => r.category)).toContain('camp_site');
    } finally {
      cleanup();
    }
  });

  it('findet den Arzt unter „Arzt", obwohl die Praxis „Dr. Müller" heißt', () => {
    const { dbPath, cleanup } = buildIndex();
    try {
      const reader = new LiteIndexReader(dbPath);
      const hits = reader.searchByPrefix('Arzt', 5);
      expect(hits.map((r) => r.name)).toContain('Dr. Müller');
    } finally {
      cleanup();
    }
  });

  /** Orte und Straßen dürfen sich durch die Erweiterung NICHT verändert
   *  haben — die Suche, die vorher funktionierte, muss weiter funktionieren. */
  it('lässt die Ortssuche unberührt', () => {
    const { dbPath, cleanup } = buildIndex();
    try {
      const reader = new LiteIndexReader(dbPath);
      expect(reader.searchByPrefix('Mannheim', 5).map((r) => r.kind)).toContain('city');
    } finally {
      cleanup();
    }
  });

  /**
   * ─── DER EIGENTLICHE REGRESSIONSTEST ──────────────────────────────────────
   * `reader.ts` filtert Zeilen mit unbekannter Art heraus. Als `poi` dort
   * fehlte, verschwand JEDES Sonderziel aus jedem Ergebnis — lautlos, obwohl
   * Index und Volltextsuche in Ordnung waren. Dieser Test prüft die Regel
   * statt eines Einzelfalls: jede Art aus `LITE_KINDS` muss durch den Filter
   * kommen.
   */
  it('lässt jede in LITE_KINDS geführte Art durch den Arten-Filter', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yapaja-kinds-'));
    const dbPath = join(dir, 'lite_search.db');
    try {
      buildLiteIndexFile(
        LITE_KINDS.map((kind, i) => ({
          kind,
          name: `Testeintrag ${kind}`,
          lat: 49 + i * 0.01,
          lon: 8 + i * 0.01,
        })),
        dbPath,
      );

      const reader = new LiteIndexReader(dbPath);
      const found = reader.searchByPrefix('Testeintrag', 50).map((r) => r.kind);
      for (const kind of LITE_KINDS) {
        expect(
          found,
          `Art "${kind}" wird von reader.ts weggefiltert — Treffer dieser Art ` +
            'verschwinden dann lautlos aus jedem Suchergebnis.',
        ).toContain(kind);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
