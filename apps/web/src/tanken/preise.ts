/**
 * Spritpreise an Tankstellen-Treffern (0.42.0).
 *
 * Gewünscht: „Wenn die Verbindung steht dann soll bei der Tankstellensuche
 * gleich der aktuelle Preis angezeigt werden. Abhängig von der im Profil
 * hinterlegten Spritsorte. Die Farbe des Preises soll sich entsprechend der
 * Aktualität des Preises ändern. Ist keine Tankerkönig Verbindung möglich
 * dann erscheint auch kein Preis."
 *
 * Die Treffer kommen aus dem eigenen Suchindex (OSM); die Preise aus
 * Tankerkönig (MTS-K). Beide kennen dieselbe Tankstelle, aber nicht unter
 * derselben Kennung -- zusammengeführt wird über den Ort: die nächste
 * Tankerkönig-Station in höchstens {@link ZUORDNUNG_MAX_M} Metern.
 *
 * Jeder Fehler (Online aus, kein Schlüssel, kein Netz, falscher Schlüssel)
 * endet in „kein Preis" -- nie in einer Meldung mitten in der Trefferliste.
 */
import type { FuelType } from '@yapaia/shared';
import { haversineMeters } from '../search/distance.js';

export interface Tankstelle {
  id: string;
  name: string;
  marke: string | null;
  lat: number;
  lon: number;
  diesel: number | null;
  e5: number | null;
  e10: number | null;
  offen: boolean;
}

export interface Preisabfrage {
  abgerufen: string;
  stationen: Tankstelle[];
}

/** OSM-Punkt und Tankerkönig-Eintrag derselben Tankstelle liegen selten genau
 *  aufeinander (Dach vs. Zufahrt). 250 m trennt noch zuverlässig zwei
 *  Tankstellen an einer Kreuzung von einer am nächsten Ortsausgang. */
export const ZUORDNUNG_MAX_M = 250;

/** Der Umkreis je Abfrage. Der Kern rundet den Ort auf ~5 km; 6 km deckt
 *  damit jeden Punkt im gerundeten Feld sicher ab. */
export const ABFRAGE_RADIUS_KM = 6;

/** Höchstens so viele Treffer bekommen einen Preis -- mehr passt ohnehin
 *  nicht auf den Schirm, und jede weitere Gegend wäre eine weitere Abfrage. */
export const MAX_TREFFER = 12;

export interface Punkt {
  lat: number;
  lon: number;
}

/** Die nächste Tankerkönig-Station zum Punkt, oder `null`. */
export function zuordnen(p: Punkt, stationen: readonly Tankstelle[]): Tankstelle | null {
  let beste: Tankstelle | null = null;
  let besteM = ZUORDNUNG_MAX_M;
  for (const s of stationen) {
    const m = haversineMeters(p, { lat: s.lat, lon: s.lon });
    if (m <= besteM) {
      beste = s;
      besteM = m;
    }
  }
  return beste;
}

export interface Preisangabe {
  /** „Diesel", „E5", „E10" */
  sorte: string;
  euro: number;
}

/** Was zur Spritsorte des Profils passt. Benzin zeigt E5 und E10 -- welchen
 *  der beiden das Fahrzeug tankt, sagt das Profil nicht. Für Gas, Strom oder
 *  ohne Angabe gibt es nichts: Tankerkönig kennt nur Diesel, E5 und E10. */
export function preiseFuer(s: Tankstelle, sorte: FuelType | null | undefined): Preisangabe[] {
  if (sorte === 'diesel') return s.diesel !== null ? [{ sorte: 'Diesel', euro: s.diesel }] : [];
  if (sorte === 'benzin') {
    const out: Preisangabe[] = [];
    if (s.e5 !== null) out.push({ sorte: 'E5', euro: s.e5 });
    if (s.e10 !== null) out.push({ sorte: 'E10', euro: s.e10 });
    return out;
  }
  return [];
}

