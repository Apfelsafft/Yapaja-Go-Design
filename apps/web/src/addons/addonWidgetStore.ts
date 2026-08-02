/**
 * Runtime registry of ADD-ON widgets (E09-T2, docs/05 §4). An add-on registers
 * a widget through the bridge (`widgets.register`, scope `widget.register`);
 * the host stores it here, keyed by its NAMESPACED id (`{addonId}/{widgetId}`)
 * so two add-ons can never collide and a disable can drop exactly one add-on's
 * widgets. `AddonWidgetLayer` renders these into their declared slots; the
 * bridge's `widgets.update` pushes new render data in live.
 *
 * This is intentionally separate from the drag-and-drop persisted layout
 * (E07-T2, core-widget customization): an add-on widget appears the moment the
 * add-on registers it and vanishes the moment it's disabled, with no user
 * layout edit required -- while still being registered into the shell
 * `WidgetRegistry` too (see `hostDeps.ts`) so it ALSO shows up in the widget
 * library exactly like a core widget (docs/05 §4 "identisch zu Core-Widgets").
 */

import { create } from 'zustand';
import type { WidgetData } from '@yapaja/addon-sdk';

export interface AddonWidgetEntry {
  addonId: string;
  /** Namespaced id: `{addonId}/{widgetId}`. */
  id: string;
  /** Add-on-local widget id (unnamespaced), as the add-on knows it. */
  widgetId: string;
  name: string;
  slots: string[];
  data: WidgetData;
}

interface AddonWidgetState {
  widgets: Record<string, AddonWidgetEntry>;
  register: (entry: AddonWidgetEntry) => void;
  update: (id: string, data: WidgetData) => void;
  removeAllForAddon: (addonId: string) => void;
}

export function namespacedWidgetId(addonId: string, widgetId: string): string {
  return `${addonId}/${widgetId}`;
}

export const useAddonWidgetStore = create<AddonWidgetState>((set) => ({
  widgets: {},
  register: (entry) => set((state) => ({ widgets: { ...state.widgets, [entry.id]: entry } })),
  update: (id, data) =>
    set((state) => {
      const existing = state.widgets[id];
      if (!existing) return state;
      return { widgets: { ...state.widgets, [id]: { ...existing, data: { ...existing.data, ...data } } } };
    }),
  removeAllForAddon: (addonId) =>
    set((state) => {
      const next: Record<string, AddonWidgetEntry> = {};
      for (const [id, entry] of Object.entries(state.widgets)) {
        if (entry.addonId !== addonId) next[id] = entry;
      }
      return { widgets: next };
    }),
}));
