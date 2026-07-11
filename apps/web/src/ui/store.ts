/**
 * UI state store (E03-T6): manages visibility of various UI panels.
 * Currently: RegionsPanel open/close for E03-T6 coverage-check error handling.
 */

import { create } from 'zustand';

export interface UiState {
  /** Whether the RegionsPanel should be open. */
  regionsPanel: {
    isOpen: boolean;
  };
  /** Opens the RegionsPanel. */
  openRegionsPanel: () => void;
  /** Closes the RegionsPanel. */
  closeRegionsPanel: () => void;
  /** Toggles the RegionsPanel. */
  toggleRegionsPanel: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  regionsPanel: {
    isOpen: false,
  },

  openRegionsPanel: () => {
    set({ regionsPanel: { isOpen: true } });
  },

  closeRegionsPanel: () => {
    set({ regionsPanel: { isOpen: false } });
  },

  toggleRegionsPanel: () => {
    set((state) => ({
      regionsPanel: { isOpen: !state.regionsPanel.isOpen },
    }));
  },
}));
