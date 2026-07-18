/**
 * Mounts the handedness controller (E07-T4): loads the persisted LHD/RHD
 * choice once at boot. Mirrors `theme/ThemeController.tsx`'s "one
 * initializer component per subsystem" convention.
 */

import { useEffect } from 'react';
import { useHandednessStore } from './handednessStore.js';

export default function HandednessController(): null {
  const init = useHandednessStore((state) => state.init);

  useEffect(() => {
    void init();
  }, []);

  return null;
}
