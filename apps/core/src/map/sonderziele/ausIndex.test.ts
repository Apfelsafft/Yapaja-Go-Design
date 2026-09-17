/**
 * Die Entsorgungsstation kommt auf die Karte — gegen einen ECHTEN Index.
 *
 * ─── WARUM KEIN NACHGEBAUTER LESER ──────────────────────────────────────────
 * Die Behauptung dieser Änderung lautet: die Daten liegen längst in
 * `lite_search-<region>.db`, es fehlt nur der Weg dorthin. Ein nachgebauter
 * Leser würde genau diese Behauptung voraussetzen, statt sie zu prüfen — er
 * bestätigte nur, dass meine Vorstellung vom Index zu meiner Abfrage passt.
 *
 * Deshalb baut jeder Test hier eine richtige SQLite-Datei mit
 * `buildLiteIndexFile` — demselben Werkzeug, das auch im Betrieb baut — und
 * liest sie mit demselben `LiteIndexReader`, den die Suche benutzt. Wenn
 * Schema und Abfrage je auseinanderlaufen, wird es hier rot.
 *
 * Das ist die Lehre aus dem ESP32: eine Prüfumgebung, die eine Annahme
 * nachbildet, prüft die Annahme und nicht die Sache.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { NormalizedRecord } from '../../search/lite/extract.js';
import { buildLiteIndexFile } from '../../search/lite/buildIndex.js';
import { liteSearchDbPathForRegion } from '../../search/lite/paths.js';
import {
  leseSonderziele,
  alsGeoJson,
  SONDERZIELE_HOECHSTENS_JE_INDEX,
} from './ausIndex.js';
import { FEHLENDE_KLASSEN, klasseFuer } from './fehlendeKlassen.js';
import { POI_CATEGORIES } from '../../search/lite/poiCategories.js';

const verzeichnisse: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yapaia-sonderziele-'));
  verzeichnisse.push(dir);
  return dir;
}

afterEach(() => {
  while (verzeichnisse.length > 0) {
    rmSync(verzeichnisse.pop() as string, { recursive: true, force: true });
  }
});

function poi(name: string, category: string, lat: number, lon: number): NormalizedRecord {
  return { kind: 'poi', name, lat, lon, category };
}

function indexMit(dir: string, region: string, records: NormalizedRecord[]): string {
  const pfad = liteSearchDbPathForRegion(dir, region);
  buildLiteIndexFile(records, pfad, { region });
  return pfad;
}

describe('leseSonderziele — die Lücke, die die Kacheln lassen', () => {
  it('findet die Entsorgungsstation, die in keiner Kachel stehen kann', () => {
    const dir = tempDir();
    const pfad = indexMit(dir, 'rheinland-pfalz', [
      poi('Wohnmobilhafen Germersheim', 'sanitary_dump_station', 49.22, 8.36),
      poi('REWE', 'grocery', 49.23, 8.37),
    ]);

    const { ziele } = leseSonderziele([pfad]);

    expect(ziele).toHaveLength(1);
    expect(ziele[0]).toMatchObject({
      name: 'Wohnmobilhafen Germersheim',
      kategorie: 'sanitary_dump_station',
      bezeichnung: 'Entsorgungsstation',
      symbol: 'poi-entsorgung',
      lat: 49.22,
      lon: 8.36,
    });
  });

  it('lässt alles liegen, was die Kacheln selbst führen', () => {
    // Sonst läge jedes Symbol doppelt übereinander — einmal aus der Kachel,
    // einmal von hier — und die Kollisionsrechnung von MapLibre bekäme
    // Gegner, die dasselbe sind.
    const dir = tempDir();
    const pfad = indexMit(dir, 'li', [
      poi('Aral', 'fuel', 47.14, 9.52),
      poi('Camping Mittagsspitze', 'camp_site', 47.15, 9.53),
      poi('Trinkbrunnen', 'drinking_water', 47.16, 9.54),
    ]);

    expect(leseSonderziele([pfad]).ziele).toEqual([]);
  });

  it('liest aus allen installierten Regionen gleichzeitig', () => {
    const dir = tempDir();
    const a = indexMit(dir, 'rheinland-pfalz', [
      poi('Stellplatz Speyer', 'sanitary_dump_station', 49.32, 8.43),
    ]);
    const b = indexMit(dir, 'elsass', [
      poi('Aire de Colmar', 'sanitary_dump_station', 48.08, 7.36),
    ]);

    const { ziele, indizes } = leseSonderziele([a, b]);

    expect(ziele.map((z) => z.name).sort()).toEqual(['Aire de Colmar', 'Stellplatz Speyer']);
    expect(indizes.map((i) => i.region).sort()).toEqual(['elsass', 'rheinland-pfalz']);
    expect(indizes.every((i) => i.anzahl === 1)).toBe(true);
  });

  it('nimmt Adresse und Ort mit, wenn sie in den Daten stehen', () => {
    // Bei „Entsorgungsstation" ohne weitere Angabe bringt die Tippkarte
    // nichts, was man nicht schon sieht.
    const dir = tempDir();
    const pfad = indexMit(dir, 'rp', [
      {
        kind: 'poi',
        name: 'Ver- und Entsorgung',
        lat: 49.22,
        lon: 8.36,
        category: 'sanitary_dump_station',
        address: 'Hafenstraße 12',
        locality: 'Germersheim',
      },
    ]);

    expect(leseSonderziele([pfad]).ziele[0]).toMatchObject({
      adresse: 'Hafenstraße 12',
      ort: 'Germersheim',
    });
  });
});

describe('leseSonderziele — was nicht ging, steht in der Antwort', () => {
  it('meldet einen unlesbaren Index, ohne die anderen mitzunehmen', () => {
    // Der Fall aus dem Betrieb: Deutschland wird gerade neu gebaut,
    // Frankreich liegt fertig daneben. Frankreich soll zu sehen sein.
    const dir = tempDir();
    const gut = indexMit(dir, 'elsass', [
      poi('Aire de Colmar', 'sanitary_dump_station', 48.08, 7.36),
    ]);
    const kaputt = join(dir, 'lite_search-deutschland.db');
    writeFileSync(kaputt, 'das ist keine SQLite-Datei');

    const { ziele, indizes } = leseSonderziele([kaputt, gut]);

    expect(ziele.map((z) => z.name)).toEqual(['Aire de Colmar']);
    const schlecht = indizes.find((i) => i.region === 'deutschland');
    expect(schlecht?.anzahl).toBe(0);
    expect(schlecht?.fehler, 'ein kaputter Index verschwindet stillschweigend').toBeTruthy();
  });

  it('ein Index ohne Spalte `category` liefert nichts — und wirft nicht', () => {
    // Indizes von vor 0.3.6 haben die Spalte nicht. Genau dieser Fall hat
    // schon einmal die gesamte Suche totgelegt („no such column: p.category"),
    // und die Oberfläche meldete „Nichts gefunden".
    const dir = tempDir();
    const pfad = join(dir, 'lite_search-alt.db');
    const db = new Database(pfad);
    db.exec(`
      CREATE TABLE places (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        population INTEGER,
        search_text TEXT NOT NULL
      );
      INSERT INTO places (name, kind, lat, lon, search_text)
        VALUES ('Germersheim', 'town', 49.22, 8.36, 'Germersheim');
    `);
    db.close();

    const ergebnis = leseSonderziele([pfad]);

    expect(ergebnis.ziele).toEqual([]);
    expect(ergebnis.indizes[0]?.fehler, 'ein alter Index ist kein Fehler').toBeUndefined();
    expect(ergebnis.indizes[0]?.anzahl).toBe(0);
  });

  it('gar kein Index heißt `ohne_index`, nicht „nichts gefunden"', () => {
    // Drei Zustände sehen auf der Karte gleich aus: es gibt hier keine, der
    // Index fehlt, der Index ist alt. Genau die auseinanderzuhalten ist der
    // Zweck dieser Felder.
    const geo = alsGeoJson(leseSonderziele([]));

    expect(geo.features).toEqual([]);
    expect(geo.befund.ohne_index).toBe(true);
  });

  it('nichts gefunden ist NICHT `ohne_index`', () => {
    const dir = tempDir();
    const pfad = indexMit(dir, 'li', [poi('Aral', 'fuel', 47.14, 9.52)]);

    const geo = alsGeoJson(leseSonderziele([pfad]));

    expect(geo.features).toEqual([]);
    expect(geo.befund.ohne_index, 'ein leeres Ergebnis ist kein fehlender Index').toBe(false);
    expect(geo.befund.indizes).toHaveLength(1);
  });

  it('sagt es, wenn die Antwort gekappt ist', () => {
    const dir = tempDir();
    const viele: NormalizedRecord[] = [];
    for (let i = 0; i < 5; i += 1) {
      viele.push(poi(`Station ${i}`, 'sanitary_dump_station', 49 + i / 1000, 8));
    }
    const pfad = indexMit(dir, 'rp', viele);

    const gekappt = alsGeoJson(leseSonderziele([pfad], 3));
    expect(gekappt.features).toHaveLength(3);
    expect(gekappt.befund.gekappt, 'eine halbe Karte gibt sich als ganze aus').toBe(true);
  });

  it('unterhalb der Grenze meldet nichts eine Kappung', () => {
    // Die Gegenprobe. Ein `gekappt`, das immer `true` ist, wäre so wertlos
    // wie eines, das immer `false` ist — nur lauter.
    const dir = tempDir();
    const pfad = indexMit(dir, 'rp', [
      poi('Station A', 'sanitary_dump_station', 49.1, 8),
      poi('Station B', 'sanitary_dump_station', 49.2, 8),
    ]);

    const geo = alsGeoJson(leseSonderziele([pfad], 3));
    expect(geo.features).toHaveLength(2);
    expect(geo.befund.gekappt).toBe(false);
  });

  it('die echte Grenze ist eine benannte Zahl und keine im Vergleich versteckte', () => {
    expect(SONDERZIELE_HOECHSTENS_JE_INDEX).toBeGreaterThan(1000);
    // Der Standardwert ist wirklich die Konstante — sonst prüften die beiden
    // Tests darüber eine Zahl, die im Betrieb niemand benutzt.
    const dir = tempDir();
    const pfad = indexMit(dir, 'rp', [poi('Station', 'sanitary_dump_station', 49.1, 8)]);
    expect(leseSonderziele([pfad])).toEqual(
      leseSonderziele([pfad], SONDERZIELE_HOECHSTENS_JE_INDEX),
    );
  });
});

describe('ein Punkt ohne brauchbaren Ort kommt nicht auf die Karte', () => {
  /**
   * Ein Index mit BELIEBIGEN Zeilen — auch solchen, die `buildLiteIndexFile`
   * so nie schriebe.
   *
   * ─── WARUM DIESE TESTS NACHTRÄGLICH DAZUKAMEN ─────────────────────────────
   * `istOrt` stand mit einer ausführlichen Begründung im Quelltext und war
   * von KEINEM Test gedeckt. Zwei angesetzte Mutationen — 0/0 zulassen, die
   * Breitengradgrenze streichen — liefen beide grün durch.
   *
   * Dieselbe Lücke hatte `verkehrGeoJson.ts` schon einmal, und aus demselben
   * Grund: geprüft wurde, was die Daten üblicherweise enthalten, nicht, was
   * sie im Fehlerfall enthalten. Ein Kommentar ist keine Prüfung.
   */
  function indexMitZeilen(
    dir: string,
    zeilen: Array<{ name: string; lat: number; lon: number; category: string }>,
  ): string {
    const pfad = join(dir, 'lite_search-roh.db');
    const db = new Database(pfad);
    db.exec(`
      CREATE TABLE places (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        population INTEGER,
        category TEXT,
        search_text TEXT NOT NULL,
        address TEXT,
        locality TEXT,
        postcode TEXT,
        aux_text TEXT
      );
    `);
    const einfuegen = db.prepare(
      'INSERT INTO places (name, kind, lat, lon, category, search_text) ' +
        "VALUES (?, 'poi', ?, ?, ?, ?)",
    );
    for (const z of zeilen) einfuegen.run(z.name, z.lat, z.lon, z.category, z.name);
    db.close();
    return pfad;
  }

  it('lässt 0/0 nicht durch', () => {
    // 0/0 ist der Golf von Guinea und in Wahrheit immer ein fehlender Wert.
    // Ein Symbol dort ist schlimmer als keines — es ist eine Behauptung, und
    // zwar eine, die mitten im Atlantik steht.
    const dir = tempDir();
    const pfad = indexMitZeilen(dir, [
      { name: 'Ohne Ort', lat: 0, lon: 0, category: 'sanitary_dump_station' },
      { name: 'Mit Ort', lat: 49.22, lon: 8.36, category: 'sanitary_dump_station' },
    ]);

    expect(leseSonderziele([pfad]).ziele.map((z) => z.name)).toEqual(['Mit Ort']);
  });

  it('0 in NUR EINER Achse ist ein gültiger Ort', () => {
    // Der Nullmeridian läuft durch Frankreich und Spanien; lon = 0 mit einer
    // echten Breite ist ein ganz normaler Punkt. Eine Prüfung, die ihn
    // wegwürfe, hätte die Lücke nur verschoben.
    const dir = tempDir();
    const pfad = indexMitZeilen(dir, [
      { name: 'Am Nullmeridian', lat: 44.5, lon: 0, category: 'sanitary_dump_station' },
      { name: 'Am Äquator', lat: 0, lon: 9.4, category: 'sanitary_dump_station' },
    ]);

    expect(leseSonderziele([pfad]).ziele).toHaveLength(2);
  });

  it('lässt Werte ausserhalb des Gradbereichs nicht durch — in beiden Achsen', () => {
    // Beide Richtungen und beide Achsen. Bei den Verkehrsmeldungen war genau
    // hier eine Mutation durchgekommen, weil nur die OBERE Breitengrenze
    // geprüft war.
    const dir = tempDir();
    const pfad = indexMitZeilen(dir, [
      { name: 'zu weit nord', lat: 91, lon: 8.36, category: 'sanitary_dump_station' },
      { name: 'zu weit sued', lat: -91, lon: 8.36, category: 'sanitary_dump_station' },
      { name: 'zu weit ost', lat: 49.22, lon: 181, category: 'sanitary_dump_station' },
      { name: 'zu weit west', lat: 49.22, lon: -181, category: 'sanitary_dump_station' },
    ]);

    expect(leseSonderziele([pfad]).ziele).toEqual([]);
  });

  it('die Grenzwerte selbst sind gültig', () => {
    // Die Gegenprobe zur Prüfung darüber. Ohne sie wäre eine Prüfung, die
    // alles wegwirft, ebenso grün.
    const dir = tempDir();
    const pfad = indexMitZeilen(dir, [
      { name: 'Nordpol', lat: 90, lon: 0, category: 'sanitary_dump_station' },
      { name: 'Suedpol', lat: -90, lon: 0, category: 'sanitary_dump_station' },
      { name: 'Datumsgrenze ost', lat: 49.22, lon: 180, category: 'sanitary_dump_station' },
      { name: 'Datumsgrenze west', lat: 49.22, lon: -180, category: 'sanitary_dump_station' },
    ]);

    expect(leseSonderziele([pfad]).ziele).toHaveLength(4);
  });
});

