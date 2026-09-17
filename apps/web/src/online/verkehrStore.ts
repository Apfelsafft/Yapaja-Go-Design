/**
 * Der Zustand der Verkehrslage.
 *
 * ─── WAS HIER NEBEN DEN MELDUNGEN LIEGT ─────────────────────────────────────
 * Die LÜCKEN. Welche Autobahn nicht antwortete, wie alt die Daten sind, wie
 * viele Meldungen keinen Ort hatten.
 *
 * Das ist nicht Beiwerk, sondern der Grund für diesen Store. Die Meldungen
 * allein könnte die Kartenebene selbst holen; was sie nicht könnte, ist
 * sagen, dass sie unvollständig sind. Eine Karte mit drei fehlenden
 * Baustellen sieht aus wie eine mit null Baustellen — und dieser Unterschied
 * entscheidet, ob jemand in eine Sperrung fährt.
 */

import { create } from 'zustand';
import { holeVerkehr, type StrassenBefund } from './verkehrClient.js';
import type { KartenMeldung } from './verkehrGeoJson.js';

export interface VerkehrState {
  meldungen: KartenMeldung[];
  /** Je Autobahn: frisch, aus dem Zwischenspeicher oder gar nicht da. */
  strassen: StrassenBefund[];
  /** Ein Satz über die Lage, der die Einschränkungen ZUERST nennt. */
  urteil: string;
  /** Meldungen mit Text, aber ohne Ort — sie stehen nicht auf der Karte. */
  ohneOrt: number;
  /** Gesetzt, wenn der Abruf selbst scheiterte. */
  fehler: string | null;
  laeuft: boolean;
  /** Wann zuletzt etwas ankam, als Zeitstempel. `null` heißt „noch nie". */
  standVon: number | null;

  abrufen: (strassen: readonly string[]) => Promise<void>;
  leeren: () => void;
}

const LEER = {
  meldungen: [] as KartenMeldung[],
  strassen: [] as StrassenBefund[],
  urteil: '',
  ohneOrt: 0,
  fehler: null as string | null,
  laeuft: false,
  standVon: null as number | null,
};

export const useVerkehrStore = create<VerkehrState>((set, get) => ({
  ...LEER,

  abrufen: async (strassen) => {
    // Kein zweiter Abruf, solange einer läuft. Die Route ändert sich im
    // Sekundentakt; ohne diese Sperre stünden mehrere Anfragen gleichzeitig
    // an derselben offenen Schnittstelle — und die letzte Antwort würde
    // gewinnen, nicht die neueste.
    if (get().laeuft) return;

    set({ laeuft: true });
    const ergebnis = await holeVerkehr(strassen);

    if ('fehler' in ergebnis) {
      // ─── DIE ALTEN MELDUNGEN BLEIBEN STEHEN ───────────────────────────
      // Ein fehlgeschlagener Abruf ist kein Grund, eine Baustelle von der
      // Karte zu nehmen, die vor fünf Minuten noch da war. Sie steht
      // weiterhin; der Fehler sagt daneben, dass gerade nichts Neues kam.
      set({ laeuft: false, fehler: ergebnis.fehler });
      return;
    }

    set({
      meldungen: ergebnis.meldungen,
      strassen: ergebnis.strassen,
      urteil: ergebnis.urteil,
      ohneOrt: ergebnis.ohne_ort,
      fehler: null,
      laeuft: false,
      standVon: Date.now(),
    });
  },

  leeren: () => set({ ...LEER }),
}));
