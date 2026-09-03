/**
 * GPS signal state derivation (E02-T5, W-01).
 *
 * The banner and puck styling both need to know whether the *last real* GPS
 * fix (`pos/update`) is recent enough to call the signal "live". A
 * `pos/extrapolated` fix (dead-reckoning) intentionally does NOT reset the
 * "real fix" clock -- it exists precisely because the signal is lost, so it
 * must never make `signalState` flip back to 'live'.
 *
 * `deriveSignalState` is a pure function (no timers, no React) so it's
 * trivially unit-testable; `useGpsSignalState` wraps it with a ~500ms ticker
 * so components re-render as the 3s threshold is crossed even though no new
 * store state arrives while the signal is lost.
 */

import { useEffect, useState } from 'react';
import { usePositionStore } from './positionStore';

export type GpsSignalState = 'acquiring' | 'live' | 'lost';

/** No real fix for longer than this counts as "signal lost" (docs/08-wargame.md W-01). */
export const GPS_SIGNAL_LOST_THRESHOLD_MS = 3000;

/**
 * Dasselbe für eine Quelle, die in INTERVALLEN meldet statt fortlaufend.
 *
 * ─── WARUM ES DIESE ZWEITE SCHWELLE GIBT ──────────────────────────────────
 * 3 s sind für `gpsd` und den Browser-Standort richtig: die liefern etwa im
 * Sekundentakt, und eine Lücke von drei Sekunden ist dort tatsächlich ein
 * Ausfall. Die Home-Assistant-Companion-App liefert aber nicht fortlaufend,
 * sondern wenn sie etwas zu melden hat — je nach Einstellung des Telefons
 * alle paar Sekunden bis alle paar Minuten. Gegen 3 s gemessen ist so eine
 * Quelle fast immer „verloren".
 *
 * Genau das ist passiert: mit der Companion App als einziger Quelle stand
 * „GPS-Signal verloren" praktisch dauerhaft auf der Karte. Eine Warnung, die
 * immer leuchtet, ist keine Warnung mehr — man lernt, sie zu übersehen, und
 * dann wird auch der echte Ausfall übersehen. Das ist schlimmer als gar kein
 * Banner.
 *
 * Fünf Minuten deckt sich mit `MAX_FIX_AGE_MS` im Core
 * (`apps/core/src/position/haTracker/index.ts`): ab dort wird ein Zustand
 * ohnehin verworfen und gar nicht mehr weitergegeben. Die Anzeige und die
 * Quelle sind sich damit einig darüber, was „zu alt" heißt — zwei
 * verschiedene Grenzen an zwei Stellen wären genau die Sorte Widerspruch,
 * die man später im Fahrzeug ausbadet.
 */
export const INTERVAL_SOURCE_LOST_THRESHOLD_MS = 5 * 60 * 1000;

/** Quellen, die in Intervallen melden und deshalb die längere Schwelle
 *  bekommen. Bewusst eine Aufzählung und keine Heuristik: eine neue Quelle
 *  soll hier eingetragen werden müssen, statt stillschweigend die falsche
 *  Schwelle zu erben. */
const INTERVAL_SOURCES: ReadonlySet<string> = new Set(['ha_tracker']);

/** Welche Schwelle für diese Quelle gilt. Unbekannte oder fehlende Quelle →
 *  die strenge: eine Quelle, von der wir nichts wissen, wird wie eine
 *  fortlaufende behandelt, damit ein echter Ausfall nicht fünf Minuten lang
 *  unbemerkt bleibt. */
export function lostThresholdForSource(source: string | null | undefined): number {
  return source && INTERVAL_SOURCES.has(source)
    ? INTERVAL_SOURCE_LOST_THRESHOLD_MS
    : GPS_SIGNAL_LOST_THRESHOLD_MS;
}

const TICK_INTERVAL_MS = 500;

export interface DeriveSignalStateInput {
  connected: boolean;
  lastRealUpdateTime: number | null;
  now: number;
  /** Quelle des letzten echten Fixes (`Position.source`), falls bekannt. */
  source?: string | null;
}

/**
 * Pure core of the derivation -- see module docstring.
 *
 * `'acquiring'` (never had a real fix yet) is deliberately distinct from
 * `'lost'`: at cold start we have not *lost* a signal we never had, so the
 * "GPS-Signal verloren" banner (W-01) must NOT show during initial GPS
 * acquisition -- only after a real fix arrived and then went stale.
 */
export function deriveSignalState({
  connected,
  lastRealUpdateTime,
  now,
  source,
}: DeriveSignalStateInput): GpsSignalState {
  if (lastRealUpdateTime === null) {
    return 'acquiring';
  }
  if (!connected) {
    return 'lost';
  }
  return now - lastRealUpdateTime < lostThresholdForSource(source) ? 'live' : 'lost';
}

/**
 * React hook: 'live' while connected and a real fix arrived within the last
 * 3s, 'lost' otherwise (disconnected, no fix yet, or the last real fix is
 * stale). Ticks every ~500ms so the transition fires on its own, without
 * needing a new position.
 */
export function useGpsSignalState(): GpsSignalState {
  const connected = usePositionStore((state) => state.isConnected);
  const lastRealUpdateTime = usePositionStore((state) => state.lastRealUpdateTime);
  const source = usePositionStore((state) => state.position?.source ?? null);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  return deriveSignalState({ connected, lastRealUpdateTime, now, source });
}
