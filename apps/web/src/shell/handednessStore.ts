/**
 * Handedness (LHD/RHD FAB-mirroring) store (E07-T4). Mirrors
 * `theme/themeStore.ts`'s boot-load + persisted-setter shape, minus the
 * resolution/tick machinery theme needs (handedness has no time/position
 * dependency -- it's a plain persisted choice).
 */

import { create } from 'zustand';
import { DEFAULT_HANDEDNESS, type Handedness } from './handedness.js';
import { loadHandedness, patchServerHandedness, saveLocalHandedness } from './handednessClient.js';

interface HandednessStoreState {
  handedness: Handedness;
  ready: boolean;
  init: () => Promise<void>;
  setHandedness: (value: Handedness) => void;
}

export const useHandednessStore = create<HandednessStoreState>((set) => ({
  handedness: DEFAULT_HANDEDNESS,
  ready: false,

  init: async () => {
    const handedness = await loadHandedness();
    set({ handedness, ready: true });
  },

  setHandedness: (handedness) => {
    set({ handedness });
    saveLocalHandedness(handedness);
    void patchServerHandedness(handedness);
  },
}));

declare global {
  interface Window {
    /** Debug/E2E hook, mirrors `window.__yapajaThemeStore`. */
    __yapajaHandednessStore?: typeof useHandednessStore;
  }
}

if (typeof window !== 'undefined') {
  window.__yapajaHandednessStore = useHandednessStore;
}
