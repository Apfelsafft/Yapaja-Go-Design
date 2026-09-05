/**
 * Welche Zwischenziele noch vor einem liegen.
 *
 * ─── DER FEHLER, DEN DAS BEHEBT ─────────────────────────────────────────────
 * `RerouteContext.waypoints` trug seit E04-T5 den Kommentar „passed through
 * as-is; E04-T5 prunes visited ones". Diese Bereinigung gab es nicht:
 * `rerouteContext` wird beim Start gesetzt und beim Stoppen geleert,
 * dazwischen nie veraendert. Wer also an einem Zwischenziel vorbei war und
 * dann falsch abbog, wurde von der Neuberechnung ZURUECK zum bereits
 * besuchten Zwischenziel geschickt -- im Wohnmobil eine Wendeaufforderung
 * ohne Anlass.
 *
 * Ein Kommentar, der eine Zusage macht, die der Code nicht einloest, ist
 * schlimmer als gar keiner: er verhindert, dass jemand nachsieht.
 *
 * ─── WIE „SCHON PASSIERT" BESTIMMT WIRD ─────────────────────────────────────
 * Die Route wurde so gebaut, dass sie die Zwischenziele der Reihe nach
 * beruehrt. Jedes laesst sich also auf die Strecke projizieren und bekommt
 * eine Position in Metern ab Start. Liegt sie hinter dem Fahrzeug, ist das
 * Zwischenziel abgehakt.
 *
 * ─── WARUM IM ZWEIFEL BEHALTEN WIRD ─────────────────────────────────────────
 * Liegt ein Zwischenziel weit neben der Strecke, ist die Projektion nicht
 * aussagekraeftig -- die Stelle, die dabei herauskommt, hat mit dem
 * gewuenschten Ort wenig zu tun. Dann wird es BEHALTEN.
 *
 * Beide Fehlerrichtungen sind unangenehm, aber sie sind nicht gleich
 * schlimm: ein faelschlich behaltenes Zwischenziel sieht man auf der Karte
 * und kann es wegnehmen. Ein faelschlich verworfenes verschwindet
 * stillschweigend, und man merkt es erst, wenn man daran vorbeigefahren ist.
 * Deshalb im Zweifel behalten.
 */

import type { LatLng } from '@yapaja/shared';
import { matchPosition, type RouteGeometry } from './mapMatching.js';

/**
 * Wie weit ein Zwischenziel hoechstens neben der Strecke liegen darf, damit
 * seine Projektion als aussagekraeftig gilt (Meter).
 *
 * Grosszuegig gewaehlt: ein Zwischenziel wird auf einen Parkplatz, eine
 * Hausnummer oder einen Ortsmittelpunkt gesetzt, waehrend die Route auf der
 * Durchgangsstrasse bleibt. 150 m deckt das ab, ohne dass ein Ort auf der
 * ANDEREN Seite eines Tals noch mitgezaehlt wuerde.
 */
export const WAYPOINT_ON_ROUTE_RADIUS_M = 150;

/**
 * Wie weit das Fahrzeug hinter dem Zwischenziel sein muss, damit es als
 * passiert gilt (Meter).
 *
 * Nicht 0: die Positionsbestimmung schwankt, und genau auf Hoehe des
 * Zwischenziels wuerde es sonst zwischen „passiert" und „noch nicht" hin und
 * her springen -- bei jeder Neuberechnung eine andere Route.
 */
export const WAYPOINT_PASSED_MARGIN_M = 25;

export interface WaypointAnchor {
  waypoint: LatLng;
  /** Ursprungsposition in der Liste -- die Reihenfolge bleibt erhalten. */
  index: number;
  /** Meter ab Streckenanfang, oder `null` wenn zu weit neben der Strecke. */
  progressM: number | null;
  crossTrackM: number;
}

/**
 * Projiziert jedes Zwischenziel auf die Strecke.
 *
 * Gesucht wird ueber die GANZE Strecke (`prevProgressM: null`) und nicht in
 * einem Fenster: ein Zwischenziel ist ein fester Ort, kein fortlaufender
 * Positionsstrom, und das Fenster der Fahrzeugverfolgung ergaebe hier keinen
 * Sinn.
 */
export function anchorWaypoints(
  waypoints: readonly LatLng[],
  geom: RouteGeometry,
): WaypointAnchor[] {
  return waypoints.map((waypoint, index) => {
    const match = matchPosition(geom, { lat: waypoint.lat, lon: waypoint.lon }, null);
    const nahGenug = match.crossTrackM <= WAYPOINT_ON_ROUTE_RADIUS_M;
    return {
      waypoint,
      index,
      progressM: nahGenug ? match.progressM : null,
      crossTrackM: match.crossTrackM,
    };
  });
}

/**
 * Die Zwischenziele, die noch anzufahren sind.
 *
 * Reihenfolge bleibt erhalten -- der Betreiber hat sie ja bewusst sortiert.
 */
export function remainingWaypoints(
  waypoints: readonly LatLng[],
  geom: RouteGeometry,
  currentProgressM: number | null,
): LatLng[] {
  // Ohne bekannte Fahrzeugposition ist nichts nachweislich passiert. Alles
  // behalten -- siehe „im Zweifel behalten" im Kopfkommentar.
  if (typeof currentProgressM !== 'number' || !Number.isFinite(currentProgressM)) {
    return [...waypoints];
  }

  return anchorWaypoints(waypoints, geom)
    .filter((anchor) => {
      if (anchor.progressM === null) return true; // zu weit weg -> nicht beurteilbar
      return anchor.progressM > currentProgressM - WAYPOINT_PASSED_MARGIN_M;
    })
    .map((anchor) => anchor.waypoint);
}
