/**
 * Sagt MapLibre 6, wo sein Arbeiter liegt.
 *
 * ─── WAS OHNE DIESE DATEI PASSIERT ──────────────────────────────────────────
 * Die Karte sieht aus wie eine Karte -- und ist trotzdem tot. Gemessen im
 * Browser (`e2e/map-labels.spec.ts`, plus eine Wegwerf-Sonde):
 *
 *     Quelle geladen ...... false
 *     Merkmale in der Quelle 0
 *     Glyphen-Anfragen .... 0
 *     rote Textbildpunkte . 0
 *     Fehlermeldung ....... „TypeError: Failed to fetch"
 *
 * Und zwar bei ALLEM, was durch den Arbeiter geht: GeoJSON-Quellen (also die
 * eingezeichnete Route), Vektorkacheln, Schriftzeichen. Nur der Hintergrund
 * wird noch gezeichnet -- der laeuft im Hauptfaden. Genau dieses Bild hat den
 * ersten Aufstiegsversuch scheitern lassen und als „keine Strassennamen mehr,
 * Tipper auf die Route treffen nicht" ins Protokoll gebracht. Es waren nie
 * zwei Fehler, es war immer dieser eine.
 *
 * ─── WARUM ES PASSIERT ──────────────────────────────────────────────────────
 * MapLibre 6 wird ausschliesslich als ES-Modul ausgeliefert und startet seinen
 * Arbeiter als eigenes Modul. Wo dieses Modul liegt, errechnet es sich selbst
 * (`web_worker.ts`):
 *
 *     function defaultWorkerUrl() {
 *       const moduleUrl = import.meta.url;
 *       ...
 *       return new URL(`./${workerName}`, moduleUrl).href;
 *     }
 *
 * Das stimmt genau dann, wenn `maplibre-gl` unveraendert aus seinem eigenen
 * Ordner geladen wird. Vite baendelt es aber in unseren eigenen Brocken; dann
 * zeigt `import.meta.url` auf `/assets/index-XYZ.js`, und gesucht wird
 * `/assets/maplibre-gl-worker.mjs` -- eine Datei, die es dort nie gab.
 *
 * ─── WARUM `?worker&url` UND NICHT `?url` ───────────────────────────────────
 * Die Arbeiterdatei ist kein Einzelstueck: sie beginnt mit
 * `import { ... } from "./maplibre-gl-shared.mjs"`. Mit `?url` legte Vite nur
 * diese eine Datei ab, und ihr Import liefe ins Leere -- derselbe stille
 * Ausfall, nur eine Ebene tiefer. `?worker&url` baendelt den Arbeiter samt
 * seiner Abhaengigkeiten und liefert die Adresse des Ergebnisses.
 *
 * ─── WARUM DAS AUCH UNTER DEM INGRESS-PFAD STIMMT ───────────────────────────
 * Vite kennt hier `base: './'`; die Adresse wird also gegen die Seite
 * aufgeloest, nicht gegen den Wurzelpfad des Servers. Das ist dieselbe Regel,
 * nach der schon Kacheln und Schriftzeichen adressiert werden (siehe
 * `apps/core/src/map/styles/fonts.ts`), und der Grund, warum die Karte auch
 * unter `/api/hassio_ingress/<token>/` laedt.
 */

import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

/** Die Adresse, die MapLibre bekommt -- fuer die Browser-Pruefung sichtbar. */
export const MAPLIBRE_WORKER_URL: string = workerUrl;

let gesetzt = false;

/**
 * Muss VOR dem ersten `new maplibregl.Map(...)` laufen. Mehrfaches Aufrufen
 * ist harmlos; MapLibre wirft die bereits gestarteten Arbeiter sonst weg.
 */
export function ensureMaplibreWorkerUrl(): void {
  if (gesetzt) return;
  gesetzt = true;
  setWorkerUrl(workerUrl);
  if (typeof window !== 'undefined') {
    window.__yapaiaMaplibreWorkerUrl = workerUrl;
  }
}

declare global {
  interface Window {
    /** Debug/E2E: welche Arbeiter-Adresse MapLibre bekommen hat. */
    __yapaiaMaplibreWorkerUrl?: string;
  }
}
