/**
 * Die installierten Kartenregionen und die ausdrueckliche Wahl des
 * Betreibers.
 *
 * Getrennt von `MapView` gehalten, weil zwei weitere Stellen sie brauchen:
 * die Umschaltung im Kartenmenue (`StylePanel`) und der Hinweis, wenn die
 * eigene Position in keiner installierten Region liegt
 * (`RegionCoverageNotice`). Ohne einen gemeinsamen Ort muesste `MapView`
 * beides als Requisite durchreichen — durch drei Ebenen, die damit sonst
 * nichts zu tun haben.
 *
 * Die manuelle Wahl wird ABSICHTLICH nicht in localStorage gelegt. Eine
 * Region, die man einmal fuer eine Reiseplanung gewaehlt hat, darf beim
 * naechsten Start nicht stillschweigend weitergelten: dann sitzt man im
 * Fahrzeug, die Karte zeigt die falsche Gegend, und nichts erklaert warum.
 * Nach einem Neustart entscheidet wieder die Position.
 */

import { create } from 'zustand';
import type { MapRegionSummary } from './regions';

interface RegionState {
  /** Alle installierten Regionen, wie der Core sie meldet. */
  regions: MapRegionSummary[];
  /** Ausdruecklich gewaehlte Region (Name), oder `null` = automatisch. */
  manual: string | null;
  setRegions: (regions: MapRegionSummary[]) => void;
  /** `null` gibt die Automatik zurueck (Position entscheidet). */
  setManual: (region: string | null) => void;
}

export const useRegionStore = create<RegionState>((set) => ({
  regions: [],
  manual: null,
  setRegions: (regions) => set({ regions }),
  setManual: (manual) => set({ manual }),
}));
