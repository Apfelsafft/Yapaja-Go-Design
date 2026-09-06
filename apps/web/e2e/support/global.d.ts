/**
 * Editor/IDE convenience only: mirrors the `Window.__yapaiaMapController`
 * ambient declaration from `../../src/map/MapView.tsx` so spec files that
 * reference `window.__yapaiaMapController` resolve without a red squiggle.
 * Not part of any `tsc --noEmit` program (e2e/ isn't included by
 * apps/web/tsconfig.json), so this has no effect on `pnpm typecheck`.
 */

import type { mapController } from '../../src/state/mapStore';
import type { usePositionStore } from '../../src/position/positionStore';
import type { useRoutingStore } from '../../src/routing/store';
import type { useProfileStore } from '../../src/profiles/store';
import type { useNavStore } from '../../src/drive/navStore';
import type { useShellWsStore } from '../../src/shell/wsStore';
import type { useLayoutStore } from '../../src/shell/layoutStore';
import type { usePwaStore } from '../../src/pwa/pwaStore';

declare global {
  interface Window {
    __yapaiaMapController?: typeof mapController;
    __yapaiaPositionStore?: typeof usePositionStore;
    __yapaiaRoutingStore?: typeof useRoutingStore;
    __yapaiaProfileStore?: typeof useProfileStore;
    __yapaiaNavStore?: typeof useNavStore;
    __yapaiaSpeechAvailable?: () => boolean;
    __yapaiaShellWsStore?: typeof useShellWsStore;
    __yapaiaShellLayoutStore?: typeof useLayoutStore;
    __yapaiaPwaStore?: typeof usePwaStore;
  }
}

export {};
