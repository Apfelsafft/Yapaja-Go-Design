/**
 * „Steht das Fahrzeug?" -- und warum das ueber „GPS verloren" entscheidet.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Du hast den GPS-Timeout eingestellt, wenn sich das Gerät nicht bewegt, und
 * es wird GPS inaktiv angezeigt. Die Idee war gut, aber auch verwirrend. Denn
 * wenn das Wohnmobil länger an einem Ort steht, sieht es so aus, als ob man
 * kein GPS-Empfang hat. Bitte finde einen anderen Weg, bspw. über die
 * Zeitstempel der GPS-Daten."
 *
 * ─── WARUM DER ZEITSTEMPEL ALLEIN ES NICHT LOEST ────────────────────────────
 * Das war mein erster Gedanke und er traegt nicht. Bisher wird das Alter ueber
 * die ANKUNFTSZEIT gemessen (`lastRealUpdateTime = Date.now()`). Miesse ich
 * es stattdessen ueber `Position.ts`, den Zeitstempel des Fixes selbst,
 * altert genau derselbe Wert -- sobald keine Daten mehr kommen, wird beides
 * gleich alt. Der Hinweis erschiene weiterhin.
 *
 * Die Frage ist eine andere: WAS unterscheidet „steht geparkt, Empfang
 * einwandfrei" von „Empfang weg"?
 *
 * ─── DIE ANTWORT ────────────────────────────────────────────────────────────
 * Ob ein Ausbleiben von Daten ueberhaupt ueberraschend ist.
 *
 *   * Quellen wie die Home-Assistant-App melden, wenn es etwas zu melden
 *     gibt. Steht das Fahrzeug, gibt es nichts -- Ausbleiben ist der
 *     NORMALFALL, kein Ausfall.
 *   * Fuhr das Fahrzeug dagegen gerade noch und die Daten hoeren auf, ist das
 *     tatsaechlich ein Grund zur Warnung.
 *
 * Deshalb entscheidet nicht mehr die Zeit allein, sondern die Zeit ZUSAMMEN
 * mit dem letzten bekannten Bewegungszustand.
 *
 * ─── WORAN STILLSTAND ERKANNT WIRD ──────────────────────────────────────────
 * Zwei Wege, weil einer allein nicht reicht:
 *
 *   1. `Position.speed`, wenn die Quelle sie liefert. Am direktesten.
 *   2. Der Abstand zum vorherigen Fix, wenn nicht. Der Browser-Standort
 *      liefert `speed` haeufig als `null` -- verliesse man sich nur auf (1),
 *      bliebe der gemeldete Fehler fuer genau diese Nutzer bestehen.
 *
 * Ist beides unbekannt, gilt weiterhin „verloren". Das ist die vorsichtige
 * Seite: lieber einmal zu viel gewarnt als einen echten Ausfall verschwiegen.
 *
 * ─── DIE LUECKE, DIE BLEIBT -- UND WARUM SIE SO BLEIBT ──────────────────────
 * Steht das Fahrzeug und der Empfang faellt WIRKLICH aus, bleibt es beim
 * letzten bekannten Stand: „steht". Faehrt der Betreiber dann los, kommen
 * mangels Empfang keine neuen Daten, und die Anzeige behauptet weiterhin
 * Stillstand.
 *
 * Naheliegend waere eine Verfallszeit („nach 15 Minuten wieder warnen").
 * Genau die brachte aber den gemeldeten Fehler zurueck: ein Wohnmobil steht
 * ueber Nacht, und morgens leuchtet wieder die Warnung, die niemand braucht.
 *
 * Die Luecke ist deshalb bewusst offen, weil sie an der Stelle auffaellt, an
 * der sie zaehlt: eine Navigation OHNE Position beginnt gar nicht erst --
 * `routing` antwortet mit `NO_POSITION`, sichtbar und mit Begruendung. Eine
 * Warnung auf der Karte im Stand haette daran nichts verbessert; sie haette
 * nur dauerhaft geleuchtet und damit auch die echten Warnungen entwertet.
 */

import type { Position } from '@yapaja/shared';

/**
 * Bis zu welcher Geschwindigkeit ein Fahrzeug als stehend gilt (m/s).
 *
 * 0,5 m/s sind 1,8 km/h. Darunter liegt kein Fahren mehr, sondern das
 * Rauschen eines GPS-Empfaengers im Stand -- der zeigt selten exakt 0.
 */
export const STANDSTILL_SPEED_MPS = 0.5;

/**
 * Wie weit zwei Fixe auseinanderliegen duerfen und trotzdem „derselbe Ort"
 * heissen (Meter).
 *
 * 15 m deckt die uebliche Streuung eines ruhenden Empfaengers ab, ohne dass
 * langsames Rollen (Schrittgeschwindigkeit ueber mehrere Sekunden) schon als
 * Stillstand durchginge.
 */
export const STANDSTILL_RADIUS_M = 15;

const EARTH_RADIUS_M = 6_371_000;

/** Abstand zweier Punkte in Metern (Haversine). */
export function distanceMeters(a: Position, b: Position): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface StandstillInput {
  /** Der letzte echte Fix. */
  latest: Position | null | undefined;
  /** Der Fix davor, falls einer bekannt ist. */
  previous: Position | null | undefined;
}

/**
 * Ob das Fahrzeug beim letzten bekannten Stand gestanden hat.
 *
 * `false` heisst nicht „es faehrt", sondern „es ist nicht belegt, dass es
 * steht" -- und nur ein Beleg darf die Warnung unterdruecken.
 */
export function wasStandingStill({ latest, previous }: StandstillInput): boolean {
  if (!latest) return false;

  // (1) Die Quelle sagt es selbst.
  if (typeof latest.speed === 'number' && Number.isFinite(latest.speed)) {
    return latest.speed <= STANDSTILL_SPEED_MPS;
  }

  // (2) Ohne Geschwindigkeit: hat sich der Ort bewegt?
  if (previous) {
    return distanceMeters(previous, latest) <= STANDSTILL_RADIUS_M;
  }

  // Weder noch -- keine Aussage moeglich.
  return false;
}
