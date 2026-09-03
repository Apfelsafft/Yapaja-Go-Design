/**
 * Unit tests for gpsSignal (E02-T5, W-01).
 */

import { describe, it, expect } from 'vitest';
import {
  deriveSignalState,
  lostThresholdForSource,
  GPS_SIGNAL_LOST_THRESHOLD_MS,
  INTERVAL_SOURCE_LOST_THRESHOLD_MS,
} from './gpsSignal';

describe('deriveSignalState', () => {
  it('is "live" when connected and the last real fix is within the 3s threshold', () => {
    const now = 10_000;
    expect(
      deriveSignalState({ connected: true, lastRealUpdateTime: now - 1000, now }),
    ).toBe('live');
  });

  it('flips to "lost" once 3s have passed without a real fix', () => {
    const now = 10_000;
    expect(
      deriveSignalState({
        connected: true,
        lastRealUpdateTime: now - GPS_SIGNAL_LOST_THRESHOLD_MS - 1,
        now,
      }),
    ).toBe('lost');

    // Just under the threshold is still "live".
    expect(
      deriveSignalState({
        connected: true,
        lastRealUpdateTime: now - GPS_SIGNAL_LOST_THRESHOLD_MS + 1,
        now,
      }),
    ).toBe('live');
  });

  it('goes back to "live" once a new real fix arrives', () => {
    const now = 10_000;
    // Was lost...
    expect(
      deriveSignalState({ connected: true, lastRealUpdateTime: now - 5000, now }),
    ).toBe('lost');
    // ...a real fix just came in.
    expect(
      deriveSignalState({ connected: true, lastRealUpdateTime: now, now }),
    ).toBe('live');
  });

  it('is "lost" while disconnected, even with a very recent real fix', () => {
    const now = 10_000;
    expect(
      deriveSignalState({ connected: false, lastRealUpdateTime: now, now }),
    ).toBe('lost');
  });

  it('is "acquiring" (not "lost") before any real fix has ever arrived', () => {
    // Cold start: we have not lost a signal we never had, so the loss banner
    // must not show yet (W-01).
    expect(
      deriveSignalState({ connected: true, lastRealUpdateTime: null, now: 10_000 }),
    ).toBe('acquiring');
    expect(
      deriveSignalState({ connected: false, lastRealUpdateTime: null, now: 10_000 }),
    ).toBe('acquiring');
  });
});

/**
 * Die Schwelle hängt an der QUELLE.
 *
 * Mit der HA-Companion-App als einziger Positionsquelle stand
 * „GPS-Signal verloren" praktisch dauerhaft auf der Karte: die App meldet in
 * Intervallen von Sekunden bis Minuten, gemessen wurde gegen 3 s. Eine
 * Warnung, die immer leuchtet, ist keine Warnung — man lernt, sie zu
 * übersehen, und übersieht dann auch den echten Ausfall.
 */
describe('deriveSignalState — Quelle bestimmt die Schwelle', () => {
  const NOW = 1_000_000;

  it('ist bei der Companion-App nach 10 s noch „live"', () => {
    expect(
      deriveSignalState({
        connected: true,
        lastRealUpdateTime: NOW - 10_000,
        now: NOW,
        source: 'ha_tracker',
      }),
    ).toBe('live');
  });

  it('ist bei gpsd nach denselben 10 s „lost"', () => {
    expect(
      deriveSignalState({
        connected: true,
        lastRealUpdateTime: NOW - 10_000,
        now: NOW,
        source: 'gpsd',
      }),
    ).toBe('lost');
  });

  // Die Grenze deckt sich mit MAX_FIX_AGE_MS im Core: ab dort wird ein
  // Zustand ohnehin verworfen. Zwei verschiedene Grenzen an zwei Stellen
  // wären genau die Sorte Widerspruch, die man später im Fahrzeug ausbadet.
  it('meldet die Companion-App jenseits von fünf Minuten doch als verloren', () => {
    expect(
      deriveSignalState({
        connected: true,
        lastRealUpdateTime: NOW - (INTERVAL_SOURCE_LOST_THRESHOLD_MS + 1),
        now: NOW,
        source: 'ha_tracker',
      }),
    ).toBe('lost');
  });

  // Eine Quelle, von der wir nichts wissen, wird streng behandelt: sonst
  // bliebe ein echter Ausfall fünf Minuten lang unbemerkt.
  it('behandelt eine unbekannte oder fehlende Quelle wie eine fortlaufende', () => {
    for (const source of [undefined, null, 'browser', 'etwas-neues']) {
      expect(
        deriveSignalState({
          connected: true,
          lastRealUpdateTime: NOW - 5_000,
          now: NOW,
          source,
        }),
      ).toBe('lost');
    }
  });

  it('lässt die Companion-App die Trennung zum Core nicht überdauern', () => {
    expect(
      deriveSignalState({
        connected: false,
        lastRealUpdateTime: NOW - 1_000,
        now: NOW,
        source: 'ha_tracker',
      }),
    ).toBe('lost');
  });
});

describe('lostThresholdForSource', () => {
  it('trennt Intervallquellen von fortlaufenden', () => {
    expect(lostThresholdForSource('ha_tracker')).toBe(INTERVAL_SOURCE_LOST_THRESHOLD_MS);
    expect(lostThresholdForSource('gpsd')).toBe(GPS_SIGNAL_LOST_THRESHOLD_MS);
    expect(lostThresholdForSource(null)).toBe(GPS_SIGNAL_LOST_THRESHOLD_MS);
  });
});
