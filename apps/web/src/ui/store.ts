/**
 * UI state store (E03-T6): manages visibility of various UI panels.
 * RegionsPanel open/close for E03-T6 coverage-check error handling; the
 * add-on StorePanel (E09-T7) mirrors the exact same shape so any future
 * caller can programmatically open it (e.g. a "no compatible add-on"
 * notice elsewhere in the app) the same way RoutingPanel already does for
 * RegionsPanel.
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

  /** Whether the add-on StorePanel (E09-T7) should be open. */
  addonStorePanel: {
    isOpen: boolean;
  };
  /** Opens the add-on StorePanel. */
  openAddonStorePanel: () => void;
  /** Closes the add-on StorePanel. */
  closeAddonStorePanel: () => void;
  /** Toggles the add-on StorePanel. */
  toggleAddonStorePanel: () => void;
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

  addonStorePanel: {
    isOpen: false,
  },

  openAddonStorePanel: () => {
    set({ addonStorePanel: { isOpen: true } });
  },

  closeAddonStorePanel: () => {
    set({ addonStorePanel: { isOpen: false } });
  },

  toggleAddonStorePanel: () => {
    set((state) => ({
      addonStorePanel: { isOpen: !state.addonStorePanel.isOpen },
    }));
  },
}));
