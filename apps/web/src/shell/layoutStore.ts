/**
 * Layout store (E07-T1): holds the reconciled per-mode layouts in memory and
 * persists any change (debounced) to both localStorage and the server --
 * see `persistence.ts`.
 *
 * E07-T1 ships no drag-and-drop editor yet (that's E07-T2's "Edit-Modus");
 * `replaceModeLayout` below is the minimal mutator this task needs so the
 * reload-persistence acceptance criterion is provable end-to-end (a change
 * saves itself immediately rather than requiring an explicit "save" button
 * -- E07-T2 will likely gate that behind its own explicit save/cancel flow,
 * which is additive on top of this, not a replacement).
 */

import { create } from 'zustand';
import {
  defaultLayoutsSettingsValue,
  type LayoutsSettingsValue,
  type ModeLayout,
  type ShellMode,
  type SlotId,
  type WidgetInstance,
} from './layout.js';
import { loadAndReconcileLayouts, patchServerLayouts, saveLocalLayouts } from './persistence.js';

const SAVE_DEBOUNCE_MS = 250;

interface LayoutStoreState {
  layouts: LayoutsSettingsValue;
  /** True once `init()` has resolved (local+server reconciled) -- until
   *  then `layouts` holds the built-in defaults so the shell can render
   *  immediately without a loading flicker. */
  ready: boolean;

  init: () => Promise<void>;
  /** Replaces one mode's full slot layout, bumps its `updatedAt`, and
   *  persists (debounced) to local + server. */
  replaceModeLayout: (mode: ShellMode, slots: ModeLayout['slots']) => void;
  /** Convenience for tests/future editor code: sets one slot's widget list directly. */
  setSlotWidgets: (mode: ShellMode, slot: SlotId, widgets: WidgetInstance[]) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(layouts: LayoutsSettingsValue): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveLocalLayouts(layouts);
    void patchServerLayouts(layouts);
  }, SAVE_DEBOUNCE_MS);
}

export const useLayoutStore = create<LayoutStoreState>((set, get) => ({
  layouts: defaultLayoutsSettingsValue(),
  ready: false,

  init: async () => {
    const layouts = await loadAndReconcileLayouts();
    set({ layouts, ready: true });
  },

  replaceModeLayout: (mode, slots) => {
    const updated: ModeLayout = { mode, slots, updatedAt: Date.now() };
    const layouts = { ...get().layouts, [mode]: updated };
    set({ layouts });
    scheduleSave(layouts);
  },

  setSlotWidgets: (mode, slot, widgets) => {
    const current = get().layouts[mode];
    const slots = { ...current.slots, [slot]: widgets };
    get().replaceModeLayout(mode, slots);
  },
}));

declare global {
  interface Window {
    /** Debug/E2E hook, mirrors `window.__yapajaPositionStore`/`__yapajaNavStore`. */
    __yapajaShellLayoutStore?: typeof useLayoutStore;
  }
}

if (typeof window !== 'undefined') {
  window.__yapajaShellLayoutStore = useLayoutStore;
}
