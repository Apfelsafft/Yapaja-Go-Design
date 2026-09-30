/**
 * Was die Bordsensoren sagen -- vom Kern (`GET /api/v1/bord`), alle 30 s.
 *
 * Die Entscheidungen (Schwellen, Hysterese, welche Station) trifft der Kern
 * (`apps/core/src/bord/`). Hier wird nur abgeholt und bereitgehalten.
 */

import { create } from 'zustand';

export type BordArt = 'grauwasser' | 'frischwasser' | 'batterie' | 'frost';

export interface BordStation {
  name: string;
  lat: number;
  lon: number;
  /** Weg auf der Route bis dorthin; `null` ohne laufende Route. */
  voraus_m: number | null;
  abseits_m: number;
}

export interface BordHinweis {
  art: BordArt;
  wert: number;
  text: string;
  station: BordStation | null;
}

export interface BordZustand {
  eingerichtet: boolean;
  hinweise: BordHinweis[];
  stand: string | null;
}

/** Wie oft nachgefragt wird. Der Kern selbst liest Home Assistant einmal pro Minute. */
export const BORD_ABFRAGE_MS = 30_000;

interface BordStore extends BordZustand {
  laden: () => Promise<void>;
}

export const useBordStore = create<BordStore>((set) => ({
  eingerichtet: false,
  hinweise: [],
  stand: null,
  laden: async () => {
    try {
      const antwort = await fetch(`${import.meta.env.BASE_URL}api/v1/bord`);
      if (!antwort.ok) return;
      const { data } = (await antwort.json()) as { data?: BordZustand };
      if (!data || !Array.isArray(data.hinweise)) return;
      set({ eingerichtet: Boolean(data.eingerichtet), hinweise: data.hinweise, stand: data.stand ?? null });
    } catch {
      // Kein Netz zum Kern: die letzten Hinweise bleiben stehen. Ein Aussetzer
      // ist kein Grund, einen vollen Grauwassertank für leer zu erklären.
    }
  },
}));

/**
 * Wodurch sich ein Hinweis von einem anderen unterscheidet -- OHNE den Wert.
 *
 * Wer „später" tippt, will diesen Hinweis nicht bei 81 % wieder sehen, dann
 * bei 82 %, dann bei 83 %. Neu ist er erst, wenn eine andere Station die
 * nächste ist oder ein anderer Tank meldet -- dieselbe Überlegung wie beim
 * Verkehrshinweis (`online/verkehrHinweisText.ts`).
 */
export function hinweisSchluessel(h: Pick<BordHinweis, 'art' | 'station'>): string {
  return `${h.art}:${h.station ? `${h.station.lat.toFixed(4)},${h.station.lon.toFixed(4)}` : '-'}`;
}

/** „Entsorgungsstation Musterhof — in 12 km, 300 m neben der Strecke". */
export function stationsZeile(s: BordStation): string {
  const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1).replace('.', ',')} km` : `${Math.round(m / 10) * 10} m`);
  if (s.voraus_m === null) return `${s.name} — ${km(s.abseits_m)} entfernt`;
  return s.abseits_m < 150
    ? `${s.name} — in ${km(s.voraus_m)} an der Strecke`
    : `${s.name} — in ${km(s.voraus_m)}, ${km(s.abseits_m)} neben der Strecke`;
}
