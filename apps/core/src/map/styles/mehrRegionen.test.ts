/**
 * Mehrere Kartenregionen gleichzeitig.
 *
 * ─── DER GEMELDETE FALL ─────────────────────────────────────────────────────
 * „Ich habe Deutschland, Liechtenstein und Schweiz Kacheln gebaut. Sehe aber
 * nur Deutschland."
 *
 * Die Ausdehnungen unten sind die aus jener Installation, abgelesen aus der
 * Regionenliste — nicht ausgedacht.
 */

import { describe, it, expect } from 'vitest';
import type { MapRegionInfo } from '../regions';
import { enthaelt, flaeche, sichtbareRegionen, verdeckteRegionen } from './mehrRegionen';
import { rewriteToRegions, regionSourceId, tileUrlForRegion } from './rewrite';
import { REGION_SOURCE_ID } from './constants';
import { buildYapaiaLightStyle } from './yapaja-light';

function region(name: string, bounds: MapRegionInfo['bounds']): MapRegionInfo {
  return {
    region: name,
    file: `${name}.pmtiles`,
    size_bytes: 1,
    bounds,
    minzoom: 0,
    maxzoom: 14,
    tile_type: 'mvt',
    compression: 'gzip',
  };
}

// Aus der gemeldeten Installation.
const GERMANY = region('germany', [5.86, 47.27, 15.05, 55.15]);
const RHEINLAND_PFALZ = region('rheinland-pfalz', [6.11, 48.96, 8.51, 50.94]);
const SWITZERLAND = region('switzerland', [5.96, 45.82, 10.49, 47.81]);
const LIECHTENSTEIN = region('liechtenstein', [9.47, 47.05, 9.64, 47.27]);

describe('enthaelt', () => {
  it('erkennt Rheinland-Pfalz als Teil von Deutschland', () => {
    expect(enthaelt(GERMANY.bounds, RHEINLAND_PFALZ.bounds)).toBe(true);
  });

  it('erkennt die Schweiz NICHT als Teil von Deutschland', () => {
    // Sie ragt nach Süden heraus (45,82° gegen 47,27°).
    expect(enthaelt(GERMANY.bounds, SWITZERLAND.bounds)).toBe(false);
  });

  it('erkennt Liechtenstein als Teil der Schweiz', () => {
    expect(enthaelt(SWITZERLAND.bounds, LIECHTENSTEIN.bounds)).toBe(true);
  });

  it('zählt Deckungsgleichheit als enthalten', () => {
    // Eine zweimal installierte Region soll einmal gezeichnet werden.
    expect(enthaelt(GERMANY.bounds, GERMANY.bounds)).toBe(true);
  });

  it('ist NICHT symmetrisch', () => {
    // Die naheliegende Fehlprogrammierung wäre eine Schnittmengenprüfung.
    // Die wäre symmetrisch — und würde Deutschland wegen der Schweiz
    // weglassen.
    expect(enthaelt(RHEINLAND_PFALZ.bounds, GERMANY.bounds)).toBe(false);
  });

  it('erkennt eine nur teilweise Überschneidung nicht als enthalten', () => {
    const a = region('a', [0, 0, 10, 10]);
    const b = region('b', [5, 5, 15, 15]);
    expect(enthaelt(a.bounds, b.bounds)).toBe(false);
    expect(enthaelt(b.bounds, a.bounds)).toBe(false);
  });
});

