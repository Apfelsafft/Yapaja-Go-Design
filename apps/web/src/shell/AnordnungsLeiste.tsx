/**
 * Die Leiste im Bearbeitungsmodus: was gerade angepasst wird, Zurücksetzen,
 * Fertig. Oben in der Mitte, über allem.
 */

import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAnordnungStore } from './anordnung.js';

export default function AnordnungsLeiste(): React.ReactElement | null {
  const bearbeiten = useAnordnungStore((s) => s.bearbeiten);
  const beende = useAnordnungStore((s) => s.beende);
  const zuruecksetzen = useAnordnungStore((s) => s.zuruecksetzen);
  // Verschiebbar: gemeldet „liegt über der Suche und dem Chips-Bereich --
  // damit kann man die Positionen nicht verändern". Am Griff ⠿ ziehen.
  const [platz, setPlatz] = useState<{ x: number; y: number } | null>(null);
  const zug = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const leiste = useRef<HTMLDivElement | null>(null);
  if (!bearbeiten) return null;

  const griffRunter = (e: React.PointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const r = leiste.current?.getBoundingClientRect();
    zug.current = { x: e.clientX, y: e.clientY, px: r?.left ?? 0, py: r?.top ?? 0 };
  };
  const griffZiehen = (e: React.PointerEvent): void => {
    const z = zug.current;
    if (!z) return;
    e.preventDefault();
    const r = leiste.current?.getBoundingClientRect();
    const b = r?.width ?? 200;
    const h = r?.height ?? 60;
    setPlatz({
      x: Math.min(window.innerWidth - b, Math.max(0, z.px + e.clientX - z.x)),
      y: Math.min(window.innerHeight - h, Math.max(0, z.py + e.clientY - z.y)),
    });
  };
  const griffHoch = (): void => {
    zug.current = null;
  };

  return createPortal(
    <div
      ref={leiste}
      role="toolbar"
      aria-label="Bildschirm anpassen"
      className={`fixed z-[70] flex max-w-[calc(100vw-1rem)] flex-wrap items-center gap-2 rounded-2xl bg-slate-900/95 px-3 py-2 text-sm text-white shadow-xl ${
        platz ? '' : 'left-1/2 top-3 -translate-x-1/2'
      }`}
      style={platz ? { left: platz.x, top: platz.y } : undefined}
      data-testid="anordnung-leiste"
    >
      <span
        role="presentation"
        onPointerDown={griffRunter}
        onPointerMove={griffZiehen}
        onPointerUp={griffHoch}
        onPointerCancel={griffHoch}
        className="flex h-9 w-7 cursor-move touch-none items-center justify-center rounded text-lg text-slate-300 hover:bg-slate-700"
        title="Leiste verschieben"
        aria-label="Leiste verschieben"
        data-testid="anordnung-leiste-griff"
      >
        ⠿
      </span>
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
