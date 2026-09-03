/**
 * Wie ein angetippter Punkt zu einem NAMEN kommt — offline, ohne Suchindex.
 *
 * ─── DAS PROBLEM ────────────────────────────────────────────────────────────
 * Wer ein Ziel auf der Karte antippt, bekam bisher „Ziel" und darunter zwei
 * Zahlen: `47.14103, 9.52104`. Das ist die Wahrheit, aber keine Auskunft.
 * Niemand erkennt daran, wohin er fährt, und niemand prüft daran, ob er die
 * richtige Stelle getroffen hat.
 *
 * ─── WARUM NICHT EINFACH RÜCKWÄRTSSUCHE ─────────────────────────────────────
 * Es gibt `GET /api/v1/search/reverse` im Core. Der braucht aber einen
 * Backend: Photon (mehrere GB RAM, auf einem 8-GB-Gerät abgeschaltet), den
 * Lite-Index (auf dem Gerät noch nicht baubar) oder Nominatim (online — in
 * einer Offline-Navigation keine Antwort, sondern ein Widerspruch). Auf der
 * Installation, um die es geht, ist keines davon vorhanden. Ein Aufruf hätte
 * also nur eine leere Liste geliefert.
 *
 * ─── WAS STATTDESSEN SCHON DA IST ───────────────────────────────────────────
 * Die Namen liegen längst auf dem Gerät — in den Vektorkacheln selbst. Ein
 * PMTiles-Archiv im OpenMapTiles-Schema führt `transportation_name` (Straßen
 * mit Namen), `place` (Orte) und `poi`. Was gerade auf dem Bildschirm ist,
 * ist auch schon im Speicher: MapLibre hat die Kacheln für diesen Ausschnitt
 * geladen, um sie zu zeichnen.
 *
 * `querySourceFeatures` liest genau daraus — direkt aus den geladenen
 * Quellkacheln, unabhängig davon, ob ein Stil-Layer die Ebene zeichnet. Das
 * ist der Unterschied zu `queryRenderedFeatures`, das nur findet, was
 * tatsächlich gemalt wird: `transportation_name` wird von unseren Stilen NICHT
 * gezeichnet (die Straßennamen stehen nicht auf der Karte), wäre über die
 * gerenderten Features also unerreichbar.
 *
 * ─── DIE GRENZEN, DIE DAS HAT ───────────────────────────────────────────────
 * Es liefert einen Straßen- oder Ortsnamen, KEINE Hausnummer und keine
 * Postanschrift — die stehen so nicht in den Kacheln. Und es funktioniert nur
 * dort, wo Kacheln geladen sind, also im aktuellen Ausschnitt; das ist beim
 * Antippen genau der Fall. Für die getippte Zielwahl reicht das vollständig.
 * Das Suchen nach einer TEXTEINGABE bleibt Aufgabe des Index.
 *
 * Findet sich kein Name, bleibt es bei den Koordinaten. Das ist Absicht: ein
 * erfundener oder weit entfernter Name wäre schlimmer als eine Zahl — man
 * würde ihm glauben.
 */

import type { GeoJSONFeature, Map as MapLibreMap } from 'maplibre-gl';

/**
 * Die Quelle, die `apps/core/src/map/styles/constants.ts` im Stil anlegt.
 *
 * ─── DIESER STRING WAR FALSCH, UND ZWAR STILL ───────────────────────────────
 * In 0.3.2 stand hier `'region'`. Die Quelle heisst aber `'yapaja-region'`.
 * `querySourceFeatures` wirft bei einer unbekannten Quelle, der `catch`
 * unten hat das geschluckt, und `resolvePlaceName` lieferte AUSNAHMSLOS
 * `null` — jedes angetippte Ziel blieb bei seinen Koordinaten. Die Funktion
 * war da, der Weg war nie begehbar.
 *
 * Die Tests haben es nicht gemerkt, weil sie die ID selbst hereingaben: ihre
 * gefaelschte Karte antwortete auf jeden Namen. Ein Test, der seinen eigenen
 * Parameter setzt, prueft die Verdrahtung nicht. Deshalb haelt
 * `placeName.sourceId.test.ts` diesen Wert jetzt gegen die Konstante im
 * Core — die beiden koennen nicht mehr auseinanderlaufen, ohne dass ein Test
 * umfaellt.
 */
export const REGION_SOURCE_ID = 'yapaja-region';

/**
 * In welcher Reihenfolge gefragt wird. Eine Straße ist die genaueste Auskunft
 * über einen getippten Punkt, ein POI die anschaulichste, ein Ortsname die
 * gröbste — aber immer noch besser als zwei Zahlen.
 */
const LOOKUP_LAYERS: readonly string[] = ['transportation_name', 'poi', 'place'];

/**
 * Wie weit ein Name höchstens vom getippten Punkt entfernt sein darf, in
 * Grad. ~0,0018° sind in unseren Breiten grob 200 m.
 *
 * Ohne diese Grenze würde bei jedem Tippen der nächstgelegene Name aus dem
 * GANZEN geladenen Ausschnitt gewinnen — auf einer leeren Fläche wäre das ein
 * Ort 30 km weiter, der dann als Ziel im Panel steht. Genau die Sorte
 * plausibel aussehender Falschaussage, die dieses Projekt an anderer Stelle
 * schon zweimal gekostet hat.
 */
