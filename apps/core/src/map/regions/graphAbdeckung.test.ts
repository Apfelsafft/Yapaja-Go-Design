/**
 * Die Abdeckungsrechnung vor einem Routingbau.
 *
 * ─── DER GEMELDETE FALL, ALS ZAHLEN ─────────────────────────────────────────
 * Installiert: germany, liechtenstein, switzerland.
 * Gedrückt: „Routing bauen" bei liechtenstein (2,4 MB — das ging am
 * schnellsten).
 * Ergebnis: ein Graph, der NUR liechtenstein enthält. In Köln dann „No
 * suitable edges near location".
 *
 * Diese Prüfungen halten fest, dass genau das VORHER gesagt wird.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  abdeckungNachBau,
  abdeckungSatz,
  graphRegionenJetzt,
  pbfLagerPfad,
  regionenMitExtrakt,
} from './graphAbdeckung';

const INSTALLIERT = ['germany', 'liechtenstein', 'switzerland'];

describe('abdeckungNachBau', () => {
  it('erkennt den gemeldeten Fall: zwei Länder verlieren ihr Routing', () => {
    const a = abdeckungNachBau({
      installiert: INSTALLIERT,
      // Nur liechtenstein hat einen Extrakt -- der Kachelbau hinterlässt
      // keinen, er löscht sein Arbeitsverzeichnis.
      mitExtrakt: [],
      bauRegion: 'liechtenstein',
      jetzt: ['germany'],
    });
    expect(a.danach).toEqual(['liechtenstein']);
    expect(a.ohneRouting).toEqual(['germany', 'switzerland']);
    expect(a.verliert).toEqual(['germany']);
  });

  it('zählt die Bauregion IMMER dazu', () => {
    // Ihr Extrakt wird vom Bau selbst geladen, bevor er sammelt.
    const a = abdeckungNachBau({ installiert: [], mitExtrakt: [], bauRegion: 'switzerland' });
    expect(a.danach).toEqual(['switzerland']);
  });

  it('nennt nichts doppelt, wenn die Bauregion schon einen Extrakt hat', () => {
    const a = abdeckungNachBau({
      installiert: ['germany'],
      mitExtrakt: ['germany'],
      bauRegion: 'germany',
    });
    expect(a.danach).toEqual(['germany']);
  });

  it('meldet den guten Fall als guten Fall', () => {
    // Alle drei haben schon einmal Routing bekommen -> nichts geht verloren.
    const a = abdeckungNachBau({
      installiert: INSTALLIERT,
      mitExtrakt: ['germany', 'switzerland'],
      bauRegion: 'liechtenstein',
      jetzt: ['germany', 'switzerland'],
    });
    expect(a.ohneRouting).toEqual([]);
    expect(a.verliert).toEqual([]);
    expect(a.danach).toEqual(INSTALLIERT);
  });

  it('unterscheidet „verliert" von „hatte noch nie"', () => {
    // Zwei verschiedene Aussagen: eine ist ein Rückschritt, die andere nur
    // eine Lücke. Wer sie verwechselt, warnt entweder zu oft oder zu selten.
    const a = abdeckungNachBau({
      installiert: ['germany', 'switzerland'],
      mitExtrakt: [],
      bauRegion: 'germany',
      jetzt: [],
    });
    expect(a.verliert).toEqual([]);
    expect(a.ohneRouting).toEqual(['switzerland']);
  });

  it('ist unabhängig von der Reihenfolge der Eingaben', () => {
    const a = abdeckungNachBau({
      installiert: ['switzerland', 'germany'],
      mitExtrakt: ['switzerland'],
      bauRegion: 'germany',
    });
    expect(a.danach).toEqual(['germany', 'switzerland']);
  });
});

describe('abdeckungSatz', () => {
  it('nennt beide Richtungen und macht den Zusammenhang klar', () => {
    const satz = abdeckungSatz(
      abdeckungNachBau({
        installiert: INSTALLIERT,
        mitExtrakt: [],
        bauRegion: 'liechtenstein',
        jetzt: ['germany'],
      }),
    );
    expect(satz).toContain('liechtenstein');
    expect(satz).toContain('Verloren geht');
    expect(satz).toContain('germany');
    expect(satz).toContain('switzerland');
    // Der entscheidende Satz: eine installierte Karte ist noch kein Routing.
    expect(satz).toContain('keine Straßendaten');
  });

  it('sagt beim guten Fall, dass alles abgedeckt ist', () => {
    const satz = abdeckungSatz(
      abdeckungNachBau({
        installiert: ['germany'],
        mitExtrakt: ['germany'],
        bauRegion: 'germany',
      }),
    );
    expect(satz).toContain('Alle installierten Karten');
    expect(satz).not.toContain('Verloren');
  });
});

describe('pbfLagerPfad', () => {
  it('zeigt auf denselben Ordner wie das Bauskript', () => {
    // `yapaja-build-graph`: PBF_CACHE="$(dirname "$(dirname "$LIVE_DIR")")/planetiler-sources"
    // Laufen die beiden auseinander, meldet der Kern eine Abdeckung, die der
    // Bau nie herstellt.
    expect(pbfLagerPfad('/share/yapaja/valhalla/tiles')).toBe(
      '/share/yapaja/planetiler-sources',
    );
  });
});

describe('regionenMitExtrakt', () => {
  it('findet die Extrakte und schneidet die Endung ab', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yapaja-pbf-'));
    writeFileSync(join(dir, 'germany.osm.pbf'), 'x');
    writeFileSync(join(dir, 'switzerland.osm.pbf'), 'x');
    // Basisdaten des Kachelprofils -- die gehören NICHT dazu.
    writeFileSync(join(dir, 'water-polygons-split-3857.zip'), 'x');
    writeFileSync(join(dir, 'natural_earth_vector.sqlite.zip'), 'x');
    expect(regionenMitExtrakt(dir)).toEqual(['germany', 'switzerland']);
  });

  it('gibt eine leere Liste, wenn es den Ordner nicht gibt', () => {
    // Frische Installation. Kein Fehler, sondern ein Zustand.
    expect(regionenMitExtrakt('/gibt/es/nicht')).toEqual([]);
  });
});

describe('graphRegionenJetzt', () => {
  function graphMit(inhalt: unknown): string {
    const wurzel = mkdtempSync(join(tmpdir(), 'yapaja-graph-'));
    const graphDir = join(wurzel, 'tiles');
    mkdirSync(graphDir);
    writeFileSync(join(wurzel, 'build-info.json'), JSON.stringify(inhalt));
    return graphDir;
  }

  it('liest die Regionsliste eines heutigen Graphen', () => {
    expect(graphRegionenJetzt(graphMit({ regions: ['switzerland', 'germany'] }))).toEqual([
      'germany',
      'switzerland',
    ]);
  });

  it('versteht einen Graphen von vor 0.4.0 mit nur EINER Region', () => {
    // Sonst sähe ein alter Graph aus wie „gar keine Abdeckung", und die
    // Warnung „du verlierst germany" bliebe aus.
    expect(graphRegionenJetzt(graphMit({ region: 'germany' }))).toEqual(['germany']);
  });

  it('gibt eine leere Liste, wenn es keinen Graphen gibt', () => {
    expect(graphRegionenJetzt('/gibt/es/nicht')).toEqual([]);
  });

  it('verschluckt sich nicht an kaputtem Inhalt', () => {
    const wurzel = mkdtempSync(join(tmpdir(), 'yapaja-graph-'));
    const graphDir = join(wurzel, 'tiles');
    mkdirSync(graphDir);
    writeFileSync(join(wurzel, 'build-info.json'), '{ das ist kein JSON');
    expect(graphRegionenJetzt(graphDir)).toEqual([]);
  });
});