describe('alsGeoJson — was MapLibre bekommt', () => {
  it('schreibt die Koordinaten als [Länge, Breite]', () => {
    // Schon mehrfach andersherum eingebaut worden; in Deutschland liegt das
    // Ergebnis dann im Sudan und fällt nicht als Fehler auf.
    const dir = tempDir();
    const pfad = indexMit(dir, 'rp', [
      poi('Stellplatz', 'sanitary_dump_station', 49.22, 8.36),
    ]);

    expect(alsGeoJson(leseSonderziele([pfad])).features[0]?.geometry.coordinates).toEqual([
      8.36, 49.22,
    ]);
  });

  it('gibt jedem Punkt Symbol und Rang mit', () => {
    const dir = tempDir();
    const pfad = indexMit(dir, 'rp', [
      poi('Stellplatz', 'sanitary_dump_station', 49.22, 8.36),
    ]);

    const p = alsGeoJson(leseSonderziele([pfad])).features[0]?.properties;
    expect(p?.symbol).toBe('poi-entsorgung');
    expect(typeof p?.rang).toBe('number');
  });

  it('nennt die Kategorien samt Grund in der Antwort', () => {
    // Wer sich fragt, warum ein Symbol aus einer anderen Quelle kommt, soll
    // die Antwort dort finden, wo er nachsieht.
    const befund = alsGeoJson(leseSonderziele([])).befund;
    expect(befund.kategorien.length).toBeGreaterThan(0);
    for (const k of befund.kategorien) {
      expect(k.grund.length).toBeGreaterThan(20);
    }
  });
});

