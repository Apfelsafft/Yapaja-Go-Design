/**
 * Die Suche ueber alle Aspekte -- gegen einen echten Index gemessen.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Bitte passe die Suche an. Ich habe beispielsweise den Eschenweg in
 * Sondernheim (Germersheim) gesucht. Der wurde nicht gefunden, andere aber
 * wurden angezeigt. Ich habe dann direkt nach Sondernheim gesucht, das wurde
 * nicht gefunden. Ich habe eschenweg 2 eingegeben und das wurde auch nicht
 * gefunden. Bitte erstelle eine smarte Suche, die ueber alle Aspekte einer
 * Adresse Ergebnisse liefert. Poi name, Typ, Strasse, Ort, plz,
 * Sehenswuerdigkeiten usw."
 *
 * ─── WAS GEMESSEN WURDE, BEVOR ETWAS GEAENDERT WURDE ────────────────────────
 * Mit einem echten Index und realistisch getaggten Daten:
 *
 *     „Sondernheim"            -> 0 Treffer
 *     „eschenweg"              -> 1 Treffer
 *     „eschenweg 2"            -> 0 Treffer
 *     „Eschenweg Germersheim"  -> 0 Treffer
 *
 * Zwei unabhaengige Ursachen:
 *
 *  1. `place=suburb` kam gar nicht in den Index -- Ortsteile fielen beim
 *     Bauen still heraus. Sondernheim war nicht schwer zu finden, sondern
 *     nicht vorhanden.
 *
 *  2. Die GESAMTE Eingabe wurde als EINE zusammenhaengende Zeichenfolge
 *     gesucht. „Eschenweg" enthaelt weder „g 2" noch „g G" -- also fiel jede
 *     Suche aus mehr als einem Wort durch, auch wenn beide Angaben stimmten.
 *
 * Diese Datei haelt beides fest, gegen einen wirklich gebauten Index. Ein
 * Test gegen nachgebaute Zwischenstufen haette Ursache 1 gar nicht gesehen.
 */

import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLiteIndexFile } from './buildIndex.js';
import { LiteIndexReader } from './reader.js';
import {
  normalizePlaceFeature,
  normalizePoiFeature,
  normalizeStreetFeature,
  type NormalizedRecord,
  type OsmFeature,
} from './extract.js';

