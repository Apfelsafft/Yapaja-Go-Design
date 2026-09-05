/**
 * Fahrtdaten waehrend der Navigation.
 *
 * Gemeldet: „Bitte füge bei aktiver Navigation weitere Infos ein. Entfernung,
 * geschätzte Dauer, geschätzte Ankunftszeit."
 *
 * Der Core lieferte alle drei Werte laengst -- sie wurden nur nirgends auf
 * der Karte angezeigt. Geprueft wird hier vor allem, dass NICHTS erfunden
 * wird, wenn ein Wert fehlt.
 */

import { describe, it, expect } from 'vitest';
import type { NavState } from '@yapaja/shared';
import { tripInfoLabels, MISSING } from './TripInfoPanel.js';

function nav(overrides: Partial<NavState> = {}): NavState {
  return {
    status: 'navigating',
    route_id: 'r1',
    next_maneuver: null,
    distance_to_maneuver_m: 500,
    distance_remaining_m: 12_345,
    duration_remaining_s: 1_800,
    eta: '2026-09-05T14:30:00.000Z',
    speed_kmh: 80,
    speed_limit_kmh: 100,
    altitude_m: null,
    destination: null,
    ...overrides,
  };
}

describe('was angezeigt wird', () => {
  it('alle drei Werte, wenn sie da sind', () => {
    const labels = tripInfoLabels(nav());
    expect(labels.distance).not.toBe(MISSING);
    expect(labels.duration).not.toBe(MISSING);
    expect(labels.eta).not.toBe(MISSING);
  });

  it('Entfernung und Restzeit in lesbaren Einheiten, nicht in rohen Zahlen', () => {
    // Ohne diese beiden Zusicherungen genuegte `String(wert)`, um alle
    // uebrigen Pruefungen zu bestehen -- „12345" und „1800" stehen im
    // Fahrzeug fuer nichts.
    const labels = tripInfoLabels(nav({ distance_remaining_m: 12_345, duration_remaining_s: 1_800 }));
    expect(labels.distance).toBe('12,3 km');
    expect(labels.duration).toBe('30 Min');
  });
});

describe('was NICHT erfunden wird', () => {
  it('ein fehlender Wert bleibt ein Gedankenstrich, keine 0', () => {
    // Eine erfundene Ankunftszeit ist im Fahrzeug schlechter als eine
    // fehlende, weil man sich danach richtet.
    const labels = tripInfoLabels(
      nav({ distance_remaining_m: null, duration_remaining_s: null, eta: null }),
    );
    expect(labels.distance).toBe(MISSING);
    expect(labels.duration).toBe(MISSING);
    expect(labels.eta).toBe(MISSING);
  });

  it('ohne Navigationszustand ebenfalls', () => {
    for (const state of [null, undefined]) {
      const labels = tripInfoLabels(state);
      expect(labels).toEqual({ distance: MISSING, duration: MISSING, eta: MISSING });
    }
  });

  it('eine unbrauchbare Ankunftszeit reisst die Anzeige nicht mit', () => {
    // `formatEta` wirft bei einer kaputten Zeitangabe von aussen. Die anderen
    // beiden Werte muessen trotzdem stehen.
    const labels = tripInfoLabels(nav({ eta: 'kein Zeitstempel' }));
    expect(labels.eta).toBe(MISSING);
    expect(labels.distance).not.toBe(MISSING);
    expect(labels.duration).not.toBe(MISSING);
  });

  it('0 ist ein echter Wert und kein fehlender', () => {
    // Am Ziel sind Restzeit und Entfernung tatsaechlich 0 -- das ist eine
    // Aussage, kein Fehlen, und muss angezeigt werden.
    const labels = tripInfoLabels(nav({ distance_remaining_m: 0, duration_remaining_s: 0 }));
    expect(labels.distance).not.toBe(MISSING);
    expect(labels.duration).not.toBe(MISSING);
  });
});
