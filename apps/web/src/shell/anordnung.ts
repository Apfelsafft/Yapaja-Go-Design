/**
 * Selbst angeordnete Bildschirme: wo ein Element sitzt und wie groß es ist.
 *
 * Gewünscht: „Können wir zusätzlich eine Funktion einführen, in der der User
 * sich die Screens (Ruhemodus, Navigation usw.) selber konfigurieren kann?
 * Also er kann die einzelnen Objekte an gewünschte Stellen auf dem Screen
 * verschieben und vielleicht auch in der Größe ändern."
 *
 * ─── VERSCHIEBUNG STATT ABSOLUTER POSITION ──────────────────────────────────
 * Gespeichert wird je Element eine VERSCHIEBUNG gegenüber seinem Standardplatz
 * (in Bildschirmpunkten) und ein Maßstab. Der Standardplatz bleibt, was er
 * ist -- abhängig von Links-/Rechtslenker, Bildschirmbreite, Kopfzeile. Ein
 * gespeicherter absoluter Platz wäre nach einem Wechsel auf Rechtslenker oder
 * ein anderes Gerät falsch; eine Verschiebung bleibt sinnvoll, und
 * `useAnordnung` hält das Element zusätzlich im sichtbaren Bereich.
 *
 * Je Gerät (localStorage): ein Tablet im Fahrzeug und ein Telefon in der Hand
 * haben verschieden viel Platz.
 */

import { create } from 'zustand';

export type Modus = 'ruhe' | 'fahrt';

export interface Platz {
  dx: number;
  dy: number;
  /** Maßstab, 1 = Standard. */
  s: number;
}

export const MASSSTAB_MIN = 0.6;
export const MASSSTAB_MAX = 2;

const SCHLUESSEL = 'yapaja.anordnung';

type Werte = Record<Modus, Record<string, Platz>>;

const LEER: Werte = { ruhe: {}, fahrt: {} };

function lies(): Werte {
  try {
    const roh = localStorage.getItem(SCHLUESSEL);
    if (!roh) return { ruhe: {}, fahrt: {} };
    const w = JSON.parse(roh) as Partial<Werte>;
    return { ruhe: pruefe(w.ruhe), fahrt: pruefe(w.fahrt) };
  } catch {
    return { ruhe: {}, fahrt: {} };
  }
}

/** Nur Einträge mit endlichen Zahlen -- ein kaputter Eintrag darf kein
 *  Element aus dem Bild schieben. */
function pruefe(roh: unknown): Record<string, Platz> {
  const raus: Record<string, Platz> = {};
  if (!roh || typeof roh !== 'object') return raus;
  for (const [id, p] of Object.entries(roh as Record<string, unknown>)) {
    const q = p as Partial<Platz>;
    if (Number.isFinite(q.dx) && Number.isFinite(q.dy) && Number.isFinite(q.s)) {
      raus[id] = { dx: q.dx as number, dy: q.dy as number, s: begrenzeMassstab(q.s as number) };
    }
  }
  return raus;
}

export function begrenzeMassstab(s: number): number {
  return Math.min(MASSSTAB_MAX, Math.max(MASSSTAB_MIN, s));
}

function schreibe(w: Werte): void {
  try {
    localStorage.setItem(SCHLUESSEL, JSON.stringify(w));
  } catch {
    // Ohne Speicher gilt es bis zum Neuladen.
  }
}

interface AnordnungState {
  /** Welcher Bildschirm gerade bearbeitet wird, oder null. */
  bearbeiten: Modus | null;
  werte: Werte;
  starte: (m: Modus) => void;
  beende: () => void;
  setze: (m: Modus, id: string, p: Platz) => void;
  zuruecksetzen: (m: Modus) => void;
}

export const useAnordnungStore = create<AnordnungState>((set, get) => ({
  bearbeiten: null,
  werte: lies(),
  starte: (bearbeiten) => set({ bearbeiten }),
  beende: () => set({ bearbeiten: null }),
  setze: (m, id, p) => {
    const werte = { ...get().werte, [m]: { ...get().werte[m], [id]: { ...p, s: begrenzeMassstab(p.s) } } };
    set({ werte });
    schreibe(werte);
  },
  zuruecksetzen: (m) => {
    const werte = { ...get().werte, [m]: {} };
    set({ werte });
    schreibe(werte);
  },
}));

export const STANDARD: Platz = { dx: 0, dy: 0, s: 1 };
export { LEER as LEERE_ANORDNUNG };

declare global {
  interface Window {
    /** E2E-Zugriff, wie die anderen Stores. */
    __yapaiaAnordnungStore?: typeof useAnordnungStore;
  }
}

if (typeof window !== 'undefined') {
  window.__yapaiaAnordnungStore = useAnordnungStore;
}
