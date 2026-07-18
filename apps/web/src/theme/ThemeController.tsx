/**
 * Mounts the theme controller (E07-T3): loads the persisted mode, then keeps
 * re-resolving + re-applying the theme as time passes and position updates
 * arrive. Mount once at the app root (`App.tsx`), mirroring
 * `PositionInitializer`/`RoutingInitializer`'s "one initializer component
 * per subsystem" convention. Renders nothing.
 */

import { useEffect } from 'react';
import { usePositionStore } from '../position/positionStore.js';
import { useThemeStore } from './themeStore.js';
import type { GeoPosition } from './resolveTheme.js';

/** How often to re-check for a sunrise/sunset (or clock) boundary crossing
 *  even with no new position fix arriving in between -- frequent enough
 *  that the ∓15min boundary offsets are never missed by more than this. */
const TICK_INTERVAL_MS = 30_000;

export default function ThemeController(): null {
  const init = useThemeStore((state) => state.init);
  const tick = useThemeStore((state) => state.tick);
  const position = usePositionStore((state) => state.position);
  const geoPosition: GeoPosition | null = position ? { lat: position.lat, lon: position.lon } : null;

  useEffect(() => {
    void init();
    // Stable store action, deliberately omitted from deps (see Shell.tsx's
    // identical `init()` effect for the same rationale).
  }, []);

  useEffect(() => {
    // Re-tick immediately whenever the position changes (e.g. the very
    // first fix arriving can flip a clock-fallback resolution into a real
    // sun-based one -- must not wait for the next interval), AND on a
    // regular interval so a boundary crossing is caught even with the
    // vehicle stationary / no fresh fix arriving.
    tick(new Date(), geoPosition);
    const interval = window.setInterval(() => tick(new Date(), geoPosition), TICK_INTERVAL_MS);
    return () => window.clearInterval(interval);
    // `geoPosition` is a fresh object each render, so this effect re-runs
    // (and re-arms the interval) on every position update -- exactly the
    // "tick immediately on new position" behaviour described above.
  }, [tick, geoPosition?.lat, geoPosition?.lon]);

  return null;
}
