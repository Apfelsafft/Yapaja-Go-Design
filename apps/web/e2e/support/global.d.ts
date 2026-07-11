/**
 * Editor/IDE convenience only: mirrors the `Window.__yapajaMapController`
 * ambient declaration from `../../src/map/MapView.tsx` so spec files that
 * reference `window.__yapajaMapController` resolve without a red squiggle.
 * Not part of any `tsc --noEmit` program (e2e/ isn't included by
 * apps/web/tsconfig.json), so this has no effect on `pnpm typecheck`.
 */

import type { mapController } from '../../src/state/mapStore';
import type { usePositionStore } from '../../src/position/positionStore';
import type { useRoutingStore } from '../../src/routing/store';

declare global {
  interface Window {
    __yapajaMapController?: typeof mapController;
    __yapajaPositionStore?: typeof usePositionStore;
    __yapajaRoutingStore?: typeof useRoutingStore;
  }
}

export {};
