/**
 * Der Fehler, den diese Datei festhält, war eine LEERE KARTE.
 *
 * Der Betreiber hatte Liechtenstein und Rheinland-Pfalz gebaut; die
 * Installationsprüfung meldete beide als vorhanden. Angezeigt wurde
 * trotzdem nichts. Grund: `MapView` nahm `regions[0]`, `listRegions`
 * sortiert alphabetisch, und Follow-Me zog die Kamera sofort auf die
 * Position aus der HA-Entität — nach Rheinland-Pfalz, während der geladene
 * Kachelsatz Liechtenstein war.
 *
 * Kein Fehler, kein Hinweis, nur eine leere Fläche, die aussah wie ein
 * fehlgeschlagener Kachelbau. Diese Tests fallen um, sobald die Auswahl
 * wieder blind auf die erste Region zurückfällt.
 */

import { describe, it, expect } from 'vitest';
import {
  pickActiveRegion,
  regionContains,
  regionsContaining,
} from './activeRegion';
import type { MapRegionSummary } from './regions';

// bounds: [minLon, minLat, maxLon, maxLat]
const LIECHTENSTEIN: MapRegionSummary = {
  region: 'liechtenstein',
  bounds: [9.47, 47.05, 9.64, 47.28],
};
const RHEINLAND_PFALZ: MapRegionSummary = {
  region: 'rheinland-pfalz',
  bounds: [6.11, 48.97, 8.51, 50.95],
};
/** Enthält Rheinland-Pfalz vollständig — der Überlappungsfall. */
const DEUTSCHLAND: MapRegionSummary = {
  region: 'deutschland',
  bounds: [5.87, 47.27, 15.04, 55.06],
};

const IN_VADUZ = { lat: 47.141, lon: 9.521 };
const IN_MAINZ = { lat: 49.992, lon: 8.247 };
const IN_PARIS = { lat: 48.857, lon: 2.352 };

describe('regionContains', () => {
  it('erkennt einen Punkt innerhalb der Grenzen', () => {
    expect(regionContains(LIECHTENSTEIN, IN_VADUZ)).toBe(true);
    expect(regionContains(RHEINLAND_PFALZ, IN_MAINZ)).toBe(true);
  });

  it('erkennt einen Punkt außerhalb', () => {
    expect(regionContains(LIECHTENSTEIN, IN_MAINZ)).toBe(false);
    expect(regionContains(RHEINLAND_PFALZ, IN_VADUZ)).toBe(false);
  });

  // Sonst fällt ein Grenzort in keine Region und die Karte bleibt leer,
  // obwohl er auf der Kachel liegt.
  it('zählt einen Punkt genau auf der Kante als enthalten', () => {
    const [minLon, minLat, maxLon, maxLat] = LIECHTENSTEIN.bounds;
    expect(regionContains(LIECHTENSTEIN, { lat: minLat, lon: minLon })).toBe(true);
    expect(regionContains(LIECHTENSTEIN, { lat: maxLat, lon: maxLon })).toBe(true);
  });
});

describe('regionsContaining', () => {
  // Wer „Rheinland-Pfalz" und später „Deutschland" installiert, hat beide
  // über Mainz. Die kleinere Datei deckt dieselbe Stelle mit weniger
  // Speicher und mehr Detail ab.
  it('nennt bei Überlappung die GRÖSSERE Region zuerst — sie gibt die zusammenhängende Karte', () => {
    const found = regionsContaining([DEUTSCHLAND, RHEINLAND_PFALZ], IN_MAINZ);
    expect(found.map((r) => r.region)).toEqual(['deutschland', 'rheinland-pfalz']);
  });

  it('liefert nichts für einen Punkt außerhalb aller Regionen', () => {
    expect(regionsContaining([LIECHTENSTEIN, RHEINLAND_PFALZ], IN_PARIS)).toEqual([]);
  });
});

