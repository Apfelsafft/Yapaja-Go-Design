/**
 * Zwischenziele: die Liste und ihre Reihenfolge.
 *
 * Gemeldet: „Zwischenziele einfuegen und in der Reihenfolge sortieren
 * koennen."
 *
 * Geprueft wird vor allem an den RAENDERN -- das erste und das letzte
 * Element sind bei Umsortierungen die Stellen, an denen Fehler durchrutschen
 * und im Fahrzeug dann eine Route ergeben, die niemand wollte.
 */

import { describe, it, expect } from 'vitest';
import type { LatLng } from '@yapaja/shared';
import {
  MAX_WAYPOINTS,
  addWaypoint,
  canAddWaypoint,
  canMove,
  moveWaypoint,
  removeWaypoint,
  toRequestWaypoints,
  waypointLabel,
  type Waypoint,
} from './waypoints.js';

function ll(n: number): LatLng {
  return { lat: 47 + n / 1000, lon: 9 + n / 1000 };
}

/** Eine Liste mit vorhersagbaren Namen A, B, C ... */
function liste(anzahl: number): Waypoint[] {
  let wps: Waypoint[] = [];
  for (let i = 0; i < anzahl; i += 1) {
    wps = addWaypoint(wps, ll(i), String.fromCharCode(65 + i));
  }
  return wps;
}

const namen = (wps: readonly Waypoint[]): (string | null)[] => wps.map((w) => w.name);

describe('anhaengen', () => {
  it('kommt ans Ende, nicht an eine geratene Stelle', () => {
    // Eine Automatik, die die Reihenfolge selbst waehlt, muesste raten --
    // und der Betreiber hat ausdruecklich darum gebeten, selbst zu sortieren.
    expect(namen(addWaypoint(liste(2), ll(9), 'C'))).toEqual(['A', 'B', 'C']);
  });

  it('jedes bekommt eine eigene Kennung', () => {
    const wps = liste(3);
    expect(new Set(wps.map((w) => w.id)).size).toBe(3);
  });

  it('aendert die urspruengliche Liste nicht', () => {
    const vorher = liste(2);
    addWaypoint(vorher, ll(9), 'C');
    expect(vorher).toHaveLength(2);
  });

  it('ein Name ist freiwillig', () => {
    const wps = addWaypoint([], ll(1));
    expect(wps[0].name).toBeNull();
  });
});

describe('die Obergrenze', () => {
  it('entspricht der des Routen-Typs', () => {
    // `RouteRequest.waypoints` ist mit „max 25" beschrieben, und der Core
    // prueft fuer jedes die Kartenabdeckung. Eine hoehere Zahl fiele erst
    // beim Server auf.
    expect(MAX_WAYPOINTS).toBe(25);
  });

  it('darunter darf angehaengt werden', () => {
    expect(canAddWaypoint(liste(MAX_WAYPOINTS - 1))).toBe(true);
  });

  it('am Limit nicht mehr -- und die Liste bleibt unveraendert', () => {
    const voll = liste(MAX_WAYPOINTS);
    expect(canAddWaypoint(voll)).toBe(false);
    expect(addWaypoint(voll, ll(99), 'zuviel')).toHaveLength(MAX_WAYPOINTS);
  });
});

describe('entfernen', () => {
  it('nimmt genau den einen heraus', () => {
    const wps = liste(3);
    expect(namen(removeWaypoint(wps, wps[1].id))).toEqual(['A', 'C']);
  });

  it('eine unbekannte Kennung aendert nichts', () => {
    expect(removeWaypoint(liste(3), 'gibt-es-nicht')).toHaveLength(3);
  });
});

describe('umsortieren', () => {
  it('nach oben tauscht mit dem Vorgaenger', () => {
    const wps = liste(3);
    expect(namen(moveWaypoint(wps, wps[2].id, 'up'))).toEqual(['A', 'C', 'B']);
  });

  it('nach unten tauscht mit dem Nachfolger', () => {
    const wps = liste(3);
    expect(namen(moveWaypoint(wps, wps[0].id, 'down'))).toEqual(['B', 'A', 'C']);
  });

  it('das erste kann nicht weiter hoch -- und springt NICHT ans Ende', () => {
    // Kein Umlauf: ein Eintrag, der beim Tippen auf „hoch" ganz nach unten
    // rutscht, ist im Fahrzeug eine Ueberraschung, keine Bedienung.
    const wps = liste(3);
    expect(namen(moveWaypoint(wps, wps[0].id, 'up'))).toEqual(['A', 'B', 'C']);
    expect(canMove(wps, wps[0].id, 'up')).toBe(false);
  });

  it('das letzte kann nicht weiter runter', () => {
    const wps = liste(3);
    expect(namen(moveWaypoint(wps, wps[2].id, 'down'))).toEqual(['A', 'B', 'C']);
    expect(canMove(wps, wps[2].id, 'down')).toBe(false);
  });

  it('in der Mitte geht beides', () => {
    const wps = liste(3);
    expect(canMove(wps, wps[1].id, 'up')).toBe(true);
    expect(canMove(wps, wps[1].id, 'down')).toBe(true);
  });

  it('bei einem einzigen Eintrag geht nichts', () => {
    const wps = liste(1);
    expect(canMove(wps, wps[0].id, 'up')).toBe(false);
    expect(canMove(wps, wps[0].id, 'down')).toBe(false);
  });

  it('eine unbekannte Kennung aendert nichts', () => {
    expect(namen(moveWaypoint(liste(3), 'gibt-es-nicht', 'up'))).toEqual(['A', 'B', 'C']);
    expect(canMove(liste(3), 'gibt-es-nicht', 'up')).toBe(false);
  });

  it('mehrere Schritte hintereinander ergeben die erwartete Reihenfolge', () => {
    // Der eigentliche Zweck: den letzten Eintrag ganz nach vorn holen.
    let wps = liste(3);
    const c = wps[2].id;
    wps = moveWaypoint(wps, c, 'up');
    wps = moveWaypoint(wps, c, 'up');
    expect(namen(wps)).toEqual(['C', 'A', 'B']);
  });
});

describe('was an den Core geht', () => {
  it('nur Koordinaten, in genau dieser Reihenfolge', () => {
    const wps = liste(3);
    expect(toRequestWaypoints(wps)).toEqual([ll(0), ll(1), ll(2)]);
  });

  it('eine leere Liste bleibt leer', () => {
    expect(toRequestWaypoints([])).toEqual([]);
  });
});

describe('die Beschriftung', () => {
  it('nimmt den Namen, wenn es einen gibt', () => {
    expect(waypointLabel(liste(1)[0])).toBe('A');
  });

  it('sonst die Koordinaten -- nie ein leerer Eintrag', () => {
    // Ein namenloser Eintrag in einer Liste laesst sich sonst von den
    // anderen nicht unterscheiden.
    const ohneNamen = addWaypoint([], { lat: 47.12345, lon: 9.6789 })[0];
    expect(waypointLabel(ohneNamen)).toContain('47.12345');
  });

  it('auch bei einem Namen aus lauter Leerzeichen', () => {
    const leer = addWaypoint([], { lat: 47.5, lon: 9.5 }, '   ')[0];
    expect(waypointLabel(leer)).toContain('47.5');
  });
});
