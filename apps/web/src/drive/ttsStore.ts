/**
 * TTS on/off toggle state (E04-T3, docs/06 §5: "TTS via Web Speech, an/aus").
 * Deliberately its own tiny store (not folded into `navStore`) -- it's UI
 * preference state, not anything the Core publishes.
 */

import { create } from 'zustand';

interface TtsStoreState {
  enabled: boolean;
  toggle: () => void;
  setEnabled: (enabled: boolean) => void;
}

export const useTtsStore = create<TtsStoreState>((set) => ({
  enabled: true,
  toggle: () => set((state) => ({ enabled: !state.enabled })),
  setEnabled: (enabled) => set({ enabled }),
}));

declare global {
  interface Window {
    __yapajaTtsStore?: typeof useTtsStore;
  }
}

if (typeof window !== 'undefined') {
  window.__yapajaTtsStore = useTtsStore;
}
