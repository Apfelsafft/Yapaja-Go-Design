/* eslint-disable no-undef -- `fetch`/`AbortSignal` sind Node-22-Globale (wie in ort.ts). */
/**
 * Spritpreise über Tankerkönig (0.42.0).
 *
 * Gewünscht: „Kannst du bitte Tankerkönig einbinden? … Wenn die Verbindung
 * steht dann soll bei der Tankstellensuche gleich der aktuelle Preis
 * angezeigt werden. Abhängig von der im Profil hinterlegten Spritsorte. …
 * Ist keine Tankerkönig Verbindung möglich dann erscheint auch kein Preis."
 *
 * ─── WOHER ──────────────────────────────────────────────────────────────────
 * Tankerkönig (https://creativecommons.tankerkoenig.de) reicht die Daten der
 * Markttransparenzstelle für Kraftstoffe (MTS-K) unter CC BY 4.0 weiter.
 * Deutsche Tankstellen müssen jede Preisänderung binnen fünf Minuten melden;
 * ein frisch abgefragter Preis ist also aktuell. Der Schlüssel ist kostenlos.
 *
 * ─── WAS DIE SCHNITTSTELLE NICHT SAGT ───────────────────────────────────────
 * `list.php` liefert den Preis, aber nicht, wann er sich zuletzt geändert
 * hat. Was die Oberfläche als „Aktualität" zeigt, ist deshalb das Alter
 * UNSERER Abfrage (`abgerufen`) -- ehrlicher geht es mit dieser Quelle nicht.
 *
 * ─── SPARSAM ────────────────────────────────────────────────────────────────
 * Tankerkönig bittet, dieselbe Abfrage nicht öfter als alle fünf Minuten zu
 * stellen. Der Ort wird auf etwa 5 km gerundet und das Ergebnis fünf Minuten
 * gehalten. Hinaus geht nur dieser gerundete Ort und der Radius.
 */

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
  /** Wann Tankerkönig gefragt wurde (ISO 8601). */
  abgerufen: string;
  stationen: Tankstelle[];
}

export const TANKEN_TTL_MS = 5 * 60 * 1000;
export const MAX_RADIUS_KM = 25;
const URL_BASIS = 'https://creativecommons.tankerkoenig.de/json/list.php';

/** Auf 0,05° (~5 km) gerundet: reicht für einen Umkreis bis 25 km, verrät
 *  den genauen Ort nicht, und gleiche Gegend = gleicher Zwischenspeicher. */
export function gerundet(wert: number): number {
  return Math.round(wert * 20) / 20;
}

function preis(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** Eine Zeile aus `list.php` (type=all). Unbrauchbares fällt weg. */
export function station(roh: unknown): Tankstelle | null {
  if (!roh || typeof roh !== 'object') return null;
  const o = roh as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.lat !== 'number' || typeof o.lng !== 'number') return null;
  return {
    id: o.id,
    name: typeof o.name === 'string' ? o.name.trim() : '',
    marke: typeof o.brand === 'string' && o.brand.trim() ? o.brand.trim() : null,
    lat: o.lat,
    lon: o.lng,
    diesel: preis(o.diesel),
    e5: preis(o.e5),
    e10: preis(o.e10),
    offen: o.isOpen !== false,
  };
}

export class TankerkoenigFehler extends Error {
  constructor(
    message: string,
    readonly code: 'SCHLUESSEL' | 'ANTWORT' | 'NETZ',
  ) {
    super(message);
  }
}

export interface TankenDeps {
  fetchFn?: typeof fetch;
  jetzt?: () => number;
}

export class Tankerkoenig {
  private readonly cache = new Map<string, { zeit: number; daten: Preisabfrage }>();
  private readonly fetchFn: typeof fetch;
  private readonly jetzt: () => number;

  constructor(
    private readonly apiKey: string,
    deps: TankenDeps = {},
  ) {
    this.fetchFn = deps.fetchFn ?? ((...a) => fetch(...a));
    this.jetzt = deps.jetzt ?? Date.now;
  }

  async umkreis(lat: number, lon: number, radiusKm: number): Promise<Preisabfrage> {
    const rad = Math.min(MAX_RADIUS_KM, Math.max(1, Math.round(radiusKm)));
    const la = gerundet(lat);
    const lo = gerundet(lon);
    const schluessel = `${la},${lo},${rad}`;
    const da = this.cache.get(schluessel);
    if (da && this.jetzt() - da.zeit < TANKEN_TTL_MS) return da.daten;

    const url = `${URL_BASIS}?lat=${la}&lng=${lo}&rad=${rad}&sort=dist&type=all&apikey=${encodeURIComponent(this.apiKey)}`;
    let roh: unknown;
    try {
      const antwort = await this.fetchFn(url, { signal: AbortSignal.timeout(10_000) });
      roh = await antwort.json();
    } catch (err) {
      throw new TankerkoenigFehler(`Tankerkönig nicht erreichbar: ${(err as Error).message}`, 'NETZ');
    }
    const o = (roh ?? {}) as Record<string, unknown>;
    if (o.ok !== true) {
      const text = typeof o.message === 'string' ? o.message : 'unbekannter Fehler';
      const code = /api ?key/i.test(text) ? 'SCHLUESSEL' : 'ANTWORT';
      throw new TankerkoenigFehler(`Tankerkönig: ${text}`, code);
    }
    const stationen = (Array.isArray(o.stations) ? o.stations : [])
      .map(station)
      .filter((s): s is Tankstelle => s !== null);
    const daten = { abgerufen: new Date(this.jetzt()).toISOString(), stationen };
    this.cache.set(schluessel, { zeit: this.jetzt(), daten });
    return daten;
  }
}
