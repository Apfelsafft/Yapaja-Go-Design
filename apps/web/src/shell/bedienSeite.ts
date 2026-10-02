/**
 * Auf welcher Seite die Bedienung liegt -- und auf welcher die Kartenknöpfe.
 *
 * Gewünscht (Vorbild Google Maps): „Im linken Drittel befinden sich die
 * Menüs und Suchen usw. Die rechten beiden Drittel sind frei für die Karte.
 * Je nach LHD oder RHD."
 *
 * Das Seitenpanel liegt auf der FAHRERSEITE, damit es vom Fahrersitz aus zu
 * erreichen ist: Linkslenker links, Rechtslenker rechts. Zoom, Zentrieren,
 * Übersicht und das Tempolimit-Schild nehmen die andere Seite.
 */

import { useHandednessStore } from './handednessStore.js';
import type { Handedness } from './handedness.js';

export type Seite = 'left' | 'right';

export function bedienSeiteFuer(h: Handedness): Seite {
  return h === 'lhd' ? 'left' : 'right';
}

export function kartenSeiteFuer(h: Handedness): Seite {
  return h === 'lhd' ? 'right' : 'left';
}

export function useBedienSeite(): Seite {
  return bedienSeiteFuer(useHandednessStore((s) => s.handedness));
}

export function useKartenSeite(): Seite {
  return kartenSeiteFuer(useHandednessStore((s) => s.handedness));
}

/** Breite des Seitenpanels auf großen Schirmen (Inhalt, ohne Rand). */
export const PANEL_BREITE_PX = 380;
