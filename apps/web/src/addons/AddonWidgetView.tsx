/**
 * Renders ONE add-on widget's live data from `useAddonWidgetStore`. Used both
 * by `AddonWidgetLayer` (slot rendering on the main app) and as the `render`
 * of the stub Widget registered into the shell `WidgetRegistry` (so an add-on
 * widget also appears in the widget library, identical to a core widget --
 * docs/05 §4). Deliberately tiny + presentational.
 */

import React from 'react';
import { useAddonWidgetStore } from './addonWidgetStore.js';

const SEVERITY_CLASS: Record<string, string> = {
  info: 'border-sky-400 text-sky-100',
  warn: 'border-amber-400 text-amber-100',
  critical: 'border-red-500 text-red-100',
};

export default function AddonWidgetView({ id }: { id: string }): React.ReactElement | null {
  const entry = useAddonWidgetStore((state) => state.widgets[id]);
  if (!entry) return null;
  const severity = typeof entry.data.severity === 'string' ? entry.data.severity : 'info';
  const cls = SEVERITY_CLASS[severity] ?? SEVERITY_CLASS.info;
  return (
    <div
      data-testid={`addon-widget-${id}`}
      data-addon-id={entry.addonId}
      className={`pointer-events-auto rounded border bg-slate-900/85 px-2 py-1 text-xs font-medium shadow ${cls}`}
      role="group"
      aria-label={entry.name}
    >
      <span className="opacity-70">{entry.name}: </span>
      <span data-testid={`addon-widget-text-${id}`}>{typeof entry.data.text === 'string' ? entry.data.text : ''}</span>
    </div>
  );
}