describe('die Liste bleibt mit dem Suchindex im Gleichschritt', () => {
  it('jede gemeldete Kategorie wird vom Index auch wirklich gesammelt', () => {
    // ─── DER FEHLER, DEN DAS VERHINDERT ─────────────────────────────────────
    // Stünde hier eine Kategorie, die `build-lite-index.sh` gar nicht aus der
    // PBF filtert, verspräche die Karte ein Symbol, das nie erscheinen kann —
    // und niemand könnte an der leeren Karte ablesen, woran es liegt. Genau
    // so war `supermarket` in `REDUCED_POI_CLASSES` jahrelang wirkungslos.
    const gesammelt = new Set(
      Object.values(POI_CATEGORIES).flatMap((liste) => liste.map((c) => c.value)),
    );
    for (const k of FEHLENDE_KLASSEN) {
      expect(gesammelt.has(k.kategorie), `${k.kategorie} steht in keiner POI_CATEGORIES-Liste`).toBe(
        true,
      );
    }
  });

  it('klasseFuer kennt genau die Kategorien der Liste — und sonst keine', () => {
    for (const k of FEHLENDE_KLASSEN) {
      expect(klasseFuer(k.kategorie)).toBe(k);
    }
    expect(klasseFuer('fuel')).toBeUndefined();
    expect(klasseFuer('')).toBeUndefined();
  });

  it('jede Kategorie hat ein eigenes Symbol', () => {
    // Zwei Kategorien mit demselben Bild wären auf der Karte dasselbe Ding.
    const symbole = FEHLENDE_KLASSEN.map((k) => k.symbol);
    expect(new Set(symbole).size).toBe(symbole.length);
  });
});
