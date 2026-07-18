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
import type { useProfileStore } from '../../src/profiles/store';
import type { useNavStore } from '../../src/drive/navStore';
import type { useShellWsStore } from '../../src/shell/wsStore';
import type { useLayoutStore } from '../../src/shell/layoutStore';
import type { usePwaStore } from '../../src/pwa/pwaStore';

declare global {
  interface Window {
    __yapajaMapController?: typeof mapController;
    __yapajaPositionStore?: typeof usePositionStore;
    __yapajaRoutingStore?: typeof useRoutingStore;
    __yapajaProfileStore?: typeof useProfileStore;
    __yapajaNavStore?: typeof useNavStore;
    __yapajaSpeechAvailable?: () => boolean;
    __yapajaShellWsStore?: typeof useShellWsStore;
    __yapajaShellLayoutStore?: typeof useLayoutStore;
    __yapajaPwaStore?: typeof usePwaStore;
  }
}

export {};
