/**
 * Mehrere Regionen nebeneinander.
 *
 * ─── DER BLOCKER, DEN DAS BESEITIGT ─────────────────────────────────────────
 * Bis 0.4.0 gab es EINEN Suchindex fuer alles. „Suche bauen" bei einer Region
 * ersetzte den Index der anderen — wer Liechtenstein und Rheinland-Pfalz
 * installiert hatte, konnte immer nur in einer von beiden suchen. Fuer den
 * Plan, Karten fuer Deutschland, Frankreich, die Schweiz und Oesterreich
 * anzubieten, war das der Blocker: vier Laender herunterladen und in dreien
 * nicht suchen koennen.
 *
 * ─── UND DIE FALLE, DIE DABEI ENTSTEHT ──────────────────────────────────────
 * Landesextrakte ueberlappen an den Grenzen. Basel steckt im Schweizer UND im
 * deutschen Extrakt — dasselbe OSM-Objekt, dieselben Koordinaten. Ohne
 * Entdopplung stuende jede Grenzstadt zweimal in der Vorschlagsliste. Genau
 * das ist der Fall, den die neue Faehigkeit erst erzeugt.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NormalizedRecord } from './extract.js';
import { buildLiteIndexFile } from './buildIndex.js';
import { LiteBackend } from './liteBackend.js';
import { LEGACY_LITE_SEARCH_DB, liteSearchDbPathForRegion, listLiteSearchDbFiles } from './paths.js';

let dir: string;

afterEach(() => {
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

function makeDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'lite-multi-'));
  return dir;
}

/** Dasselbe Objekt, wie es in ZWEI Landesextrakten steht. */
const BASEL: NormalizedRecord = { kind: 'city', name: 'Basel', lat: 47.5596, lon: 7.5886 };
const FREIBURG: NormalizedRecord = { kind: 'city', name: 'Freiburg', lat: 47.999, lon: 7.842 };
const ZUERICH: NormalizedRecord = { kind: 'city', name: 'Zuerich', lat: 47.3769, lon: 8.5417 };

function buildRegion(root: string, region: string, records: NormalizedRecord[]): void {
  buildLiteIndexFile(records, liteSearchDbPathForRegion(root, region), { region });
}

describe('Suche ueber mehrere Regionen', () => {
  it('findet Eintraege aus JEDER installierten Region', async () => {
    const root = makeDir();
    buildRegion(root, 'deutschland', [FREIBURG, BASEL]);
    buildRegion(root, 'schweiz', [BASEL, ZUERICH]);

    const backend = new LiteBackend({ dbDir: root });
    const namesOf = async (q: string) => (await backend.search({ q, limit: 10 })).map((r) => r.name);

    expect(await namesOf('Freiburg')).toContain('Freiburg');
    expect(await namesOf('Zuerich')).toContain('Zuerich');
  });

  /** ─── DIE GRENZSTADT ───────────────────────────────────────────────────── */
  it('zeigt eine Grenzstadt, die in beiden Extrakten steckt, nur EINMAL', async () => {
    const root = makeDir();
    buildRegion(root, 'deutschland', [FREIBURG, BASEL]);
    buildRegion(root, 'schweiz', [BASEL, ZUERICH]);

    const results = await new LiteBackend({ dbDir: root }).search({ q: 'Basel', limit: 10 });
    expect(
      results.filter((r) => r.name === 'Basel'),
      'Basel steht in beiden Landesextrakten und erscheint doppelt',
    ).toHaveLength(1);
  });

  /** Zwei Orte gleichen Namens an VERSCHIEDENEN Stellen sind nicht dasselbe
   *  und muessen beide stehen bleiben -- sonst verschluckt die Entdopplung
   *  echte Treffer. */
  it('behaelt gleichnamige Orte an verschiedenen Orten', async () => {
    const root = makeDir();
    buildRegion(root, 'a', [{ kind: 'town', name: 'Neustadt', lat: 49.35, lon: 8.14 }]);
    buildRegion(root, 'b', [{ kind: 'town', name: 'Neustadt', lat: 51.02, lon: 13.61 }]);

    const results = await new LiteBackend({ dbDir: root }).search({ q: 'Neustadt', limit: 10 });
    expect(results).toHaveLength(2);
  });

  /**
   * ─── EINE NEUE REGION MUSS SOFORT WIRKEN ──────────────────────────────────
   * Die Oberflaeche sagt „ab sofort nutzbar, ohne Neustart" zu. Wenn die
   * Dateiliste nur einmal gelesen wuerde, waere ein neu gebauter Index bis zum
   * naechsten Neustart unsichtbar -- und die Zusage falsch.
   */
  it('nimmt eine neu gebaute Region ohne Neustart auf', async () => {
    const root = makeDir();
    buildRegion(root, 'deutschland', [FREIBURG]);
    const backend = new LiteBackend({ dbDir: root });

    expect((await backend.search({ q: 'Zuerich', limit: 5 })).length).toBe(0);

    buildRegion(root, 'schweiz', [ZUERICH]);

    const after = await backend.search({ q: 'Zuerich', limit: 5 });
    expect(after.map((r) => r.name)).toContain('Zuerich');
  });

  /** Wird eine Region entfernt, dürfen ihre Treffer nicht weiter kommen. */
  it('vergisst eine entfernte Region', async () => {
    const root = makeDir();
    buildRegion(root, 'deutschland', [FREIBURG]);
    buildRegion(root, 'schweiz', [ZUERICH]);
    const backend = new LiteBackend({ dbDir: root });
    expect((await backend.search({ q: 'Zuerich', limit: 5 })).length).toBe(1);

    rmSync(liteSearchDbPathForRegion(root, 'schweiz'));

    expect((await backend.search({ q: 'Zuerich', limit: 5 })).length).toBe(0);
    expect((await backend.search({ q: 'Freiburg', limit: 5 })).length).toBe(1);
  });

  /**
   * ─── DER ALTE SAMMELINDEX BLEIBT LESBAR ───────────────────────────────────
   * Nach dem Update liegt beim Betreiber noch `lite_search.db` aus der Zeit
   * davor. Wuerde er ignoriert, waere die Suche nach dem Update erst einmal
   * WEG -- bis jemand neu baut, und das dauert bei einem grossen Extrakt
   * Stunden.
   */
  it('liest den alten Sammelindex weiter mit', async () => {
    const root = makeDir();
    buildLiteIndexFile([FREIBURG], join(root, LEGACY_LITE_SEARCH_DB));

    const results = await new LiteBackend({ dbDir: root }).search({ q: 'Freiburg', limit: 5 });
    expect(results.map((r) => r.name)).toContain('Freiburg');
  });

  /** Halbfertige Dateien eines laufenden Baus duerfen nie in eine Antwort
   *  geraten -- `cli.ts` schreibt nach `<datei>.tmp-<pid>` und benennt erst
   *  danach um. */
  it('fasst die temporaere Datei eines laufenden Baus nicht an', () => {
    const root = makeDir();
    buildRegion(root, 'deutschland', [FREIBURG]);
    writeFileSync(join(root, 'lite_search-halbfertig.db.tmp-1234'), 'kein gueltiger Index');

    const files = listLiteSearchDbFiles(root);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('lite_search-deutschland.db');
  });

  it('meldet sauber, wenn noch gar nichts gebaut ist', async () => {
    const root = makeDir();
    const backend = new LiteBackend({ dbDir: root });
    await expect(backend.search({ q: 'Basel', limit: 5 })).rejects.toThrow(/Suchindex/);
  });
});
