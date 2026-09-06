/**
 * Die Route an der aktuellen Position auftrennen -- gefahren / noch vor uns.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Die abgefahrene Strecke bleibt weiterhin blau."
 *
 * Das ist der letzte offene Punkt aus der Testfahrt. Die Linie sah nach der
 * halben Strecke genauso aus wie am Anfang: durchgehend blau, in beide
 * Richtungen. Wer kurz aufsieht, muss aber auf einen Blick erkennen, wohin es
 * WEITERGEHT -- nicht, wo man schon war.
 *
 * ─── WOHER DER FORTSCHRITT KOMMT ────────────────────────────────────────────
 * Nicht aus einer zweiten Berechnung im Browser. Der Core kartenabgleicht
 * jede Position auf die Route und veroeffentlicht das Ergebnis bereits als
 * `distance_remaining_m` (siehe `navigation/service.ts#buildState`:
 * `distance_remaining_m = totalLengthM − progress`). Der Weg zurueck ist
 * also eine Subtraktion.
 *
 * Damit die Subtraktion aufgeht, muss die Laenge hier GENAUSO gerechnet
 * werden wie dort: Haversine ueber dieselben entschluesselten Stuetzpunkte,
 * derselbe Erdradius, dieselbe Reihenfolge (`mapMatching.ts`
 * #buildRouteGeometryFromPoints). Genau das tut {@link cumulativeMeters}.
 * Eine eigene Fortschrittsrechnung im Browser waere eine zweite Wahrheit --
 * und zwei Wahrheiten ueber die gefahrene Strecke sind schlimmer als eine
 * durchgehend blaue Linie.
 *
 * ─── IM ZWEIFEL BLAU ────────────────────────────────────────────────────────
 * Grau heisst „das liegt hinter dir". Faerbt man versehentlich Strecke grau,
 * die noch kommt, nimmt man dem Fahrer die Fuehrung. Faerbt man versehentlich
 * Gefahrenes blau, ist es bloss unschoen. Deshalb liefert jeder unklare Fall
 * hier „alles blau": keine Zahl, unbrauchbare Zahl, Fortschritt <= 0.
 */

import { haversineMeters } from '../search/distance.js';

/** GeoJSON-Reihenfolge: `[lon, lat]` -- wie `decodePolyline6` sie liefert. */
export type Coord = [number, number];

export interface RouteSplit {
  /** Bereits gefahren. Leer, solange nichts gefahren wurde. */
  traveled: Coord[];
  /** Noch vor uns. Leer erst nach dem letzten Meter. */
  remaining: Coord[];
}

/**
 * `cumulative[i]` = Meter vom Routenanfang bis `coords[i]`.
 *
 * Bewusst dieselbe Formel und dieselbe Summierungsreihenfolge wie im Core --
 * siehe Kopfkommentar. Ein anderer Erdradius oder eine andere Reihenfolge
 * ergaebe eine Gesamtlaenge, die um Meter danebenliegt, und damit einen
 * Trennpunkt, der sichtbar hinter oder vor dem Fahrzeug haengt.
 */
export function cumulativeMeters(coords: readonly Coord[]): number[] {
  const cumulative = new Array<number>(coords.length);
  if (coords.length === 0) return cumulative;
  cumulative[0] = 0;
  for (let i = 1; i < coords.length; i++) {
    cumulative[i] =
      cumulative[i - 1] +
      haversineMeters(
        { lat: coords[i - 1][1], lon: coords[i - 1][0] },
        { lat: coords[i][1], lon: coords[i][0] },
      );
  }
  return cumulative;
}

/**
 * Der zurueckgelegte Weg in Metern, aus der Restentfernung des Cores.
 *
 * `null` heisst „unbekannt" und fuehrt beim Aufrufer zu einer durchgehend
 * blauen Linie -- siehe „Im Zweifel blau".
 */
export function progressFromRemaining(
  totalM: number,
  distanceRemainingM: number | null | undefined,
): number | null {
  if (distanceRemainingM === null || distanceRemainingM === undefined) return null;
  if (!Number.isFinite(distanceRemainingM) || !Number.isFinite(totalM)) return null;
  return totalM - distanceRemainingM;
}

/**
 * Die Linie bei `progressM` auftrennen.
 *
 * Der Trennpunkt wird auf dem Abschnitt interpoliert und gehoert BEIDEN
 * Haelften an: er ist der letzte Punkt der gefahrenen und der erste der
 * verbleibenden. Ohne das klaffte an der Fahrzeugposition eine Luecke in der
 * Route -- genau dort, wo man hinsieht.
 */
export function splitRouteAtProgress(
  coords: readonly Coord[],
  cumulative: readonly number[],
  progressM: number | null,
): RouteSplit {
  // Weniger als zwei Punkte ergeben keine Linie -- nichts aufzutrennen.
  if (coords.length < 2) return { traveled: [], remaining: [...coords] };

  const totalM = cumulative[cumulative.length - 1];
  if (progressM === null || !Number.isFinite(progressM) || progressM <= 0) {
    return { traveled: [], remaining: [...coords] };
  }
  if (progressM >= totalM) return { traveled: [...coords], remaining: [] };

  // Den Abschnitt suchen, auf dem der Fortschritt liegt.
  let i = 0;
  while (i < coords.length - 2 && cumulative[i + 1] <= progressM) i++;

  // ─── WARUM HIER KEINE ABFRAGE AUF NULLLAENGE STEHT ────────────────────────
  // Doppelte Stuetzpunkte kommen in echten Geometrien vor, und 0/0 waere ein
  // Trennpunkt aus zwei NaN. Erreichbar ist der Fall hier aber nicht: die
  // Schleife haelt die Zusicherung `cumulative[i] <= progressM` aufrecht (sie
  // rueckt nur vor, solange `cumulative[i+1] <= progressM`), und sie endet
  // entweder bei `cumulative[i+1] > progressM` oder auf dem letzten
  // Abschnitt, dessen Ende `totalM` ist -- und `progressM < totalM` steht
  // oben schon fest. Beide Male ist `cumulative[i+1] > cumulative[i]`.
  //
  // Eine Abfrage stand hier zuerst. Kein Test konnte sie ausloesen (die
  // Mutation „Abfrage entfernt" ueberlebte), also war sie Beruhigung statt
  // Schutz. An ihrer Stelle prueft `traveledSplit.test.ts` die Eigenschaft
  // selbst: Linien mit doppelten Punkten, ueber die ganze Laenge abgetastet.
  const segLenM = cumulative[i + 1] - cumulative[i];
  const t = (progressM - cumulative[i]) / segLenM;
  const split: Coord = [
    coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
    coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t,
  ];

  // Faellt der Fortschritt GENAU auf einen Stuetzpunkt (t === 0), ist dieser
  // bereits das letzte Element der gefahrenen Haelfte -- ihn dann nochmals
  // anzuhaengen ergaebe einen doppelten Punkt.
  const traveled = coords.slice(0, i + 1);
  if (t > 0) traveled.push(split);

  return { traveled, remaining: [split, ...coords.slice(i + 1)] };
}
