/**
 * Nach wie vielen Sekunden die Karte wieder auf die eigene Position springt.
 *
 * Gewünscht: „Bitte integriere einen Slider, der die Zeit festlegt, wann
 * wieder automatisch auf die aktuelle Position zentriert wird. Inklusive
 * ‚aus'. Also keine automatische Zentrierung."
 *
 * Bis 0.26 fest zehn Sekunden (`followMe.ts`). `0` heißt aus: die Karte
 * bleibt, wo man sie hingeschoben hat, bis man ⌖ drückt.
 *
 * Je Gerät gespeichert -- ein Tablet im Fahrzeug und ein Telefon in der
 * Hand wollen das verschieden.
 */

import { create } from 'zustand';

/** Die Stufen des Reglers, in Sekunden. 0 = aus. */
export const ZENTRIEREN_STUFEN = [0, 5, 10, 15, 20, 30, 45, 60, 120] as const;
export const ZENTRIEREN_VORGABE_S = 10;

const SCHLUESSEL = 'yapaja.zentrierenNachS';

function lies(): number {
  try {
    const roh = localStorage.getItem(SCHLUESSEL);
    if (roh === null) return ZENTRIEREN_VORGABE_S;
    const n = Number(roh);
    return (ZENTRIEREN_STUFEN as readonly number[]).includes(n) ? n : ZENTRIEREN_VORGABE_S;
  } catch {
    return ZENTRIEREN_VORGABE_S;
  }
}

interface ZentrierenState {
  sekunden: number;
  setSekunden: (s: number) => void;
}

export const useZentrierenStore = create<ZentrierenState>((set) => ({
  sekunden: lies(),
  setSekunden: (sekunden) => {
    set({ sekunden });
    try {
      localStorage.setItem(SCHLUESSEL, String(sekunden));
    } catch {
      // Ohne Speicher gilt es eben nur bis zum Neuladen.
    }
  },
}));

export function zentrierenText(s: number): string {
  if (s === 0) return 'aus';
  if (s < 60) return `${s} s`;
  return `${s / 60} min`;
}
