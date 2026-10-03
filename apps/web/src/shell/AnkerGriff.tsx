/**
 * Im Bildschirm-Anpassen: die eigene Position verschieben.
 *
 * Gewünscht: „Wenn man den Bildschirm anpasst, soll man auch die aktuelle
 * Position verschieben können. Also wo sie sich auf der Karte zentriert."
 *
 * Ein Fadenkreuz über der Karte, dort, wo die Position sitzt. Ziehen setzt
 * den Anker (`map/kartenAnker.ts`); `DriveModeController` legt daraufhin die
 * Ränder der Karte neu und rückt die Position an die neue Stelle -- man sieht
 * also sofort, wie es wirkt. „Zurücksetzen" in der Leiste holt den Standard
 * zurück.
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAnordnungStore } from './anordnung.js';
import { useHandednessStore } from './handednessStore.js';
import { ANKER_ID, ankerFuer, begrenzeAnker } from '../map/kartenAnker.js';
import { useMapStore } from '../state/mapStore.js';

export default function AnkerGriff(): React.ReactElement | null {
  const bearbeiten = useAnordnungStore((s) => s.bearbeiten);
  const eintraege = useAnordnungStore((s) => (s.bearbeiten ? s.werte[s.bearbeiten] : undefined));
  const setze = useAnordnungStore((s) => s.setze);
  const einbau = useHandednessStore((s) => s.handedness);
  const map = useMapStore((s) => s.map);
  const ziehen = useRef(false);
  // Die Karte kann sich verschieben (Drehen, Fenster) -- dann neu messen.
  const [, setTick] = useState(0);
  useEffect(() => {
    const neu = (): void => setTick((t) => t + 1);
    window.addEventListener('resize', neu);
    return () => window.removeEventListener('resize', neu);
  }, []);

  if (!bearbeiten || !map) return null;
  const rahmen = map.getContainer().getBoundingClientRect();
  if (rahmen.width <= 0 || rahmen.height <= 0) return null;
  const anker = ankerFuer(eintraege, bearbeiten, einbau);

  const setzeAus = (e: React.PointerEvent): void => {
    const r = map.getContainer().getBoundingClientRect();
    const a = begrenzeAnker({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
    // `dx`/`dy` tragen hier Anteile, siehe `kartenAnker.ts`.
    setze(bearbeiten, ANKER_ID, { dx: Math.round(a.x * 1000) / 1000, dy: Math.round(a.y * 1000) / 1000, s: 1 });
  };

  return createPortal(
    <div
      role="slider"
      aria-label="Position auf der Karte verschieben"
      aria-valuetext={`${Math.round(anker.x * 100)} % von links, ${Math.round(anker.y * 100)} % von oben`}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        ziehen.current = true;
      }}
      onPointerMove={(e) => {
        if (!ziehen.current) return;
        e.preventDefault();
        setzeAus(e);
      }}
      onPointerUp={(e) => {
        if (ziehen.current) setzeAus(e);
        ziehen.current = false;
      }}
      onPointerCancel={() => {
        ziehen.current = false;
      }}
      className="fixed z-[65] flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 cursor-move touch-none items-center justify-center rounded-full border-2 border-dashed border-blue-500 bg-blue-500/15"
      style={{ left: rahmen.left + anker.x * rahmen.width, top: rahmen.top + anker.y * rahmen.height }}
      data-testid="anordnung-anker"
    >
      <span className="pointer-events-none absolute h-px w-12 bg-blue-500" aria-hidden="true" />
      <span className="pointer-events-none absolute h-12 w-px bg-blue-500" aria-hidden="true" />
      <span className="pointer-events-none absolute top-full mt-1 whitespace-nowrap rounded bg-slate-900/90 px-2 py-0.5 text-xs text-white">
        Position
      </span>
    </div>,
    document.body,
  );
}
