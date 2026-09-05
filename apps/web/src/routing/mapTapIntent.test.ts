/**
 * Was ein Tipper auf die Karte bedeutet -- die beiden gemeldeten Fehler.
 *
 * Beide entstanden daraus, dass `handlePick` bedingungslos mit
 * `setDestination` endete:
 *
 *   1. „Wenn die Navigation aktiv ist und man auf die Karte klickt, wird in
 *      den Zielsetzen-Modus gewechselt. Die Route verschwindet."
 *   2. „Wenn ich hier nicht genau treffe, bin ich wieder in der Zieleingabe.
 *      Alle vorgeschlagenen Routen sind weg."
 */

import { describe, it, expect } from 'vitest';
import type { NavState } from '@yapaja/shared';
import { mapTapIntent, ROUTE_TAP_RADIUS_PX, type MapTapContext } from './mapTapIntent.js';

function ctx(overrides: Partial<MapTapContext> = {}): MapTapContext {
  return {
    tappedRouteId: null,
    pickTarget: 'destination',
    navStatus: null,
    ...overrides,
  };
}

/** Alle Zustaende, in denen wirklich gefahren wird. */
const DRIVING: NavState['status'][] = ['navigating', 'off_route', 'paused'];
/** Und die, in denen nicht gefahren wird. */
const NOT_DRIVING: NavState['status'][] = ['idle', 'arrived'];

describe('waehrend einer laufenden Fahrt (Meldung 1)', () => {
  it.each(DRIVING)('ein Tipper neben die Route bewirkt nichts (%s)', (status) => {
    // DER Kern. Vorher: `set-destination` -- die laufende Route war weg,
    // ohne Rueckfrage und ohne Weg zurueck.
    expect(mapTapIntent(ctx({ navStatus: status }))).toEqual({
      kind: 'ignore',
      reason: 'drive-active',
    });
  });

  it.each(DRIVING)('auch im Startpunkt-Modus wird nichts gesetzt (%s)', (status) => {
    // Der Startpunkt-Modus darf die Fahrt-Sperre nicht aushebeln: waehrend
    // einer Fahrt den START zu verschieben ergibt keinen Sinn.
    expect(mapTapIntent(ctx({ navStatus: status, pickTarget: 'origin' })).kind).toBe('ignore');
  });

  it.each(DRIVING)('eine getroffene Alternative gilt trotzdem (%s)', (status) => {
    // Kein Verwerfen, sondern ein Wechsel -- und der Betreiber hat sichtbar
    // auf eine Linie gezielt.
    expect(mapTapIntent(ctx({ navStatus: status, tappedRouteId: 'r2' }))).toEqual({
      kind: 'select-route',
      routeId: 'r2',
    });
  });
});

describe('ohne laufende Fahrt bleibt alles wie bisher', () => {
  it.each(NOT_DRIVING)('ein Tipper setzt das Ziel (%s)', (status) => {
    expect(mapTapIntent(ctx({ navStatus: status })).kind).toBe('set-destination');
  });

  it('ohne bekannten Navigationszustand setzt ein Tipper das Ziel', () => {
    // Beim Start ist `navState` noch `null`. Ein Tipper darf dann NICHT
    // stumm bleiben -- sonst waere die App vor dem ersten WS-Ereignis
    // scheinbar kaputt.
    expect(mapTapIntent(ctx({ navStatus: null })).kind).toBe('set-destination');
    expect(mapTapIntent(ctx({ navStatus: undefined })).kind).toBe('set-destination');
  });

  it('der Startpunkt-Modus gewinnt gegen das Ziel', () => {
    expect(mapTapIntent(ctx({ pickTarget: 'origin' })).kind).toBe('set-origin');
  });

  it('eine getroffene Alternative gewinnt gegen den Startpunkt-Modus', () => {
    expect(mapTapIntent(ctx({ pickTarget: 'origin', tappedRouteId: 'r3' }))).toEqual({
      kind: 'select-route',
      routeId: 'r3',
    });
  });
});

describe('die Treffer-Toleranz (Meldung 2)', () => {
  it('ist fuer einen Finger gedacht, nicht fuer einen Mauszeiger', () => {
    // Vorher wurde GENAU EIN Bildpunkt abgefragt (`e.point`). Diese Zahl ist
    // der Unterschied zwischen „trifft die Linie" und „verwirft alle
    // berechneten Alternativen". Sie darf nicht versehentlich klein werden.
    expect(ROUTE_TAP_RADIUS_PX).toBeGreaterThanOrEqual(12);
  });
});

describe('Zwischenziel-Modus', () => {
  it('ein Tipper setzt ein Zwischenziel', () => {
    expect(
      mapTapIntent({ tappedRouteId: null, pickTarget: 'waypoint', navStatus: 'idle' }),
    ).toEqual({ kind: 'set-waypoint' });
  });

  it('AUCH waehrend einer laufenden Fahrt', () => {
    // Das ist der Punkt, und es ist kein Widerspruch zum Ignorieren
    // daneben: in diesen Modus kommt man nur ueber einen eigenen Knopf, das
    // Antippen ist also bereits die zweite bewusste Handlung. Der Betreiber
    // hat Zwischenziele ausdruecklich „auch waehrend aktiver Navigation"
    // verlangt.
    for (const status of ['navigating', 'off_route', 'paused'] as const) {
      expect(
        mapTapIntent({ tappedRouteId: null, pickTarget: 'waypoint', navStatus: status }),
      ).toEqual({ kind: 'set-waypoint' });
    }
  });

  it('eine getroffene Route gewinnt trotzdem', () => {
    // Wer sichtbar auf eine Linie zielt, meint die Linie -- auch im
    // Zwischenziel-Modus.
    expect(
      mapTapIntent({ tappedRouteId: 'r2', pickTarget: 'waypoint', navStatus: 'navigating' }),
    ).toEqual({ kind: 'select-route', routeId: 'r2' });
  });

  it('ohne den Modus bleibt es beim bisherigen Verhalten', () => {
    // Die Absicherung gegen das Gegenteil: der neue Zweig darf die
    // Behebung aus 0.5.4 nicht aushebeln.
    expect(
      mapTapIntent({ tappedRouteId: null, pickTarget: 'destination', navStatus: 'navigating' }),
    ).toEqual({ kind: 'ignore', reason: 'drive-active' });
  });
});
