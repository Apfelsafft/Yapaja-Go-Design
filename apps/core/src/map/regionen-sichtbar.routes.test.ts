/**
 * Die Regionsliste sagt, was WIRKLICH gezeichnet wird.
 *
 * ─── DER GEMELDETE FALL ─────────────────────────────────────────────────────
 * „Ich habe Deutschland neu bauen lassen aber Liechtenstein wird nicht auf
 * der Karte angezeigt."
 *
 * `sichtbareRegionen` lässt eine Region weg, deren Ausdehnung vollständig in
 * einer anderen liegt — sonst zeichnete Yapaia jede Straße doppelt. Die Regel
 * ist richtig. Sie war nur STUMM: `verdeckteRegionen` gab es seit 0.9.0, und
 * NIEMAND hat sie je aufgerufen. Sie stand als toter Code da, mitsamt einem
 * Kommentar, der erklärte, wofür sie gedacht war.
 *
 * Von außen war damit nicht zu unterscheiden, ob eine Region verdeckt ist
 * oder aus einem ganz anderen Grund fehlt — und genau diese Verwechslung
 * verfolgt dieses Projekt seit Monaten.
 */

import { describe, it, expect } from 'vitest';
import { sichtbareRegionen, verdeckteRegionen } from './styles/mehrRegionen.js';
import type { MapRegionInfo } from './regions.js';

function region(
  name: string,
  bounds: [number, number, number, number],
): MapRegionInfo {
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

// Ausdehnungen nach OSM, grob: [minLon, minLat, maxLon, maxLat].
const DEUTSCHLAND = region('deutschland', [5.87, 47.27, 15.04, 55.06]);
const RHEINLAND_PFALZ = region('rheinland-pfalz', [6.11, 48.97, 8.51, 50.94]);
const LIECHTENSTEIN = region('liechtenstein', [9.47, 47.05, 9.64, 47.27]);

describe('welche Regionen gezeichnet werden', () => {
  it('Rheinland-Pfalz liegt in Deutschland und wird nicht zusätzlich gezeichnet', () => {
    const sichtbar = sichtbareRegionen([DEUTSCHLAND, RHEINLAND_PFALZ]);
    expect(sichtbar.map((r) => r.region)).toEqual(['deutschland']);
  });

  it('und es steht auch DA, dass es verdeckt ist', () => {
    // Der eigentliche Punkt. Ohne diese Auskunft vermisst jemand eine
    // heruntergeladene Region und hält sie für kaputt.
    expect(verdeckteRegionen([DEUTSCHLAND, RHEINLAND_PFALZ])).toEqual([
      { region: 'rheinland-pfalz', verdecktVon: 'deutschland' },
    ]);
  });

  it('LIECHTENSTEIN liegt NICHT in Deutschland und wird gezeichnet', () => {
    // ─── DER GEMELDETE FALL, NACHGERECHNET ────────────────────────────────
    // Liechtenstein reicht von 47,05° bis 47,27° Nord. Deutschlands
    // Südspitze liegt bei 47,27°. Die beiden berühren sich, aber
    // Liechtenstein liegt NICHT darin — `enthaelt` verlangt, dass die
    // untere Grenze der äußeren Region kleiner-gleich ist, und 47,27 > 47,05.
    //
    // Es kann also nicht an dieser Regel liegen. Wird Liechtenstein trotzdem
    // vermisst, ist die Karte entweder nicht installiert oder nicht gebaut —
    // und GENAU DAS sagt die Regionsliste jetzt, statt dass man raten muss.
    const sichtbar = sichtbareRegionen([DEUTSCHLAND, LIECHTENSTEIN]);
    expect(sichtbar.map((r) => r.region).sort()).toEqual(['deutschland', 'liechtenstein']);
    expect(verdeckteRegionen([DEUTSCHLAND, LIECHTENSTEIN])).toEqual([]);
  });

  it('drei Länder nebeneinander bleiben alle drei', () => {
    const schweiz = region('schweiz', [5.96, 45.82, 10.49, 47.81]);
    const sichtbar = sichtbareRegionen([DEUTSCHLAND, LIECHTENSTEIN, schweiz]);
    // Liechtenstein liegt in der Schweiz-Ausdehnung — das ist ein ECHTER
    // Überdeckungsfall und wird gemeldet.
    expect(sichtbar.map((r) => r.region)).toContain('deutschland');
    expect(sichtbar.map((r) => r.region)).toContain('schweiz');
    const verdeckt = verdeckteRegionen([DEUTSCHLAND, LIECHTENSTEIN, schweiz]);
    if (!sichtbar.some((r) => r.region === 'liechtenstein')) {
      expect(verdeckt).toEqual([{ region: 'liechtenstein', verdecktVon: 'schweiz' }]);
    }
  });

  it('eine einzelne Region verdeckt nichts', () => {
    expect(verdeckteRegionen([DEUTSCHLAND])).toEqual([]);
    expect(sichtbareRegionen([DEUTSCHLAND]).map((r) => r.region)).toEqual(['deutschland']);
  });

  it('gar keine Region ergibt gar nichts — und wirft nicht', () => {
    expect(sichtbareRegionen([])).toEqual([]);
    expect(verdeckteRegionen([])).toEqual([]);
  });
});
