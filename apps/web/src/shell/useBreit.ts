/**
 * Ob neben dem Seitenpanel noch genug Karte bleibt, um ein HOHES Fenster
 * (Routen-Zustand) dort abzustellen.
 *
 * Die Kopfzeile ist niedrig und darf schon ab Tablet-Breite an der Seite
 * stehen. Das Routen-Fenster reicht bis zum unteren Rand -- bei 768 Punkten
 * (Tablet hochkant) laege es mit 380 Punkten über der Kartenmitte, und jede
 * Geste dort traefe das Fenster. Darunter bleibt es das Blatt von unten.
 */

import { useEffect, useState } from 'react';

/** 380 Punkte Panel + mindestens 580 Punkte Karte. */
export const BREIT_MIN_PX = 960;

const ABFRAGE = `(min-width: ${BREIT_MIN_PX}px)`;

function jetzt(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(ABFRAGE).matches;
}

export function useBreit(): boolean {
  const [breit, setBreit] = useState(jetzt);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const liste = window.matchMedia(ABFRAGE);
    const beiWechsel = (e: MediaQueryListEvent): void => setBreit(e.matches);
    setBreit(liste.matches);
    liste.addEventListener('change', beiWechsel);
    return () => liste.removeEventListener('change', beiWechsel);
  }, []);
  return breit;
}
