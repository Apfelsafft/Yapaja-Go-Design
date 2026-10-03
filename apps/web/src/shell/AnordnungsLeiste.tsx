/**
 * Die Leiste im Bearbeitungsmodus: was gerade angepasst wird, Zurücksetzen,
 * Fertig. Oben in der Mitte, über allem.
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { useAnordnungStore } from './anordnung.js';

export default function AnordnungsLeiste(): React.ReactElement | null {
  const bearbeiten = useAnordnungStore((s) => s.bearbeiten);
  const beende = useAnordnungStore((s) => s.beende);
  const zuruecksetzen = useAnordnungStore((s) => s.zuruecksetzen);
  if (!bearbeiten) return null;

  return createPortal(
    <div
      role="toolbar"
      aria-label="Bildschirm anpassen"
      className="fixed left-1/2 top-3 z-[70] flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-2xl bg-slate-900/95 px-4 py-2 text-sm text-white shadow-xl"
      data-testid="anordnung-leiste"
    >
      <span className="font-semibold">
        {bearbeiten === 'fahrt' ? 'Navigation' : 'Ruhe & Planung'} anpassen
      </span>
      <span className="text-xs text-slate-300">Ziehen verschiebt · blauer Punkt: Größe · Fadenkreuz: Position</span>
      <button
        type="button"
        onClick={() => zuruecksetzen(bearbeiten)}
        className="rounded-full bg-slate-700 px-3 py-1.5 hover:bg-slate-600"
        data-testid="anordnung-zuruecksetzen"
      >
        Zurücksetzen
      </button>
      <button
        type="button"
        onClick={beende}
        className="rounded-full bg-blue-600 px-4 py-1.5 font-semibold hover:bg-blue-700"
        data-testid="anordnung-fertig"
      >
        Fertig
      </button>
    </div>,
    document.getElementById('yapaia-sicht') ?? document.body,
  );
}
