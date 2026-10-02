/**
 * Der gerade gewählte Ort (Zustand 3 aus `docs/entwurf-ui-umbau.md`).
 *
 * Gesetzt von einem Tipp auf einen Pin (`DestinationSelector`), angezeigt
 * von `OrtKarte` im Seitenpanel. Nicht gespeichert: ein neu geladenes
 * Fenster soll keine Karte zu einem Ort zeigen, den niemand mehr meint.
 */

import { create } from 'zustand';

export interface GewaehlterOrt {
  lat: number;
  lon: number;
  name: string | null;
  /** Deutscher Name der Kategorie, z. B. „Wohnmobilstellplatz". */
  kategorie: string | null;
  /** Sprite-Name des Symbols, falls bekannt (`poi-wohnmobil` …). */
  symbol: string | null;
  adresse: string | null;
}

interface OrtState {
  ort: GewaehlterOrt | null;
  oeffne: (ort: GewaehlterOrt) => void;
  schliesse: () => void;
}

export const useOrtStore = create<OrtState>((set) => ({
  ort: null,
  oeffne: (ort) => set({ ort }),
  schliesse: () => set({ ort: null }),
}));
