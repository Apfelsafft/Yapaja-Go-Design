/**
 * Ist der Bildschirm schmal (Telefon hochkant)?
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Bisher habe ich immer auf einem 13-Zoll-iPad getestet und da ist GUI ganz
 * ok. Auf kleinen screens sieht es nicht mehr gut aus."
 *
 * ─── WARUM EIN HAKEN UND KEINE CSS-ABFRAGE ──────────────────────────────────
 * Weil die Positionen im Fahrmodus GERECHNET werden, nicht in Klassen stehen:
 * `mapControlLayout.ts` stapelt die rechte Spalte von unten und muss dafuer
 * wissen, ob unten noch eine Fahrtdaten-Leiste liegt. Eine reine CSS-Abfrage
 * koennte diese Rechnung nicht beeinflussen -- man muesste jede Zahl doppelt
 * pflegen, einmal in TypeScript und einmal in einer `@media`-Regel. Genau die
 * Art doppelter Wahrheit, an der dieses Layout schon einmal gescheitert ist.
 *
 * `matchMedia` statt `resize`: der Browser meldet nur den WECHSEL ueber die
 * Schwelle, nicht jeden einzelnen Bildpunkt. Waehrend einer Drehung sind das
 * ein Ereignis statt Dutzender.
 */

import { useEffect, useState } from 'react';
import { SCHMAL_MAX_PX } from './mapControlLayout.js';

const ABFRAGE = `(max-width: ${SCHMAL_MAX_PX}px)`;

function lesen(): boolean {
  // Serverseitig gerendert wird hier nichts, aber der Test-Renderer hat
  // teilweise kein `matchMedia`. Dann gilt „nicht schmal" -- das ist der
  // Zustand, der vor dieser Aenderung galt.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(ABFRAGE).matches;
}

export function useSchmal(): boolean {
  const [schmal, setSchmal] = useState<boolean>(lesen);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const liste = window.matchMedia(ABFRAGE);
    const beiWechsel = (e: MediaQueryListEvent): void => setSchmal(e.matches);
    // Beim Aufsetzen noch einmal lesen: zwischen dem ersten Rendern und
    // diesem Effekt kann sich die Breite geaendert haben (Drehung waehrend
    // des Ladens).
    setSchmal(liste.matches);
    liste.addEventListener('change', beiWechsel);
    return () => liste.removeEventListener('change', beiWechsel);
  }, []);

  return schmal;
}
