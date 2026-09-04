/**
 * „Was ist gebaut, und wann?"
 *
 * Gemeldet: „Nach der (erfolgreichen) Erstellung sehe ich nicht, dass bereits
 * etwas erstellt wurde und wann." Bei einem Bau, der für Deutschland Stunden
 * läuft, ist das die Auskunft, an der hängt, ob jemand noch einmal baut.
 *
 * Geprüft wird gegen ECHTE Dateien und Verzeichnisse: die Auskunft entsteht
 * aus dem Dateisystem, und ein Test mit erfundenen Objekten würde genau den
 * Teil überspringen, der schiefgehen kann.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectBuildStatus, type IndexMeta } from './buildStatus';

let root: string;
const noMeta = (): IndexMeta => ({});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'build-status-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function paths() {
  return {
    tilesDir: join(root, 'tiles'),
    graphDir: join(root, 'valhalla', 'tiles'),
    liteSearchDir: join(root, 'lite-search'),
  };
}

describe('collectBuildStatus', () => {
  it('meldet auf einer frischen Installation ueberall "nicht gebaut"', async () => {
    const status = await collectBuildStatus(paths(), noMeta);
    expect(status.tiles).toEqual([]);
    expect(status.routing.present).toBe(false);
    expect(status.search).toEqual([]);
  });

  it('nennt jede gebaute Karte mit Zeitpunkt und Groesse', async () => {
    const p = paths();
    mkdirSync(p.tilesDir, { recursive: true });
    writeFileSync(join(p.tilesDir, 'liechtenstein.pmtiles'), 'x'.repeat(2048));
    writeFileSync(join(p.tilesDir, 'rheinland-pfalz.pmtiles'), 'x'.repeat(4096));
    // Keine Karte -- darf nicht als solche gezaehlt werden.
    writeFileSync(join(p.tilesDir, 'notiz.txt'), 'kein Kachelarchiv');

    const status = await collectBuildStatus(p, noMeta);
    expect(status.tiles.map((t) => t.region)).toEqual(['liechtenstein', 'rheinland-pfalz']);
    for (const tile of status.tiles) {
      expect(tile.present).toBe(true);
      expect(tile.built_at).toBeTruthy();
      expect(tile.size_bytes).toBeGreaterThan(0);
    }
  });

  /**
   * ─── DER PUNKT, AN DEM DIE OBERFLAECHE BISHER LOG ─────────────────────────
   * Es gibt EINEN Routinggraphen und EINEN Suchindex fuer alle Regionen --
   * beide Bauwege ersetzen den vorherigen Stand vollstaendig. Die Knoepfe
   * stehen aber pro Region. Diese Auskunft muss deshalb sagen, AUS WELCHER
   * Region der eine Stand kommt; ein Haekchen pro Region waere fuer jede
   * andere falsch.
   */
  it('nennt beim Routing die Region, aus der gebaut wurde', async () => {
    const p = paths();
    mkdirSync(p.graphDir, { recursive: true });
    writeFileSync(
      join(root, 'valhalla', 'build-info.json'),
      JSON.stringify({ region: 'rheinland-pfalz', built_at: '2026-09-04T08:00:00Z' }),
    );

    const status = await collectBuildStatus(p, noMeta);
    expect(status.routing.present).toBe(true);
    expect(status.routing.region).toBe('rheinland-pfalz');
    expect(status.routing.built_at).toBe('2026-09-04T08:00:00Z');
  });

  it('nennt beim Suchindex Region, Zeitpunkt und Anzahl aus dem Index selbst', async () => {
    const p = paths();
    mkdirSync(p.liteSearchDir, { recursive: true });
    writeFileSync(join(p.liteSearchDir, 'lite_search-liechtenstein.db'), 'x'.repeat(512));

    const status = await collectBuildStatus(p, () => ({
      region: 'liechtenstein',
      built_at: '2026-09-04T07:30:00Z',
      record_count: 4711,
    }));
    expect(status.search).toHaveLength(1);
    expect(status.search[0].present).toBe(true);
    expect(status.search[0].region).toBe('liechtenstein');
    expect(status.search[0].built_at).toBe('2026-09-04T07:30:00Z');
    expect(status.search[0].record_count).toBe(4711);
  });

  /** ─── DER GRUND FUER DIE GANZE UMSTELLUNG ────────────────────────────────
   *  Vier Laender installieren und in dreien nicht suchen koennen -- das war
   *  der Zustand bis 0.4.0. Die Uebersicht muss jetzt JEDE Region zeigen. */
  it('nennt jede Region einzeln', async () => {
    const p = paths();
    mkdirSync(p.liteSearchDir, { recursive: true });
    for (const region of ['deutschland', 'frankreich', 'schweiz']) {
      writeFileSync(join(p.liteSearchDir, `lite_search-${region}.db`), 'x'.repeat(128));
    }

    // Ohne `meta` -- die Region muss dann aus dem DATEINAMEN kommen.
    const status = await collectBuildStatus(p, noMeta);
    expect(status.search.map((s) => s.region)).toEqual(['deutschland', 'frankreich', 'schweiz']);
  });

  it('nennt beim Routing alle Regionen, die im einen Graphen stecken', async () => {
    const p = paths();
    mkdirSync(p.graphDir, { recursive: true });
    writeFileSync(
      join(root, 'valhalla', 'build-info.json'),
      JSON.stringify({ region: 'deutschland', regions: ['deutschland', 'schweiz'], built_at: '2026-09-04T08:00:00Z' }),
    );
    const status = await collectBuildStatus(p, noMeta);
    expect(status.routing.regions).toEqual(['deutschland', 'schweiz']);
  });

  /**
   * ─── LIEBER "UNBEKANNT" ALS GERATEN ───────────────────────────────────────
   * Ein Graph oder Index, der vor 0.3.9 gebaut wurde, traegt keine Herkunft.
   * Dann darf keine Region behauptet werden -- der Zeitpunkt aus dem
   * Dateisystem ist als Naeherung in Ordnung, eine erfundene Region nicht.
   */
  it('behauptet keine Region, wenn der Stand keine mitbringt', async () => {
    const p = paths();
    mkdirSync(p.graphDir, { recursive: true });
    mkdirSync(p.liteSearchDir, { recursive: true });
    writeFileSync(join(p.liteSearchDir, 'lite_search.db'), 'alt');

    const status = await collectBuildStatus(p, noMeta);
    expect(status.routing.present).toBe(true);
    expect(status.routing.region).toBeUndefined();
    expect(status.routing.built_at).toBeTruthy();
    expect(status.search).toHaveLength(1);
    expect(status.search[0].present).toBe(true);
    expect(status.search[0].region).toBeUndefined();
    expect(status.search[0].built_at).toBeTruthy();
  });

  it('faellt nicht ueber eine unlesbare build-info.json', async () => {
    const p = paths();
    mkdirSync(p.graphDir, { recursive: true });
    writeFileSync(join(root, 'valhalla', 'build-info.json'), '{kaputt');

    const status = await collectBuildStatus(p, noMeta);
    expect(status.routing.present).toBe(true);
    expect(status.routing.region).toBeUndefined();
  });
});