describe('sichtbareRegionen', () => {
  it('lässt Rheinland-Pfalz weg und zeichnet die anderen drei', () => {
    const sichtbar = sichtbareRegionen([
      GERMANY,
      RHEINLAND_PFALZ,
      SWITZERLAND,
      LIECHTENSTEIN,
    ]).map((r) => r.region);
    expect(sichtbar).toEqual(['germany', 'switzerland']);
  });

  it('stellt die größte Region voran', () => {
    // Sie wird zur Hauptregion und behält die unveränderte Quellen-ID.
    const sichtbar = sichtbareRegionen([SWITZERLAND, GERMANY]);
    expect(sichtbar[0].region).toBe('germany');
  });

  it('ist unabhängig von der Eingabereihenfolge', () => {
    // Sonst hinge die Karte an der Reihenfolge des Dateisystems, und
    // dieselbe Installation zeigte nach einem Neustart etwas anderes.
    const a = sichtbareRegionen([GERMANY, RHEINLAND_PFALZ, SWITZERLAND]).map((r) => r.region);
    const b = sichtbareRegionen([SWITZERLAND, RHEINLAND_PFALZ, GERMANY]).map((r) => r.region);
    const c = sichtbareRegionen([RHEINLAND_PFALZ, SWITZERLAND, GERMANY]).map((r) => r.region);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('entscheidet bei Deckungsgleichheit nach dem Namen', () => {
    const x = region('x-land', [0, 0, 10, 10]);
    const a = region('a-land', [0, 0, 10, 10]);
    expect(sichtbareRegionen([x, a]).map((r) => r.region)).toEqual(['a-land']);
    expect(sichtbareRegionen([a, x]).map((r) => r.region)).toEqual(['a-land']);
  });

  it('behält beide bei nur teilweiser Überschneidung', () => {
    // Zwei halb überlappende Regionen doppelt zu zeichnen ist hässlich, aber
    // eine davon ganz wegzulassen wäre falsch: dann fehlte ein Teil der Welt.
    const a = region('a', [0, 0, 10, 10]);
    const b = region('b', [5, 5, 15, 15]);
    expect(sichtbareRegionen([a, b])).toHaveLength(2);
  });

  it('kommt mit einer leeren Liste zurecht', () => {
    expect(sichtbareRegionen([])).toEqual([]);
  });
});

describe('verdeckteRegionen', () => {
  it('sagt, WER eine weggelassene Region enthält', () => {
    // Sonst vermisst jemand eine heruntergeladene Region und hält sie für
    // kaputt. Genau diese Sorte stummes Weglassen soll es nicht geben.
    expect(verdeckteRegionen([GERMANY, RHEINLAND_PFALZ, SWITZERLAND, LIECHTENSTEIN])).toEqual([
      { region: 'liechtenstein', verdecktVon: 'switzerland' },
      { region: 'rheinland-pfalz', verdecktVon: 'germany' },
    ]);
  });

  it('meldet nichts, wenn nichts verdeckt wird', () => {
    expect(verdeckteRegionen([GERMANY, SWITZERLAND])).toEqual([]);
  });
});

describe('flaeche', () => {
  it('ordnet Deutschland über die Schweiz', () => {
    expect(flaeche(GERMANY.bounds)).toBeGreaterThan(flaeche(SWITZERLAND.bounds));
  });

  it('ist für eine entartete Ausdehnung null und nicht negativ', () => {
    expect(flaeche([10, 10, 5, 5])).toBe(0);
  });
});

describe('rewriteToRegions', () => {
  const stil = buildYapaiaLightStyle();

  it('legt für jede Region eine eigene Kachelquelle an', () => {
    const s = rewriteToRegions(stil, ['germany', 'switzerland']);
    expect(s.sources[REGION_SOURCE_ID]).toEqual({
      type: 'vector',
      url: tileUrlForRegion('germany'),
    });
    expect(s.sources[`${REGION_SOURCE_ID}-switzerland`]).toEqual({
      type: 'vector',
      url: tileUrlForRegion('switzerland'),
    });
  });

  it('lässt der Hauptregion die unveränderte Quellen-ID', () => {
    // `apps/web/src/map/placeName.ts` fragt Merkmale unter genau diesem
    // Namen ab. Eine Abfrage auf eine unbekannte Quelle liefert eine LEERE
    // Liste, keinen Fehler -- der Ortsname unter dem Fahrzeug verschwände
    // also lautlos.
    expect(regionSourceId('germany', true)).toBe(REGION_SOURCE_ID);
    expect(regionSourceId('switzerland', false)).toBe(`${REGION_SOURCE_ID}-switzerland`);
  });

  it('vervielfacht jede quellengebundene Ebene', () => {
    const eine = rewriteToRegions(stil, ['germany']);
    const zwei = rewriteToRegions(stil, ['germany', 'switzerland']);
    const gebunden = stil.layers.filter((l) => 'source' in l && l.source !== undefined).length;
    expect(gebunden).toBeGreaterThan(0);
    expect(zwei.layers).toHaveLength(eine.layers.length + gebunden);
  });

  it('zeichnet den Hintergrund GENAU EINMAL', () => {
    // Er hängt an keiner Quelle. Zweimal gezeichnet verdeckte er alles
    // darunter -- die zweite Kopie läge über der ersten Karte.
    const s = rewriteToRegions(stil, ['germany', 'switzerland', 'france']);
    expect(s.layers.filter((l) => l.type === 'background')).toHaveLength(1);
  });

  // ─── DIE REIHENFOLGE IST DAS GANZE ────────────────────────────────────────
  it('gruppiert nach EBENE, nicht nach Region', () => {
    // Andersherum läge der Hintergrund der Schweiz über Deutschlands
    // Beschriftung, und die deutschen Ortsnamen verschwänden hinter einer
    // grauen Fläche.
    const s = rewriteToRegions(stil, ['germany', 'switzerland']);
    const ids = s.layers.map((l) => l.id);
    // Jede Schweizer Kopie steht direkt hinter ihrem deutschen Original.
    for (const [i, id] of ids.entries()) {
      if (!id.endsWith('__switzerland')) continue;
      expect(ids[i - 1], `"${id}" steht nicht direkt hinter seinem Original`).toBe(
        id.slice(0, -'__switzerland'.length),
      );
    }
  });

  it('hält jede Beschriftung über jeder Straße — auch der der anderen Region', () => {
    // Die eigentliche Aussage der Reihenfolge, am Ergebnis geprüft.
    const s = rewriteToRegions(stil, ['germany', 'switzerland']);
    const ids = s.layers.map((l) => l.id);
    const letzteStrasse = Math.max(
      ...ids.map((id, i) => (id.startsWith('road-') && !id.includes('label') && !id.includes('shield') ? i : -1)),
    );
    const ersteBeschriftung = ids.findIndex((id) => id.startsWith('place-labels'));
    expect(letzteStrasse).toBeGreaterThan(-1);
    expect(ersteBeschriftung).toBeGreaterThan(letzteStrasse);
  });

  it('gibt jeder Ebenenkopie eine eigene ID', () => {
    // Doppelte IDs sind in MapLibre ein harter Fehler: der Stil wird gar
    // nicht geladen, die Karte bleibt leer.
    const s = rewriteToRegions(stil, ['germany', 'switzerland', 'france']);
    const ids = s.layers.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('bindet jede Ebene an eine Quelle, die es auch gibt', () => {
    // Eine Ebene auf eine unbekannte Quelle ist kein Fehler, sondern eine
    // leere Ebene.
    const s = rewriteToRegions(stil, ['germany', 'switzerland']);
    for (const l of s.layers) {
      if (!('source' in l) || l.source === undefined) continue;
      expect(s.sources[l.source], `Ebene "${l.id}" zeigt auf "${l.source}"`).toBeDefined();
    }
  });

  it('verhält sich bei EINER Region genau wie bisher', () => {
    // Kein Sonderweg für den Normalfall: eine Region soll denselben Stil
    // ergeben wie vor 0.9.1.
    const s = rewriteToRegions(stil, ['germany']);
    expect(Object.keys(s.sources)).toEqual([REGION_SOURCE_ID]);
    expect(s.layers.map((l) => l.id)).toEqual(stil.layers.map((l) => l.id));
  });

  it('lässt den Stil unangetastet, wenn gar keine Region installiert ist', () => {
    expect(rewriteToRegions(stil, [])).toBe(stil);
  });
});
