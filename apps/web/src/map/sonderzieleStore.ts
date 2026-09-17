/**
 * Der Zustand der Sonderziele aus dem Suchindex.
 *
 * ─── WARUM NEBEN DEN PUNKTEN EIN BEFUND LIEGT ───────────────────────────────
 * Weil eine Karte ohne Entsorgungssymbol dreierlei heißen kann: es gibt hier
 * keine, der Suchindex wurde nie gebaut, oder er ist zu alt. Für jemanden mit
 * vollem Abwassertank sind das drei verschiedene Auskünfte, und nur bei zwei
 * davon kann er etwas tun.
 *
 * Die Punkte allein könnte die Kartenebene selbst holen. Was sie nicht
 * könnte, ist sagen, dass sie unvollständig sind.
 */

import { create } from 'zustand';
import {
  holeSonderziele,
  SONDERZIELE_LEER,
  type SonderzielBefund,
  type SonderzielMerkmal,
} from './sonderzieleClient.js';

export interface SonderzieleState {
  merkmale: SonderzielMerkmal[];
  befund: SonderzielBefund;
  /** Gesetzt, wenn der Abruf selbst scheiterte. */
  fehler: string | null;
  laeuft: boolean;
  /** `true`, sobald einmal etwas ankam — auch wenn es nichts war. */
  geladen: boolean;

  abrufen: () => Promise<void>;
}

export const useSonderzieleStore = create<SonderzieleState>((set, get) => ({
  merkmale: [],
  befund: SONDERZIELE_LEER.befund,
  fehler: null,
  laeuft: false,
  geladen: false,

  abrufen: async () => {
    // Einmal reicht. Die Sonderziele ändern sich nur, wenn jemand den
    // Suchindex neu baut — und dann wird die Seite ohnehin neu geladen.
    // Ohne diese Sperre fragte jeder Wiederaufbau der Ebene erneut.
    if (get().laeuft || get().geladen) return;

    set({ laeuft: true });
    try {
      const antwort = await holeSonderziele();
      set({
        merkmale: antwort.features,
        befund: antwort.befund,
        fehler: null,
        laeuft: false,
        geladen: true,
      });
    } catch (fehler) {
      // `geladen` bleibt FALSCH: ein gescheiterter Abruf darf sich nicht als
      // erledigt ausgeben, sonst wird er nie wiederholt.
      set({
        laeuft: false,
        fehler: fehler instanceof Error ? fehler.message : String(fehler),
      });
    }
  },
}));
