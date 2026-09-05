/**
 * Die Trefferliste nach Entfernung ordnen.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Bitte sortiere die Ergebnisse der Suche nach Entfernung. Das naechste
 * Ergebnis nach oben."
 *
 * ─── WAS VORHER PASSIERTE ───────────────────────────────────────────────────
 * Die Entfernung wurde je Treffer ANGEZEIGT -- sortiert wurde die Liste
 * nirgends. Die Reihenfolge kam unveraendert vom Server. Man sah also, wie
 * weit alles weg ist, und musste sich das naechste selbst heraussuchen.
 *
 * ─── WARUM DAS HIER STEHT UND NICHT IM SERVER ───────────────────────────────
 * Die Entfernung haengt an der AKTUELLEN Position, und die kennt der Browser
 * ohnehin schon -- er zeigt sie ja an. Im Server muesste sie zusaetzlich
 * mitgeschickt werden, und bei mehreren Suchdiensten (Offline-Index, Photon,
 * Nominatim) muesste jeder einzeln sortieren.
 *
 * ─── WAS NICHT SORTIERT WIRD ────────────────────────────────────────────────
 * Ohne bekannte Position bleibt die Reihenfolge, wie sie ist. Nach etwas zu
 * sortieren, das man nicht kennt, hiesse hier: nach nichts.
 */

import type { SearchResult } from '@yapaja/shared';
import { haversineMeters } from './distance.js';

export interface SortOrigin {
  lat: number;
  lon: number;
}

/**
 * Die Treffer, das naechste zuerst.
 *
 * Stabil: gleich weit entfernte Treffer behalten ihre bisherige Reihenfolge,
 * es entscheidet also weiterhin die Bewertung des Suchdienstes. Ohne diese
 * Zusicherung koennte dieselbe Suche zweimal verschiedene Listen ergeben.
 *
 * Die urspruengliche Liste bleibt unangetastet.
 */
export function sortResultsByDistance(
  results: readonly SearchResult[],
  origin: SortOrigin | null | undefined,
): SearchResult[] {
  if (!origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lon)) {
    return [...results];
  }

  return results
    .map((result, index) => ({
      result,
      index,
      distanceM: haversineMeters(origin, result.latlng),
    }))
    .sort((a, b) => a.distanceM - b.distanceM || a.index - b.index)
    .map((entry) => entry.result);
}