/** „1,659" → „1,65⁹" wie an der Preistafel. */
export function preisText(euro: number): string {
  const tausendstel = Math.round(euro * 1000);
  const ganz = Math.floor(tausendstel / 1000);
  const rest = String(tausendstel % 1000).padStart(3, '0');
  return `${ganz},${rest.slice(0, 2)}${'⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(rest[2])]}`;
}

export type Frische = 'frisch' | 'aelter' | 'alt' | 'zu';

/** Grenzen der Farbstufen. Tankstellen melden jede Änderung binnen fünf
 *  Minuten; ein Preis, den wir vor einer Viertelstunde geholt haben, stimmt
 *  meist noch, einer von vor einer Stunde oft nicht mehr. */
export const FRISCH_MS = 15 * 60 * 1000;
export const AELTER_MS = 60 * 60 * 1000;

/** Wie aktuell ein Preis ist. Tankerkönigs Umkreissuche sagt nicht, wann sich
 *  ein Preis zuletzt geändert hat -- gemessen wird deshalb das Alter unserer
 *  Abfrage. Eine geschlossene Tankstelle ist immer „zu", egal wie frisch. */
export function frische(abgerufen: string, offen: boolean, jetzt: number = Date.now()): Frische {
  if (!offen) return 'zu';
  const alter = jetzt - Date.parse(abgerufen);
  if (!Number.isFinite(alter) || alter > AELTER_MS) return 'alt';
  return alter > FRISCH_MS ? 'aelter' : 'frisch';
}

export const FRISCHE_KLASSE: Readonly<Record<Frische, string>> = {
  frisch: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  aelter: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  alt: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  zu: 'bg-slate-200 text-slate-500 line-through dark:bg-slate-700 dark:text-slate-400',
};

export const FRISCHE_TEXT: Readonly<Record<Frische, string>> = {
  frisch: 'Preis aktuell',
  aelter: 'Preis älter als 15 Minuten',
  alt: 'Preis älter als eine Stunde',
  zu: 'Tankstelle geschlossen',
};

/** Holt die Preise um einen Punkt. `null` bei jedem Fehler -- dann kein Preis. */
export async function holePreise(p: Punkt, fetchFn: typeof fetch = fetch): Promise<Preisabfrage | null> {
  try {
    const antwort = await fetchFn(
      `${import.meta.env.BASE_URL}api/v1/tanken/preise?lat=${p.lat}&lon=${p.lon}&rad=${ABFRAGE_RADIUS_KM}`,
    );
    if (!antwort.ok) return null;
    const { data } = (await antwort.json()) as { data?: Preisabfrage };
    return data && Array.isArray(data.stationen) && typeof data.abgerufen === 'string' ? data : null;
  } catch {
    return null;
  }
}

/** Gleiche Rundung wie im Kern: Punkte derselben Gegend teilen eine Abfrage. */
export function gegend(p: Punkt): string {
  return `${Math.round(p.lat * 20) / 20},${Math.round(p.lon * 20) / 20}`;
}

export interface Zuordnung {
  station: Tankstelle;
  abgerufen: string;
}

/**
 * Preise für eine Reihe von Punkten: je Gegend EINE Abfrage, dann je Punkt
 * die nächste Station. Ergebnis in derselben Reihenfolge; `null` = kein Preis.
 */
export async function preiseZuPunkten(
  punkte: readonly Punkt[],
  holen: (p: Punkt) => Promise<Preisabfrage | null> = holePreise,
): Promise<Array<Zuordnung | null>> {
  const abfragen = new Map<string, Promise<Preisabfrage | null>>();
  const je = punkte.slice(0, MAX_TREFFER).map((p) => {
    const k = gegend(p);
    if (!abfragen.has(k)) abfragen.set(k, holen(p));
    return abfragen.get(k)!;
  });
  const ergebnisse = await Promise.all(je);
  return punkte.map((p, i) => {
    const r = ergebnisse[i];
    if (!r) return null;
    const station = zuordnen(p, r.stationen);
    return station ? { station, abgerufen: r.abgerufen } : null;
  });
}
