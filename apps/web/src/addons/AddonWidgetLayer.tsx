/**
 * Renders every registered ADD-ON widget into its declared slot on the main
 * app (E09-T2, docs/05 §4). Add-on widgets appear the instant the add-on
 * registers them and vanish the instant the add-on is disabled (the store is
 * cleared by the bridge teardown) -- no user layout edit needed.
 *
 * Slot -> screen position mirrors the shell's slot vocabulary (`@yapaja/ui`
 * `SLOT_IDS`); an unknown slot falls back to top-right. Rendering is purely
 * presentational -- `AddonWidgetView` owns the per-widget live data.
 */

import React from 'react';
import { useAddonWidgetStore } from './addonWidgetStore.js';
import AddonWidgetView from './AddonWidgetView.js';

const SLOT_POSITION: Record<string, string> = {
  'top-bar': 'top-2 left-1/2 -translate-x-1/2',
  'bottom-bar': 'bottom-2 left-1/2 -translate-x-1/2',
  'side-panel': 'top-1/3 right-2',
  'bottom-drawer': 'bottom-16 left-1/2 -translate-x-1/2',
  'map-overlay-tl': 'top-16 left-2',
  'map-overlay-tr': 'top-16 right-2',
  'map-overlay-bl': 'bottom-16 left-2',
  'map-overlay-br': 'bottom-16 right-2',
  'settings': 'top-16 right-2',
};

function positionFor(slots: string[]): string {
  const slot = slots[0];
  return (slot && SLOT_POSITION[slot]) ?? SLOT_POSITION['map-overlay-tr'];
}

export default function AddonWidgetLayer(): React.ReactElement | null {
  const widgets = useAddonWidgetStore((state) => state.widgets);
  const entries = Object.values(widgets);
  if (entries.length === 0) return null;
  return (
    <div data-testid="addon-widget-layer" className="pointer-events-none">
      {entries.map((entry) => (
        <div key={entry.id} className={`absolute z-30 ${positionFor(entry.slots)}`} data-addon-widget-slot={entry.slots[0] ?? ''}>
          <AddonWidgetView id={entry.id} />
        </div>
      ))}
    </div>
  );
}
