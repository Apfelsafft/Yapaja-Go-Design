/**
 * Tempo und Höhe aus der GPS-Position — auch ohne laufende Route.
 *
 * ─── DER GEMELDETE FALL ─────────────────────────────────────────────────────
 * Aus den Entwicklerwerkzeugen, alle Yapaia-Entitäten nebeneinander:
 *
 *     device_tracker.yapaja_vehicle   not_home
 *                                     latitude: 49.239076998
 *                                     longitude: 8.320296238
 *                                     gps_accuracy: 53.2
 *     sensor.yapaja_nav_state         idle
 *     sensor.yapaja_speed             unknown
 *     sensor.yapaja_altitude          unknown
 *
 * Das GPS lieferte also gerade eine Position — auf zehn Nachkommastellen —,
 * und im selben Augenblick stand beim Tempo „unbekannt". Beides zugleich.
 *
 * ─── WARUM DAS SO WAR ───────────────────────────────────────────────────────
 * `statesBridge.ts` nahm Tempo und Höhe AUSSCHLIESSLICH aus `navState`, und
 * den gibt es nur, solange eine Route läuft. Die Position dagegen kommt vom
 * GPS und liegt immer an. Dass sie `speed` und `alt` mitbringt, steht seit
 * jeher im Schema — beide sind dort sogar PFLICHTFELDER:
 *
 *     speed: „Speed in m/s over ground"
 *     alt:   „Altitude in meters above mean sea level"
 *
 * Die Angabe war da. Sie wurde nur nicht abgeholt.
 *
 * Für das runde Display im Fahrzeug ist genau das der Unterschied zwischen
 * „zeigt etwas" und „zeigt nichts": ohne Route stand dort bisher nur
 * „Keine Route", obwohl Yapaia die gefahrene Geschwindigkeit kannte.
 *
 * ─── WAS HIER NICHT PASSIERT ────────────────────────────────────────────────
 * Geraten wird nichts. Ohne Satellitenfix ist ein Tempo kein Messwert,
 * sondern eine Zahl — und eine Zahl, die aussieht wie eine Messung, ist
 * schlimmer als ein ehrliches „unbekannt".
 */

import type { Position } from '@yapaia/shared';

/**
 * Meter je Sekunde in Kilometer je Stunde.
 *
 * Die Quelle rechnet in m/s (so steht es im Schema), Home Assistant bekommt
 * km/h (so steht es in `unit_of_measurement`). Die Umrechnung an genau einer
 * Stelle, benannt: zwei Stellen mit derselben 3,6 laufen früher oder später
 * auseinander, und ein Tempo, das um Faktor 3,6 danebenliegt, fällt beim
 * Ablesen nicht zwingend auf — 25 km/h auf der Landstraße sehen falsch aus,
 * 90 km/h aber plausibel.
 */
export const MS_JE_KMH = 3.6;

/**
 * Hat diese Position überhaupt einen Fix?
 *
 * `fix: 'none'` heißt: der Empfänger hat noch keine Lösung. Was dann in
 * `speed` steht, ist kein Messwert.
 */
export function hatFix(position: Position | null | undefined): boolean {
  return position?.fix === '2d' || position?.fix === '3d';
}

/** Eine Zahl, die wirklich eine ist. */
function zahl(wert: number | null | undefined): number | null {
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : null;
}

/**
 * Das Tempo in km/h aus der Position, oder `null`.
 *
 * Negative Werte gibt es nicht: „Geschwindigkeit über Grund" ist ein Betrag.
 * Das Schema schreibt `minimum: 0` vor — ein negativer Wert wäre also ein
 * Fehler der Quelle, und den weiterzureichen hiesse, ihn zu bestätigen.
 */
export function tempoAusPosition(position: Position | null | undefined): number | null {
  if (!hatFix(position)) return null;
  const roh = zahl(position?.speed);
  if (roh === null || roh < 0) return null;
  // Auf eine Nachkommastelle: das GPS misst nicht genauer, und eine
  // Tempoanzeige mit sechs Stellen behauptet eine Genauigkeit, die es nicht
  // gibt.
  return Math.round(roh * MS_JE_KMH * 10) / 10;
}

/**
 * Die Höhe in Metern aus der Position, oder `null`.
 *
 * ─── NUR BEI EINEM 3D-FIX ───────────────────────────────────────────────────
 * Eine Höhe braucht einen vierten Satelliten. Mit einem 2D-Fix steht in `alt`
 * entweder nichts oder der letzte bekannte Wert — und der kann aus einem
 * anderen Tal stammen. Für ein Wohnmobil vor einer Passhöhe ist das keine
 * Kleinigkeit.
 */
export function hoeheAusPosition(position: Position | null | undefined): number | null {
  if (position?.fix !== '3d') return null;
  const roh = zahl(position?.alt);
  if (roh === null) return null;
  return Math.round(roh);
}
