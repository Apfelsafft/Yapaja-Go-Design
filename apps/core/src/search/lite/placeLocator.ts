/**
 * Findet zu einem Punkt den Ort, in dem er liegt.
 *
 * ─── WOFUER ─────────────────────────────────────────────────────────────────
 * Gemeldet: „Wenn ich Beethoven eintippe, gib bitte den Ort mit an, in dem
 * sich der jeweilige Eintrag befindet." In Rheinland-Pfalz gibt es ein paar
 * hundert Beethovenstraßen; ohne Ortsangabe sind die Vorschläge nicht
 * auseinanderzuhalten.
 *
 * Sonderziele tragen den Ort oft selbst (`addr:city`) — dann wird DER
 * genommen, er ist die bessere Auskunft. Straßen tragen ihn so gut wie nie.
 * Für alles Übrige beantwortet diese Datei die Frage aus den Ortsdaten, die
 * ohnehin im selben Index liegen.
 *
 * ─── WARUM NICHT AUS GRENZEN ────────────────────────────────────────────────
 * Sauber wäre die Gemeindegrenze (`boundary=administrative`). Die steckt aber
 * nicht im Extrakt, den `yapaja-build-lite-index` zieht, und sie mitzunehmen
 * hiesse: Relationen aufloesen, Polygone bauen, Punkt-in-Polygon fuer
 * Millionen Datensaetze. Auf dem Geraet des Betreibers gebaut, mit dem
 * Deutschland-Extrakt als Ziel, ist das die falsche Rechnung.
 *
 * Genommen wird deshalb der NAECHSTE Ort. Das ist eine Naeherung, und sie ist
 * an einer Gemeindegrenze gelegentlich daneben. Sie ist aber fast immer die
 * Auskunft, die der Frage „welche der 300 Beethovenstraßen ist das?" hilft --
 * und sie luegt nicht, wo sie nichts weiss: ueber `MAX_LOCALITY_KM` hinaus
 * liefert sie `null`, statt einen Ort zu behaupten, der 80 km weg ist.
 *
 * ─── WARUM EIN GITTER ───────────────────────────────────────────────────────
 * Deutschland: rund drei Millionen Strassen und Sonderziele gegen einige
 * zehntausend Orte. Paarweise waeren das ~10^11 Vergleiche -- der Bau liefe
 * nie durch. Das Gitter macht aus jeder Abfrage eine Handvoll Vergleiche.
 */

import type { LiteKind } from './ranking.js';

export interface PlacePoint {
  name: string;
  kind: LiteKind;
  lat: number;
  lon: number;
}

/**
 * Kantenlaenge einer Gitterzelle in Grad. 0,1° sind rund 11 km in der Breite
 * und in unseren Breitengraden rund 7 km in der Laenge -- klein genug, dass
 * eine Zelle wenige Orte enthaelt, gross genug, dass die Suche selten mehr
 * als den ersten Ring braucht.
 */
const CELL_DEG = 0.1;

/**
 * Weiter entfernt wird kein Ort mehr behauptet. Ein Rasthof mitten in der
 * Eifel gehoert zu keinem Ort; „Rasthof, Koblenz" waere schlicht falsch.
 */
export const MAX_LOCALITY_KM = 25;

/**
 * Obergrenze fuer die Ringsuche.
 *
 * Ohne sie waechst die Zahl der abgesuchten Zellen mit dem Quadrat von
 * `MAX_LOCALITY_KM` -- und zwar in JEDER Abfrage, von der es beim
 * Deutschland-Bau Millionen gibt. Beim Mutationstest dieser Datei (Grenze
 * versuchsweise auf 100 000 km) lief die Suche daraufhin nicht mehr durch.
 * Das ist bei 25 km keine reale Gefahr, aber eine spaetere Aenderung der
 * Konstante wuerde den Bau sonst lautlos zum Stehen bringen.
 *
 * 6 Ringe sind bei 0,1°-Zellen rund 65 km -- mehr als `MAX_LOCALITY_KM` je
 * brauchen wird.
 */
const MAX_RING = 6;

function cellKey(lat: number, lon: number): string {
  return `${Math.floor(lat / CELL_DEG)}:${Math.floor(lon / CELL_DEG)}`;
}

/** Gleiche Formel wie in `ranking.ts`/`reader.ts` -- siehe dort, warum die
 *  sechs Zeilen je Modul stehen statt geteilt zu werden. */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class PlaceLocator {
  private readonly grid = new Map<string, PlacePoint[]>();
  readonly size: number;

  constructor(places: readonly PlacePoint[]) {
    for (const place of places) {
      const key = cellKey(place.lat, place.lon);
      const bucket = this.grid.get(key);
      if (bucket) bucket.push(place);
      else this.grid.set(key, [place]);
    }
    this.size = places.length;
  }

  /**
   * Der Name des naechsten Ortes, oder `null`, wenn keiner nah genug liegt.
   *
   * Gesucht wird in Ringen um die eigene Zelle. Ein Treffer im Ring `r`
   * garantiert noch nicht den naechsten Ort -- ein Ort im Ring `r+1` kann
   * naeher liegen, wenn der erste am aeusseren Zellenrand sitzt. Deshalb wird
   * nach dem ersten Treffer noch EIN Ring weiter gesucht, bevor entschieden
   * wird.
   */
  nearestName(lat: number, lon: number): string | null {
    const centerLatCell = Math.floor(lat / CELL_DEG);
    const centerLonCell = Math.floor(lon / CELL_DEG);
    const maxRing = Math.min(Math.ceil(MAX_LOCALITY_KM / (CELL_DEG * 111)) + 1, MAX_RING);

    let best: PlacePoint | null = null;
    let bestKm = Infinity;
    let ringAfterFirstHit = -1;

    for (let ring = 0; ring <= maxRing; ring += 1) {
      for (let dLat = -ring; dLat <= ring; dLat += 1) {
        for (let dLon = -ring; dLon <= ring; dLon += 1) {
          // Nur der RAND des Rings -- das Innere war in einer frueheren Runde dran.
          if (ring > 0 && Math.abs(dLat) !== ring && Math.abs(dLon) !== ring) continue;
          const bucket = this.grid.get(`${centerLatCell + dLat}:${centerLonCell + dLon}`);
          if (!bucket) continue;
          for (const place of bucket) {
            const km = haversineKm(lat, lon, place.lat, place.lon);
            if (km < bestKm) {
              bestKm = km;
              best = place;
            }
          }
        }
      }
      if (best && ringAfterFirstHit < 0) ringAfterFirstHit = ring;
      // Einen Ring ueber den ersten Treffer hinaus, dann steht die Antwort fest.
      if (ringAfterFirstHit >= 0 && ring > ringAfterFirstHit) break;
    }

    if (!best || bestKm > MAX_LOCALITY_KM) return null;

    // Bewusst der Name AUS dem Ortsdatensatz, ohne Kopie und ohne
    // Zwischenspeicher: es gibt je Ort genau einen solchen Datensatz, also
    // teilen sich alle Millionen Treffer, die auf ihn zeigen, ohnehin dieselbe
    // Zeichenkette. Hier stand kurzzeitig ein „Interning"-Speicher, der genau
    // das noch einmal getan haette -- er kostete eine Map ueber alle Ortsnamen
    // und sparte kein Byte.
    return best.name;
  }
}
