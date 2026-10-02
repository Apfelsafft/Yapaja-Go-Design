/**
 * Zustand des Sprachfensters: offen, hört zu, Gesprächsverlauf.
 * Führt die Aktionen aus, die der Kern zurückgibt.
 */

import { create } from 'zustand';
import { sendeSprachbefehl, type SprachAntwort, type SprachTreffer } from './sprachClient.js';
import { useRoutingStore } from '../routing/store.js';
import { useTtsStore } from '../drive/ttsStore.js';
import { speak, isSpeechAvailable } from '../drive/tts.js';

export interface Zeile {
  wer: 'du' | 'yapaia';
  text: string;
}

interface SprachState {
  offen: boolean;
  hoert: boolean;
  zwischen: string;
  denkt: boolean;
  verlauf: Zeile[];
  auswahl: SprachTreffer[];
  /** Die letzte Antwort war eine Frage -- danach gleich wieder zuhören. */
  rueckfrage: boolean;
  oeffne: () => void;
  schliesse: () => void;
  setHoert: (h: boolean) => void;
  setZwischen: (t: string) => void;
  sende: (text: string) => Promise<SprachAntwort | null>;
}

function wende(a: SprachAntwort): void {
  const akt = a.aktion;
  if (!akt) return;
  if (akt.art === 'route_vorschlag') {
    // Die Route sofort auf der Karte -- wie nach einer Suche mit „Route".
    const r = useRoutingStore.getState();
    r.setDestination({ lat: akt.ziel.lat, lon: akt.ziel.lon }, akt.ziel.beschreibung);
    useRoutingStore.setState({ routes: [akt.route], activeRouteId: akt.route.id, status: 'success', error: null });
  } else if (akt.art === 'ansagen') {
    useTtsStore.getState().setEnabled(akt.an);
  }
}

export const useSprachStore = create<SprachState>((set, get) => ({
  offen: false,
  hoert: false,
  zwischen: '',
  denkt: false,
  verlauf: [],
  auswahl: [],
  rueckfrage: false,
  oeffne: () => set({ offen: true }),
  schliesse: () => set({ offen: false, hoert: false, zwischen: '', rueckfrage: false }),
  setHoert: (hoert) => set({ hoert }),
  setZwischen: (zwischen) => set({ zwischen }),
  sende: async (text) => {
    const t = text.trim();
    if (!t || get().denkt) return null;
    set((s) => ({ denkt: true, zwischen: '', verlauf: [...s.verlauf, { wer: 'du' as const, text: t }].slice(-12) }));
    const a = await sendeSprachbefehl(t);
    set((s) => ({
      denkt: false,
      verlauf: [...s.verlauf, { wer: 'yapaia' as const, text: a.antwort }].slice(-12),
      auswahl: a.aktion?.art === 'auswahl' ? a.aktion.treffer : a.aktion ? [] : s.auswahl,
      rueckfrage: Boolean(a.rueckfrage),
    }));
    wende(a);
    // Die Antwort auf eine gestellte Frage wird immer vorgelesen -- auch wenn
    // die Abbiege-Ansagen aus sind; wer fragt, will die Antwort hören.
    if (isSpeechAvailable()) speak(a.antwort);
    return a;
  },
}));

declare global {
  interface Window {
    __yapaiaSprachStore?: typeof useSprachStore;
  }
}
if (typeof window !== 'undefined') window.__yapaiaSprachStore = useSprachStore;
