/**
 * Mounts the Speed-Lock controller (E07-T4): loads the persisted threshold
 * once at boot. Mirrors `theme/ThemeController.tsx`'s "one initializer
 * component per subsystem, mounted once at the app root" convention. Renders
 * nothing -- the live speed mirror + passenger-override state machine live
 * in `driveLockStore.ts` itself (module-scope subscription, no React needed
 * for that part).
 */

import { useEffect } from 'react';
import { useDriveLockStore } from './driveLockStore.js';

export default function DriveLockController(): null {
  const init = useDriveLockStore((state) => state.init);

  useEffect(() => {
    void init();
    // Stable store action, deliberately omitted from deps (see
    // ThemeController.tsx's identical `init()` effect for the same rationale).
  }, []);

  return null;
}
