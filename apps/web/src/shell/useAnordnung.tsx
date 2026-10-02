/**
 * Ein Element verschiebbar und skalierbar machen (`anordnung.ts`).
 *
 *   const a = useAnordnung('trip-info');
 *   <div ref={a.ref} …>… {a.griff}</div>
 *
 * Verschoben wird über die CSS-Eigenschaften `translate` und `scale`, NICHT
 * über `transform`: viele Elemente zentrieren sich mit Tailwinds
 * `-translate-x-1/2`, und das IST ein `transform`. Ein eigener `transform`
 * hätte es überschrieben; `translate`/`scale` setzen sich darauf.
 *
 * Im Bearbeitungsmodus liegt über dem Element ein Griff: ziehen verschiebt,
 * die Ecke unten ändert die Größe. Tipps auf das Element selbst gehen dann
 * nicht durch -- man soll beim Anordnen nicht aus Versehen „Stopp" drücken.
 */

import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useFahrtAnsicht } from '../drive/useFahrtAnsicht.js';
import { STANDARD, begrenzeMassstab, useAnordnungStore, type Modus, type Platz } from './anordnung.js';

/** So viel vom Element muss sichtbar bleiben, in Bildschirmpunkten. */
const SICHTBAR_MIN_PX = 48;

function sichtRahmen(): DOMRect {
  const sicht = typeof document !== 'undefined' ? document.getElementById('yapaia-sicht') : null;
  return sicht ? sicht.getBoundingClientRect() : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
}

export interface Anordnung {
  ref: (el: HTMLElement | null) => void;
  griff: React.ReactNode;
  /** Die gespeicherte Verschiebung -- für Elemente, die einem anderen folgen. */
  platz: Platz;
}

export function useAnordnung(id: string, modusFest?: Modus): Anordnung {
  const fahrt = useFahrtAnsicht();
  const modus: Modus = modusFest ?? (fahrt ? 'fahrt' : 'ruhe');
  const platz = useAnordnungStore((s) => s.werte[modus][id]) ?? STANDARD;
  const bearbeiten = useAnordnungStore((s) => s.bearbeiten === modus);
  const setze = useAnordnungStore((s) => s.setze);
  const element = useRef<HTMLElement | null>(null);
  // Korrektur, damit das Element nach Drehung/Fenstergröße im Bild bleibt.
  // Nur angezeigt, nicht gespeichert: dreht man zurück, stimmt es wieder.
  const [korrektur, setKorrektur] = useState({ x: 0, y: 0 });

  const ref = useCallback((el: HTMLElement | null) => {
    element.current = el;
  }, []);

  // Bei Drehung/Fenstergroesse neu pruefen.
  const [, setTick] = useState(0);
  useLayoutEffect(() => {
    const neu = (): void => setTick((t) => t + 1);
    window.addEventListener('resize', neu);
    return () => window.removeEventListener('resize', neu);
  }, []);

  const dx = platz.dx + korrektur.x;
  const dy = platz.dy + korrektur.y;

  // Direkt am Element gesetzt statt ueber `style`: so muss keine Komponente
  // ihren eigenen Stil mit diesem zusammenfuehren. Laeuft nach jedem
  // Rendern -- ein Element, das erst spaeter erscheint, bekommt es so auch.
  useLayoutEffect(() => {
    const el = element.current;
    if (!el) return;
    const veraendert = dx !== 0 || dy !== 0 || platz.s !== 1;
    el.style.translate = veraendert ? `${dx}px ${dy}px` : '';
    el.style.scale = veraendert ? String(platz.s) : '';
    el.style.zIndex = bearbeiten ? '60' : '';
    if (bearbeiten) el.style.pointerEvents = 'auto';
    else el.style.pointerEvents = '';
    if (!veraendert) {
      if (korrektur.x !== 0 || korrektur.y !== 0) setKorrektur({ x: 0, y: 0 });
      return;
    }

    // Erst NACH dem Setzen messen: liegt das Element zu weit draussen, wird
    // es so weit zurueckgeholt, dass SICHTBAR_MIN_PX davon zu sehen bleiben.
    const r = el.getBoundingClientRect();
    const sicht = sichtRahmen();
    let x = 0;
    let y = 0;
    if (r.right < sicht.left + SICHTBAR_MIN_PX) x = sicht.left + SICHTBAR_MIN_PX - r.right;
    if (r.left > sicht.right - SICHTBAR_MIN_PX) x = sicht.right - SICHTBAR_MIN_PX - r.left;
    if (r.bottom < sicht.top + SICHTBAR_MIN_PX) y = sicht.top + SICHTBAR_MIN_PX - r.bottom;
    if (r.top > sicht.bottom - SICHTBAR_MIN_PX) y = sicht.bottom - SICHTBAR_MIN_PX - r.top;
    if (Math.abs(x) >= 1 || Math.abs(y) >= 1) setKorrektur((k) => ({ x: k.x + x, y: k.y + y }));
  });

  const griff = bearbeiten ? (
    <Griff
      id={id}
      platz={platz}
      onPlatz={(p) => {
        setKorrektur({ x: 0, y: 0 });
        setze(modus, id, p);
      }}
    />
  ) : null;

  return { ref, griff, platz };
}

function Griff({ id, platz, onPlatz }: { id: string; platz: Platz; onPlatz: (p: Platz) => void }): React.ReactElement {
  const start = useRef<{ x: number; y: number; p: Platz; art: 'ziehen' | 'groesse' } | null>(null);

  const runter = (art: 'ziehen' | 'groesse') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, p: platz, art };
  };
  const bewegen = (e: React.PointerEvent): void => {
    const s = start.current;
    if (!s) return;
    e.preventDefault();
    e.stopPropagation();
    const ddx = e.clientX - s.x;
    const ddy = e.clientY - s.y;
    if (s.art === 'ziehen') {
      onPlatz({ ...s.p, dx: Math.round(s.p.dx + ddx / 1), dy: Math.round(s.p.dy + ddy / 1) });
    } else {
      // Nach rechts unten größer, nach links oben kleiner; 200 Punkte = +100 %.
      onPlatz({ ...s.p, s: Math.round(begrenzeMassstab(s.p.s + (ddx + ddy) / 400) * 100) / 100 });
    }
  };
  const hoch = (e: React.PointerEvent): void => {
    start.current = null;
    e.stopPropagation();
  };
  const schlucken = (e: React.SyntheticEvent): void => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <span
      role="presentation"
      onPointerDown={runter('ziehen')}
      onPointerMove={bewegen}
      onPointerUp={hoch}
      onPointerCancel={hoch}
      onClick={schlucken}
      className="pointer-events-auto absolute inset-0 z-[61] cursor-move touch-none rounded-[inherit] outline-dashed outline-2 outline-offset-2 outline-blue-500"
      style={{ background: 'rgba(59,130,246,0.12)' }}
      data-testid={`anordnung-griff-${id}`}
    >
      <span
        role="presentation"
        onPointerDown={runter('groesse')}
        onPointerMove={bewegen}
        onPointerUp={hoch}
        onPointerCancel={hoch}
        onClick={schlucken}
        className="pointer-events-auto absolute -bottom-3 -right-3 h-7 w-7 cursor-nwse-resize touch-none rounded-full border-2 border-white bg-blue-600 shadow"
        data-testid={`anordnung-groesse-${id}`}
        aria-label="Größe ändern"
      />
    </span>
  );
}