export const MAX_NAME_DISTANCE_DEG = 0.0018;

/** Etwas gröber für Ortsnamen: ein Ortsmittelpunkt liegt legitim ein paar
 *  Kilometer von seinem Rand entfernt, an dem man getippt haben kann. */
export const MAX_PLACE_DISTANCE_DEG = 0.05;

export interface LatLon {
  lat: number;
  lon: number;
}

/** Damit die Warnung unten einmal pro Quelle faellt und nicht bei jedem Tippen. */
const warnedMissingSources = new Set<string>();

/** Quadrat des Abstands in Grad — Wurzeln braucht ein Vergleich nicht. */
function squaredDegDistance(a: LatLon, b: LatLon): number {
  const dLat = a.lat - b.lat;
  const dLon = a.lon - b.lon;
  return dLat * dLat + dLon * dLon;
}

/** Der dem Punkt nächste Stützpunkt einer Feature-Geometrie. Straßen sind
 *  Linien; ihr Mittelpunkt kann weit weg liegen, während die Linie direkt
 *  unter dem Finger verläuft. */
export function nearestVertexDistanceSquared(
  geometry: GeoJSONFeature['geometry'],
  point: LatLon,
): number | null {
  let best: number | null = null;

  const consider = (coords: unknown): void => {
    if (
      Array.isArray(coords) &&
      coords.length >= 2 &&
      typeof coords[0] === 'number' &&
      typeof coords[1] === 'number'
    ) {
      const d = squaredDegDistance({ lon: coords[0], lat: coords[1] }, point);
      if (best === null || d < best) {
        best = d;
      }
      return;
    }
    if (Array.isArray(coords)) {
      for (const entry of coords) {
        consider(entry);
      }
    }
  };

  if (geometry && 'coordinates' in geometry) {
    consider((geometry as { coordinates: unknown }).coordinates);
  }
  return best;
}

/** Der Name eines Features, falls es einen trägt. OpenMapTiles legt ihn unter
 *  `name` ab; lokalisierte Varianten (`name:de`) sind je nach Kachelbau da
 *  oder nicht, deshalb nur als Ergänzung. */
export function featureName(feature: GeoJSONFeature, preferredLang?: string): string | null {
  const props = feature.properties ?? {};
  const candidates = preferredLang ? [preferredLang, 'name'] : ['name'];
  for (const key of candidates) {
    const value = props[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

export interface ResolvePlaceNameInput {
  map: MapLibreMap;
  point: LatLon;
  /** z. B. `'name:de'` aus den Stil-Optionen. */
  preferredLang?: string;
  sourceId?: string;
}

/**
 * Sucht in den geladenen Kacheln den Namen, der am besten zu diesem Punkt
 * passt. `null`, wenn keiner nah genug ist — dann bleiben die Koordinaten
 * stehen.
 *
 * Wirft nie: `querySourceFeatures` wirft bei einer Quelle/Ebene, die es (noch)
 * nicht gibt, und ein Ziel muss sich auch dann setzen lassen. Ein Name ist
 * ein Komfort, kein Teil der Navigation.
 */
export function resolvePlaceName({
  map,
  point,
  preferredLang,
  sourceId = REGION_SOURCE_ID,
}: ResolvePlaceNameInput): string | null {
  // ─── EINE FEHLENDE QUELLE IST EIN PROGRAMMFEHLER, KEIN BETRIEBSZUSTAND ────
  // Eine fehlende Ebene ist normal (nicht jedes Archiv fuehrt `poi`) und wird
  // unten still uebersprungen. Eine fehlende QUELLE dagegen heisst: hier
  // steht der falsche Name, und dann liefert diese Funktion fuer immer
  // `null`, ohne dass irgendetwas darauf hinweist. Genau so ist der Tippfehler
  // `'region'` statt `'yapaja-region'` durch 0.3.2 gekommen. Einmal ins
  // Protokoll, damit der naechste Fall in einer Minute statt in einer Version
  // gefunden wird.
  if (typeof map.getSource === 'function' && !map.getSource(sourceId)) {
    if (!warnedMissingSources.has(sourceId)) {
      warnedMissingSources.add(sourceId);
      // eslint-disable-next-line no-console -- siehe oben: genau dafuer da.
      console.warn(
        `[placeName] Vektorquelle "${sourceId}" gibt es in diesem Stil nicht — ` +
          'angetippte Ziele bleiben deshalb ohne Namen.',
      );
    }
    return null;
  }

  for (const sourceLayer of LOOKUP_LAYERS) {
    const limit =
      sourceLayer === 'place' ? MAX_PLACE_DISTANCE_DEG : MAX_NAME_DISTANCE_DEG;
    const limitSquared = limit * limit;

    let features: GeoJSONFeature[];
    try {
      features = map.querySourceFeatures(sourceId, { sourceLayer });
    } catch {
      continue;
    }

    let bestName: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const feature of features) {
      const name = featureName(feature, preferredLang);
      if (name === null) {
        continue;
      }
      const distance = nearestVertexDistanceSquared(feature.geometry, point);
      if (distance === null || distance > limitSquared) {
        continue;
      }
      if (distance < bestDistance) {
        bestDistance = distance;
        bestName = name;
      }
    }

    if (bestName !== null) {
      return bestName;
    }
  }

  return null;
}
