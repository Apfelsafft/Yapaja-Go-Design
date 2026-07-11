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

const TICK_INTERVAL_MS = 500;

export interface DeriveSignalStateInput {
  connected: boolean;
  lastRealUpdateTime: number | null;
  now: number;
}

/**
 * Pure core of the derivation -- see module docstring.
 *
 * `'acquiring'` (never had a real fix yet) is deliberately distinct from
 * `'lost'`: at cold start we have not *lost* a signal we never had, so the
 * "GPS-Signal verloren" banner (W-01) must NOT show during initial GPS
 * acquisition -- only after a real fix arrived and then went stale.
 */
export function deriveSignalState({ connected, lastRealUpdateTime, now }: DeriveSignalStateInput): GpsSignalState {
  if (lastRealUpdateTime === null) {
    return 'acquiring';
  }
  if (!connected) {
    return 'lost';
  }
  return now - lastRealUpdateTime < GPS_SIGNAL_LOST_THRESHOLD_MS ? 'live' : 'lost';
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
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  return deriveSignalState({ connected, lastRealUpdateTime, now });
}
