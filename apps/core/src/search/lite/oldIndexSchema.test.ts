/**
 * Ein Index von gestern muss heute noch lesbar sein.
 *
 * ─── DER FEHLER, DEN DAS VERHINDERT ─────────────────────────────────────────
 * Gemeldet: „Der Suchindex klappt nicht. Habe Speyer eingegeben, aber es wird
 * nichts angezeigt." Auf dem Geraet lag ein 63 MB grosser Index fuer
 * Rheinland-Pfalz — Speyer steht darin.
 *
 * Ursache: `places` bekam mit 0.3.6 die Spalte `category`, mit 0.3.9
 * `address` und `locality`. Der Leser verlangte sie bedingungslos. Gegen
 * einen aelteren Index brach die Abfrage ab:
 *
 *     no such column: p.category
 *
 * Der Fehler wurde nach oben zu einem Backend-Fehler und die Oberflaeche
 * meldete „Nichts gefunden fuer …". Die Suche war also nach dem Update
 * VOLLSTAENDIG tot — fuer jeden mit einem aelteren Index, ohne dass irgendwo
 * stand, woran es lag.
 *
 * ─── WARUM NICHT EINFACH „DANN BAU HALT NEU" ────────────────────────────────
 * Ein Neubau dauert bei Rheinland-Pfalz Minuten, bei Deutschland Stunden. Ein
 * Schema-Wechsel darf das nicht erzwingen. Gelesen wird, was da ist; was
 * fehlt, ist `null`.
 *
 * Die Indizes hier werden mit den ECHTEN alten Schemata angelegt, nicht mit
 * dem heutigen Builder — sonst pruefte der Test nur sich selbst.
 */

import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LiteIndexReader } from './reader';

let dir: string;
afterEach(() => {
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

/** Das Schema, das 0.3.5 geschrieben hat: kein `category`, Volltext auf `name`. */
function buildIndexAsOf035(path: string): void {
  const con = new Database(path);
  con.exec(`
    CREATE TABLE places (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
      lat REAL NOT NULL, lon REAL NOT NULL, population INTEGER
    );
    CREATE VIRTUAL TABLE lite_search USING fts5(
      name, tokenize='trigram', content='places', content_rowid='id'
    );
  `);
  con.prepare('INSERT INTO places (name, kind, lat, lon) VALUES (?,?,?,?)').run(
    'Speyer',
    'town',
    49.317,
    8.431,
  );
  con.exec('INSERT INTO lite_search(rowid, name) SELECT id, name FROM places;');
  con.close();
}

/** Das Schema aus 0.3.6–0.3.8: MIT `category`/`search_text`, ohne `address`/`locality`. */
function buildIndexAsOf036(path: string): void {
  const con = new Database(path);
  con.exec(`
    CREATE TABLE places (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
      lat REAL NOT NULL, lon REAL NOT NULL, population INTEGER,
      category TEXT, search_text TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE lite_search USING fts5(
      search_text, tokenize='trigram', content='places', content_rowid='id'
    );
  `);
  con
    .prepare('INSERT INTO places (name, kind, lat, lon, search_text) VALUES (?,?,?,?,?)')
    .run('Speyer', 'town', 49.317, 8.431, 'Speyer');
  con.exec('INSERT INTO lite_search(rowid, search_text) SELECT id, search_text FROM places;');
  con.close();
}

function makePath(name: string): string {
  dir = dir && existsSync(dir) ? dir : mkdtempSync(join(tmpdir(), 'lite-oldschema-'));
  return join(dir, name);
}

describe('Suchindex aus einer aelteren Version', () => {
  it('findet Speyer in einem Index von 0.3.5 (ohne category)', () => {
    const path = makePath('alt-035.db');
    buildIndexAsOf035(path);

    const hits = new LiteIndexReader(path).searchByPrefix('Speyer', 5);
    expect(
      hits.map((h) => h.name),
      'ein Index ohne die neueren Spalten laesst sich nicht mehr lesen — die Suche ist damit tot',
    ).toContain('Speyer');
  });

  it('findet Speyer in einem Index von 0.3.6–0.3.8 (ohne address/locality)', () => {
    const path = makePath('alt-036.db');
    buildIndexAsOf036(path);

    const hits = new LiteIndexReader(path).searchByPrefix('Speyer', 5);
    expect(hits.map((h) => h.name)).toContain('Speyer');
  });

  /** Fehlende Spalten sind `null`, nicht „Feld existiert nicht" — sonst
   *  muesste jeder Aufrufer zwei Zeilenformen kennen. */
  it('liefert fuer fehlende Spalten null statt zu fehlen', () => {
    const path = makePath('alt-null.db');
    buildIndexAsOf035(path);

    const [hit] = new LiteIndexReader(path).searchByPrefix('Speyer', 5);
    expect(hit).toBeDefined();
    expect(hit.locality ?? null).toBeNull();
    expect(hit.address ?? null).toBeNull();
    expect(hit.category ?? null).toBeNull();
  });

  /** Die Rueckwaertssuche (Name eines angetippten Ziels) liest dieselben
   *  Spalten und war damit genauso tot. */
  it('beantwortet auch die Rueckwaertssuche aus einem alten Index', () => {
    const path = makePath('alt-rev.db');
    buildIndexAsOf035(path);

    const hits = new LiteIndexReader(path).nearest(49.317, 8.431, 3);
    expect(hits.map((h) => h.name)).toContain('Speyer');
  });
});
