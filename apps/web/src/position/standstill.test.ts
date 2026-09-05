/**
 * Stillstandserkennung -- und was sie ueber „GPS verloren" entscheidet.
 *
 * Gemeldet: „Wenn das Wohnmobil länger an einem Ort steht, sieht es so aus,
 * als ob man kein GPS-Empfang hat."
 */

import { describe, it, expect } from 'vitest';
import type { Position } from '@yapaja/shared';
import {
  distanceMeters,
  wasStandingStill,
  STANDSTILL_SPEED_MPS,
  STANDSTILL_RADIUS_M,
} from './standstill.js';
import { deriveSignalState, GPS_SIGNAL_LOST_THRESHOLD_MS } from './gpsSignal.js';

function fix(overrides: Partial<Position> = {}): Position {
  return {
    lat: 49.3,
    lon: 8.4,
    alt: null,
    speed: null,
    heading: null,
    accuracy: 5,
    source: 'gpsd',
    fix: '3d',
    ts: '2026-09-05T10:00:00.000Z',
    ...overrides,
  };
}

describe('woran Stillstand erkannt wird', () => {
  it('an der gemeldeten Geschwindigkeit, wenn es eine gibt', () => {
    expect(wasStandingStill({ latest: fix({ speed: 0 }), previous: null })).toBe(true);
    expect(wasStandingStill({ latest: fix({ speed: 12 }), previous: null })).toBe(false);
  });

  it('ein ruhender Empfaenger zeigt selten exakt 0', () => {
    // Deshalb eine Schwelle statt `=== 0`. Knapp darunter ist Stillstand,
    // knapp darueber nicht.
    expect(wasStandingStill({ latest: fix({ speed: STANDSTILL_SPEED_MPS }), previous: null })).toBe(
      true,
    );
    expect(
      wasStandingStill({ latest: fix({ speed: STANDSTILL_SPEED_MPS + 0.1 }), previous: null }),
    ).toBe(false);
  });

  it('am Ort, wenn die Quelle keine Geschwindigkeit liefert', () => {
    // Der Browser-Standort liefert `speed` haeufig als `null`. Ohne diesen
    // zweiten Weg bliebe der gemeldete Fehler fuer genau diese Nutzer.
    const a = fix({ speed: null });
    const b = fix({ speed: null, lat: 49.30005 }); // ~5,6 m
    expect(wasStandingStill({ latest: b, previous: a })).toBe(true);

    const weit = fix({ speed: null, lat: 49.305 }); // ~556 m
    expect(wasStandingStill({ latest: weit, previous: a })).toBe(false);
  });

  it('ohne Geschwindigkeit UND ohne Vorgaenger wird nichts behauptet', () => {
    // Die vorsichtige Seite: nur ein BELEG darf die Warnung unterdruecken.
    expect(wasStandingStill({ latest: fix({ speed: null }), previous: null })).toBe(false);
  });

  it('ohne jeden Fix ebenfalls nicht', () => {
    expect(wasStandingStill({ latest: null, previous: null })).toBe(false);
  });

  it('eine unbrauchbare Geschwindigkeit faellt auf den Ortsvergleich zurueck', () => {
    // `NaN` ist keine Aussage. Waere die Pruefung nur `typeof === number`,
    // ergaebe `NaN <= 0.5` false und daraus faelschlich „faehrt".
    const a = fix({ speed: null });
    const b = fix({ speed: Number.NaN, lat: 49.30005 });
    expect(wasStandingStill({ latest: b, previous: a })).toBe(true);
  });
});

describe('Entfernungsberechnung', () => {
  it('derselbe Punkt hat Abstand 0', () => {
    expect(distanceMeters(fix(), fix())).toBe(0);
  });

  it('rechnet plausibel in Metern', () => {
    // 0,001 Grad Breite sind rund 111 m.
    const d = distanceMeters(fix(), fix({ lat: 49.301 }));
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(115);
  });

  it('die Schwelle liegt im Bereich der Empfaenger-Streuung', () => {
    expect(STANDSTILL_RADIUS_M).toBeGreaterThanOrEqual(5);
    expect(STANDSTILL_RADIUS_M).toBeLessThanOrEqual(30);
  });
});

describe('was daraus fuer die Anzeige folgt', () => {
  const base = { connected: true, lastRealUpdateTime: 1_000_000, source: 'gpsd' };
  const stale = base.lastRealUpdateTime + GPS_SIGNAL_LOST_THRESHOLD_MS + 1;

  it('stehendes Fahrzeug ohne neue Daten ist KEIN Ausfall', () => {
    // Der gemeldete Fehler. Vorher: 'lost' -- „GPS-Signal verloren" auf der
    // Karte, obwohl der Empfang einwandfrei war.
    expect(deriveSignalState({ ...base, now: stale, standingStill: true })).toBe('standstill');
  });

  it('fahrendes Fahrzeug ohne neue Daten IST ein Ausfall', () => {
    // Das ist der Fall, fuer den die Warnung gedacht war -- er bleibt.
    expect(deriveSignalState({ ...base, now: stale, standingStill: false })).toBe('lost');
  });

  it('frische Daten sind immer „live", egal ob es steht', () => {
    const fresh = base.lastRealUpdateTime + 100;
    expect(deriveSignalState({ ...base, now: fresh, standingStill: true })).toBe('live');
    expect(deriveSignalState({ ...base, now: fresh, standingStill: false })).toBe('live');
  });

  it('eine getrennte Verbindung ist ein Ausfall, auch im Stand', () => {
    // Der Stillstand entschuldigt nur ausbleibende POSITIONEN. Ist die
    // Verbindung zum Core weg, wissen wir gar nichts mehr.
    expect(
      deriveSignalState({ ...base, connected: false, now: stale, standingStill: true }),
    ).toBe('lost');
  });

  it('ohne je einen Fix bleibt es „wird gesucht"', () => {
    expect(
      deriveSignalState({ ...base, lastRealUpdateTime: null, now: stale, standingStill: true }),
    ).toBe('acquiring');
  });

  it('ohne Angabe zum Stillstand gilt der alte, vorsichtige Weg', () => {
    // Aufrufer, die es nicht wissen (etwa Alt-Code), sollen nicht
    // versehentlich eine Warnung unterdruecken.
    expect(deriveSignalState({ ...base, now: stale })).toBe('lost');
  });
});
