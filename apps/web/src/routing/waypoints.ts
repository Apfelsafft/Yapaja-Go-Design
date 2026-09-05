/**
 * Zwischenziele -- die Liste und ihre Reihenfolge.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Bitte fuege die Moeglichkeit von Zwischenzielen ein. Bei Routenplanung
 * bzw. auch waehrend aktiver Navigation soll man Zwischenziele einfuegen und
 * in der Reihenfolge sortieren koennen."
 *
 * ─── WAS SCHON DA WAR ───────────────────────────────────────────────────────
 * `RouteRequest.waypoints` gibt es seit jeher, der Core reicht sie an
 * Valhalla weiter und prueft sogar die Kartenabdeckung fuer jedes einzelne.
 * Der Browser schickte an dieser Stelle fest verdrahtet `waypoints: []` --
 * die Leitung lag, es hing nur nichts daran.
 *
 * ─── WARUM DIE LISTENOPERATIONEN HIER STEHEN ────────────────────────────────
 * Als reine Funktionen sind sie ohne Speicher und ohne Rendern pruefbar.
 * Umsortieren ist die Sorte Code, bei der ein Fehler am Rand (erstes/letztes
 * Element) leicht durchrutscht und im Fahrzeug dann eine Route ergibt, die
 * niemand wollte.
 */

import type { LatLng } from '@yapaja/shared';

/**
 * Hoechstzahl an Zwischenzielen.
 *
 * Nicht ausgedacht: `RouteRequest.waypoints` ist im geteilten Typ mit
 * „max 25" beschrieben, und der Core prueft fuer JEDES die Kartenabdeckung.
 * Die Oberflaeche haelt sich an dieselbe Zahl, damit eine Anfrage nicht erst
 * beim Server auffliegt.
 */
export const MAX_WAYPOINTS = 25;

export interface Waypoint {
  id: string;
  latlng: LatLng;
  /** Klartextname, falls die Kacheln oder die Suche einen hergaben. */
  name: string | null;
}

let counter = 0;

export function nextWaypointId(): string {
  counter += 1;
  return `wp-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/** Ob noch ein weiteres Zwischenziel hinzukommen darf. */
export function canAddWaypoint(waypoints: readonly Waypoint[]): boolean {
  return waypoints.length < MAX_WAYPOINTS;
}

/**
 * Haengt ein Zwischenziel ans ENDE der Liste.
 *
 * Ans Ende und nicht an die naechstgelegene Stelle: eine Automatik, die die
 * Reihenfolge selbst waehlt, muesste raten, was gemeint ist -- und der
 * Betreiber hat ausdruecklich darum gebeten, selbst sortieren zu koennen.
 * Ist die Liste voll, bleibt sie unveraendert (dieselbe Referenz), damit der
 * Aufrufer den Unterschied sieht.
 */
export function addWaypoint(
  waypoints: readonly Waypoint[],
  latlng: LatLng,
  name: string | null = null,
): Waypoint[] {
  if (!canAddWaypoint(waypoints)) return [...waypoints];
  return [...waypoints, { id: nextWaypointId(), latlng, name }];
}

export function removeWaypoint(waypoints: readonly Waypoint[], id: string): Waypoint[] {
  return waypoints.filter((w) => w.id !== id);
}

/**
 * Verschiebt ein Zwischenziel um eine Position.
 *
 * Am Rand passiert NICHTS -- kein Umlauf ans andere Ende. Ein Eintrag, der
 * beim Tippen auf „hoch" ganz nach unten springt, ist im Fahrzeug eine
 * Ueberraschung, keine Bedienung.
 */
export function moveWaypoint(
  waypoints: readonly Waypoint[],
  id: string,
  direction: 'up' | 'down',
): Waypoint[] {
  const index = waypoints.findIndex((w) => w.id === id);
  if (index < 0) return [...waypoints];

  const ziel = direction === 'up' ? index - 1 : index + 1;
  if (ziel < 0 || ziel >= waypoints.length) return [...waypoints];

  const next = [...waypoints];
  [next[index], next[ziel]] = [next[ziel], next[index]];
  return next;
}

/** Ob sich dieser Eintrag in diese Richtung ueberhaupt bewegen laesst. */
export function canMove(
  waypoints: readonly Waypoint[],
  id: string,
  direction: 'up' | 'down',
): boolean {
  const index = waypoints.findIndex((w) => w.id === id);
  if (index < 0) return false;
  return direction === 'up' ? index > 0 : index < waypoints.length - 1;
}

/** Was an den Core geht -- nur die Koordinaten, in genau dieser Reihenfolge. */
export function toRequestWaypoints(waypoints: readonly Waypoint[]): LatLng[] {
  return waypoints.map((w) => w.latlng);
}

/**
 * Beschriftung eines Eintrags.
 *
 * Ohne Namen die Koordinaten -- nie ein leerer Eintrag, den man in der Liste
 * nicht auseinanderhalten kann.
 */
export function waypointLabel(waypoint: Waypoint): string {
  if (waypoint.name && waypoint.name.trim().length > 0) return waypoint.name;
  return `${waypoint.latlng.lat.toFixed(5)}, ${waypoint.latlng.lon.toFixed(5)}`;
}
