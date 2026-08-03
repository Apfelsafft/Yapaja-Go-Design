/**
 * Race-free "run this once the map style can accept sources/layers" helper
 * (E10-T1).
 *
 * THE BUG THIS REPLACES (found while de-flaking `gps-loss.spec.ts`, and a
 * real product defect, not just a test problem):
 *
 * Both `PositionPuck.tsx` and `RouteLayer.tsx` guarded their `addSource`/
 * `addLayer` calls with
 *
 *     if (map.isStyleLoaded()) setup();
 *     else map.once('load', setup);
 *
 * which loses the race whenever the effect first runs AFTER the map's `load`
 * event has already fired. That window is reachable in practice because:
 *
 *  - `MapView` registers the Map instance in the store synchronously, but
 *    `PositionPuck`/`RouteLayer` react to it from a PASSIVE effect
 *    (`useEffect`), which React schedules asynchronously — under CPU
 *    contention (the N100 target device, or a loaded CI box) that can be
 *    tens of milliseconds later; and
 *  - `map.isStyleLoaded()` is NOT "the style JSON is parsed". MapLibre
 *    implements it as `Style.loaded()`, which additionally requires every
 *    tile manager AND the image manager to be finished
 *    (maplibre-gl 5.24.0, `Style.loaded()`), so it reads `false` for a
 *    while after `style.load`/`load` have already fired — and indefinitely
 *    when tiles are unavailable (offline, dummy/empty archive).
 *
 * Land in that window and the old code registered a one-shot `load`
 * listener for an event that had already happened: `setup()` then NEVER ran,
 * so the position puck (and the route line) were **permanently missing** for
 * the whole session. Measured before this fix with a probe spec: 6 of 12
 * parallel cold starts ended with `hasPuckLayer:false` while `mapLoaded:true`
 * — i.e. a fully loaded map with no puck on it.
 *
 * THE FIX: subscribe FIRST, then attempt — and make the attempt itself the
 * readiness test. `setup` is required to be idempotent (every caller already
 * early-returns when its source exists), so it is simply retried on
 * `styledata`/`load` until it goes through. Only MapLibre's specific
 * "not done loading" rejection is swallowed; any other error from `setup`
 * is a genuine bug and propagates.
 *
 * Retrying on `styledata` (rather than only the one-shot `load`) also means
 * a later live style switch (`styleSwitch.ts#applyStyle`) re-runs `setup`,
 * so custom layers are restored even if a future style swap ever stopped
 * merging them forward.
 */

import type { Map as MapLibreMap } from 'maplibre-gl';

/** MapLibre's exact rejection from `Style._checkLoaded()` (maplibre-gl 5.24.0). */
const STYLE_NOT_LOADED_MESSAGE = 'Style is not done loading.';

/**
 * Runs `setup` as soon as the style accepts `addSource`/`addLayer`, and
 * again after every later style (re)load.
 *
 * `setup` MUST be idempotent — it is called more than once by design.
 *
 * @returns an unsubscribe function for the effect cleanup.
 */
export function runWhenStyleReady(map: MapLibreMap, setup: () => void): () => void {
  const trySetup = (): void => {
    try {
      setup();
    } catch (err) {
      if (err instanceof Error && err.message === STYLE_NOT_LOADED_MESSAGE) {
        // Genuinely too early — a later styledata/load event retries.
        return;
      }
      throw err;
    }
  };

  // Subscribe BEFORE the first attempt so no event can slip through in
  // between; `trySetup` is idempotent, so a double-run is harmless.
  map.on('styledata', trySetup);
  map.on('load', trySetup);
  trySetup();

  return () => {
    map.off('styledata', trySetup);
    map.off('load', trySetup);
  };
}

export { STYLE_NOT_LOADED_MESSAGE };