let dir: string;
afterEach(() => {
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

function place(kind: string, name: string, lon: number, lat: number): OsmFeature {
  return {
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { place: kind, name },
  } as OsmFeature;
}

function street(
  name: string,
  lon: number,
  lat: number,
  extra: Record<string, string> = {},
): OsmFeature {
  return {
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { highway: 'residential', name, ...extra },
  } as OsmFeature;
}

/** Ein Sonderziel -- der Fall, um den es beim „Beethoven"-Beispiel geht. */
function poi(name: string, lon: number, lat: number, extra: Record<string, string> = {}): OsmFeature {
  return {
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { shop: 'bakery', name, ...extra },
  } as OsmFeature;
}

/** Baut einen echten Index aus normalisierten OSM-Merkmalen. */
function buildIndex(features: OsmFeature[]): LiteIndexReader {
  const records = features
    .map((f) => normalizePlaceFeature(f) ?? normalizePoiFeature(f) ?? normalizeStreetFeature(f))
    .filter((r): r is NormalizedRecord => r !== null);
  expect(records.length, 'die Testdaten selbst muessen indizierbar sein').toBe(features.length);

  dir = mkdtempSync(join(tmpdir(), 'multi-aspect-'));
  const dbPath = join(dir, 'lite_search.db');
  buildLiteIndexFile(records, dbPath, { region: 'test' });
  return new LiteIndexReader(dbPath);
}

/** Der Datenbestand um Germersheim, so getaggt wie in OSM. */
function germersheimIndex(): LiteIndexReader {
  return buildIndex([
    place('town', 'Germersheim', 8.36, 49.22),
    place('suburb', 'Sondernheim', 8.38, 49.21),
    street('Eschenweg', 8.381, 49.211, { 'addr:city': 'Germersheim', 'addr:postcode': '76726' }),
    street('Hauptstraße', 8.362, 49.221, { 'addr:city': 'Germersheim' }),
    street('Eschenweg', 8.6, 49.5, { 'addr:city': 'Speyer' }),
  ]);
}

const namen = (reader: LiteIndexReader, q: string): string[] =>
  reader.searchByPrefix(q, 10).map((h) => h.name);

describe('der Ortsteil', () => {
  it('wird gefunden -- vorher war er gar nicht im Index', () => {
    expect(namen(germersheimIndex(), 'Sondernheim')).toContain('Sondernheim');
  });

  it('auch die uebrigen Untergliederungen', () => {
    const reader = buildIndex([
      place('quarter', 'Altstadt', 8.4, 49.3),
      place('borough', 'Mitte', 8.5, 49.4),
      place('hamlet', 'Kleinweiler', 8.6, 49.5),
    ]);
    expect(namen(reader, 'Altstadt')).toContain('Altstadt');
    expect(namen(reader, 'Mitte')).toContain('Mitte');
    expect(namen(reader, 'Kleinweiler')).toContain('Kleinweiler');
  });
});

describe('mehrere Woerter', () => {
  it('Strasse und Ort zusammen findet die Strasse IN diesem Ort', () => {
    // Der Kern der Meldung. Vorher: 0 Treffer, obwohl beide Angaben stimmen.
    const treffer = namen(germersheimIndex(), 'Eschenweg Germersheim');
    expect(treffer).toContain('Eschenweg');
  });

  it('und grenzt dabei wirklich ein', () => {
    // Es gibt zwei Eschenwege. Mit dem Ort dahinter darf nur einer bleiben --
    // sonst waere die zweite Angabe nur Zierde.
    const reader = germersheimIndex();
    expect(reader.searchByPrefix('Eschenweg', 10)).toHaveLength(2);
    expect(reader.searchByPrefix('Eschenweg Germersheim', 10)).toHaveLength(1);
  });

  it('die Reihenfolge der Woerter ist egal', () => {
    expect(namen(germersheimIndex(), 'Germersheim Eschenweg')).toContain('Eschenweg');
  });

  it('eine Hausnummer verhindert den Treffer nicht mehr', () => {
    // „eschenweg 2": die 2 steht in keinem Strassennamen. Vorher fiel damit
    // die ganze Suche durch, statt wenigstens die Strasse zu liefern.
    expect(namen(germersheimIndex(), 'eschenweg 2')).toContain('Eschenweg');
  });

  it('zu kurze Bruchstuecke machen die Suche nicht leer', () => {
    // „Weg 12" -- „12" ist fuer den Trigramm-Tokenizer zu kurz. Mit UND
    // verknuepft haette es sonst alles ausgeloescht.
    expect(namen(germersheimIndex(), 'Eschenweg 12')).toContain('Eschenweg');
  });

  it('eine Wortgruppe in Anfuehrungszeichen bleibt zusammen', () => {
    const reader = buildIndex([place('village', 'Sankt Martin', 8.1, 49.3)]);
    expect(namen(reader, '"Sankt Martin"')).toContain('Sankt Martin');
  });
});

describe('Ort und Postleitzahl als Suchaspekt', () => {
  it('die PLZ findet, was darin liegt', () => {
    expect(namen(germersheimIndex(), '76726')).toContain('Eschenweg');
  });

  it('der Ortsname allein findet auch die Strassen darin', () => {
    // „ueber alle Aspekte einer Adresse" -- der Ort ist einer davon.
    const treffer = namen(germersheimIndex(), 'Germersheim');
    expect(treffer).toContain('Germersheim'); // der Ort selbst
    expect(treffer).toContain('Hauptstraße'); // und was darin liegt
  });
});

describe('die Sorge, die vorher zum Weglassen gefuehrt hat', () => {
  it('„Beethoven" findet die Strasse VOR den Laeden darin', () => {
    // Im Code stand: „sonst faende 'Beethoven' jeden Laden in der
    // Beethovenstrasse statt der Strasse selbst". Die Sorge ist berechtigt --
    // die Antwort darauf ist eine Rangfolge, kein Weglassen.
    const reader = buildIndex([
      street('Beethovenstraße', 8.44, 49.32, { 'addr:city': 'Speyer' }),
      // Eine Baeckerei IN der Beethovenstrasse -- genau der Fall aus dem
      // Kommentar, der die Adressdaten frueher aus der Suche gehalten hat.
      poi('Baeckerei Klein', 8.441, 49.321, {
        'addr:street': 'Beethovenstraße',
        'addr:housenumber': '7',
        'addr:city': 'Speyer',
      }),
    ]);
    const treffer = namen(reader, 'Beethoven');
    expect(treffer[0], 'die Strasse selbst gehoert nach oben').toBe('Beethovenstraße');
    // Aber die Baeckerei ist trotzdem auffindbar -- vorher war sie es nicht.
    expect(treffer).toContain('Baeckerei Klein');
  });

  it('und ueberlebt auch gegen viele Laeden in derselben Strasse', () => {
    // DAS ist die Stelle, an der die Gewichtung wirklich etwas aendert: aus
    // der Datenbank kommt nur eine begrenzte Zahl Zeilen, nach bm25 geordnet.
    // In einer grossen Stadt koennten die vielen Laeden IN der
    // Beethovenstrasse die Strasse selbst aus dieser Auswahl draengen, bevor
    // die Rangfolge sie ueberhaupt zu sehen bekommt.
    //
    // 40 Laeden gegen eine Strasse, und abgeholt werden 20 Zeilen (viermal
    // das Limit, mindestens 20) -- ohne Gewichtung faellt die Strasse hier
    // heraus.
    const laeden = Array.from({ length: 40 }, (_, i) =>
      poi(`Laden ${i}`, 8.44 + i / 10_000, 49.32, {
        'addr:street': 'Beethovenstraße',
        'addr:housenumber': String(i + 1),
        'addr:city': 'Speyer',
      }),
    );
    const reader = buildIndex([street('Beethovenstraße', 8.43, 49.31, { 'addr:city': 'Speyer' }), ...laeden]);

    expect(reader.searchByPrefix('Beethoven', 5).map((h) => h.name)).toContain('Beethovenstraße');
  });

  it('ein Name zaehlt mehr als eine Adresse, auch wenn er laenger ist', () => {
    // Der eigentliche Zweck der Gewichtung. Ohne sie gewinnt hier das
    // KUERZERE Feld: bm25 bevorzugt kurze Dokumente, und „Beethoven" als
    // blosse Adresse eines kurz benannten Ladens waere dann der bessere
    // Treffer als die Strasse mit dem langen Namen. Wer „Beethoven" tippt,
    // meint aber die Strasse.
    const reader = buildIndex([
      street('Alter Beethovenweg am Stadtpark', 8.43, 49.31, { 'addr:city': 'Speyer' }),
      poi('Ab', 8.44, 49.32, { 'addr:street': 'Beethoven', 'addr:city': 'Speyer' }),
    ]);
    expect(reader.searchByPrefix('Beethoven', 10)[0].name).toBe('Alter Beethovenweg am Stadtpark');
  });
});

describe('ein Index von vor 0.6.0', () => {
  it('bleibt lesbar -- eine einspaltige Volltextsuche darf nicht brechen', () => {
    // Genau dieser Fehler ist hier schon einmal passiert („Speyer wird nicht
    // angezeigt"): ein Schemawechsel legte die Suche fuer jeden mit aelterem
    // Index still. Ein Neubau dauert bei einem grossen Extrakt Stunden und
    // darf nicht erzwungen werden.
    dir = mkdtempSync(join(tmpdir(), 'alt-index-'));
    const dbPath = join(dir, 'lite_search.db');

    // Das ECHTE alte Schema, von Hand -- nicht der heutige Builder, sonst
    // pruefte der Test nur sich selbst.
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE places (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
        lat REAL NOT NULL, lon REAL NOT NULL, population INTEGER,
        category TEXT, search_text TEXT NOT NULL, address TEXT, locality TEXT
      );
      CREATE VIRTUAL TABLE lite_search USING fts5(
        search_text, tokenize = 'trigram', content = 'places', content_rowid = 'id'
      );
    `);
    db.prepare(
      "INSERT INTO places (name, kind, lat, lon, search_text) VALUES ('Speyer', 'town', 49.32, 8.44, 'Speyer')",
    ).run();
    db.exec('INSERT INTO lite_search(rowid, search_text) SELECT id, search_text FROM places;');
    db.close();

    const reader = new LiteIndexReader(dbPath);
    expect(namen(reader, 'Speyer')).toEqual(['Speyer']);
    // Auch die Mehrwortsuche darf dort nicht ins Leere laufen -- sie wirkt
    // ohne Neubau, nur eben auf dem, was der alte Index kennt.
    expect(namen(reader, 'Speyer Speyer')).toEqual(['Speyer']);
  });
});
