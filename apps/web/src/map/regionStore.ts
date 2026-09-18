/**
 * Die installierten Kartenregionen.
 *
 * Getrennt von `MapView` gehalten, weil `RegionCoverageNotice` sie ebenfalls
 * braucht — fuer den Hinweis, wenn die eigene Position in keiner
 * installierten Region liegt. Ohne einen gemeinsamen Ort muesste `MapView`
 * sie als Requisite durchreichen, durch Ebenen, die damit sonst nichts zu tun
 * haben.
 *
 * ─── HIER STAND AUCH DIE AUSDRUECKLICHE WAHL DES BETREIBERS ─────────────────
 * `manual` ist in 0.16.0 entfallen. Gewuenscht:
 *
 *   „Auch die Auswahl der Region ist dann unnoetig da ja immer alles
 *    angezeigt wird."
 *
 * Die Wahl konnte nur eines: die Karte auf EINE Region verkleinern. Sie
 * stehenzulassen und bloss nicht mehr anzuzeigen, waere der schlechtere Weg —
 * ein Zustand, den nichts mehr setzt, den aber alles noch liest, ist eine
 * Falle fuer den Naechsten.
 */

import { create } from 'zustand';
import type { MapRegionSummary } from './regions';

interface RegionState {
  /** Alle installierten Regionen, wie der Core sie meldet. */
  regions: MapRegionSummary[];
  setRegions: (regions: MapRegionSummary[]) => void;
}

export const useRegionStore = create<RegionState>((set) => ({
  regions: [],
  setRegions: (regions) => set({ regions }),
}));