describe('pickActiveRegion', () => {
  // ─── DER GEMELDETE FEHLER ────────────────────────────────────────────────
  it('wählt die Region, in der die Position liegt — nicht die alphabetisch erste', () => {
    const choice = pickActiveRegion({
      regions: [LIECHTENSTEIN, RHEINLAND_PFALZ],
      point: IN_MAINZ,
      manual: null,
    });
    expect(choice.region?.region).toBe('rheinland-pfalz');
    expect(choice.reason).toBe('position');
    expect(choice.positionOutsideAllRegions).toBe(false);
  });

  it('wählt umgekehrt Liechtenstein, wenn man dort ist', () => {
    const choice = pickActiveRegion({
      regions: [LIECHTENSTEIN, RHEINLAND_PFALZ],
      point: IN_VADUZ,
      manual: null,
    });
    expect(choice.region?.region).toBe('liechtenstein');
  });

  it('nimmt ohne Position die grösste Region — sonst startet man in Liechtenstein, obwohl Deutschland installiert ist', () => {
    const choice = pickActiveRegion({
      // Liechtenstein steht ABSICHTLICH vorn: bis 0.5.0 gewann schlicht der
      // erste Eintrag, und genau so landete der Betreiber beim Start in
      // Liechtenstein, obwohl Rheinland-Pfalz und Deutschland installiert
      // waren. Die Karte sprang dann erst beim GPS-Fix um.
      regions: [LIECHTENSTEIN, RHEINLAND_PFALZ],
      point: null,
      manual: null,
    });
    expect(choice.region?.region).toBe('rheinland-pfalz');
    expect(choice.reason).toBe('fallback');
    // Ohne Position ist nichts „außerhalb" — es gibt keinen Punkt.
    expect(choice.positionOutsideAllRegions).toBe(false);
  });

  // Eine ausdrückliche Wahl ist eine Entscheidung, keine Empfehlung: sonst
  // wäre die Umschaltung im Kartenmenü ein Knopf, den die Automatik beim
  // nächsten Positions-Tick wieder umlegt.
  it('lässt die ausdrückliche Wahl die Position schlagen', () => {
    const choice = pickActiveRegion({
      regions: [LIECHTENSTEIN, RHEINLAND_PFALZ],
      point: IN_MAINZ,
      manual: 'liechtenstein',
    });
    expect(choice.region?.region).toBe('liechtenstein');
    expect(choice.reason).toBe('manual');
    // ... meldet aber weiterhin, dass die Position dort nicht liegt.
    expect(choice.positionOutsideAllRegions).toBe(false);
  });

  // Ein alter Wert (Region inzwischen gelöscht) darf nicht in eine leere
  // Karte führen — gleiche Regel wie beim Stil-Fallback in styleClient.ts.
  it('ignoriert eine ausdrückliche Wahl, die es nicht mehr gibt', () => {
    const choice = pickActiveRegion({
      regions: [RHEINLAND_PFALZ],
      point: IN_MAINZ,
      manual: 'liechtenstein',
    });
    expect(choice.region?.region).toBe('rheinland-pfalz');
    expect(choice.reason).toBe('position');
  });

  // Genau dieser Fall sah vorher wie eine kaputte Karte aus. Er MUSS
  // unterscheidbar sein, sonst kann die Oberfläche ihn nicht erklären.
  it('meldet eine Position außerhalb aller installierten Regionen', () => {
    const choice = pickActiveRegion({
      regions: [LIECHTENSTEIN, RHEINLAND_PFALZ],
      point: IN_PARIS,
      manual: null,
    });
    expect(choice.positionOutsideAllRegions).toBe(true);
    // Trotzdem etwas Anzeigbares — eine Karte ohne Stil ist kein besserer
    // Zustand als eine Karte an der falschen Stelle.
    expect(choice.region).not.toBeNull();
    expect(choice.reason).toBe('fallback');
  });

  it('kommt ohne installierte Region ohne Absturz aus', () => {
    const choice = pickActiveRegion({ regions: [], point: IN_MAINZ, manual: null });
    expect(choice.region).toBeNull();
    expect(choice.reason).toBe('none');
    expect(choice.positionOutsideAllRegions).toBe(false);
  });
});
