/**
 * Die Fahrtrichtung im Stand — und warum sie dort keine ist.
 *
 * ─── GEMELDET ───────────────────────────────────────────────────────────────
 * „Der Sensor liegt ruhig auf der Fensterbank aber die Anzeige der Karte dreht
 * sich andauernd."
 *
 * Aus dem Protokoll, drei aufeinanderfolgende Fixes desselben, unbewegten
 * VK-162:
 *
 *   22:58:24   track 170.5°   speed 0.025 m/s
 *   23:00:33   track  39.6°   speed 0.016 m/s
 *   23:00:38   track 187.0°   speed 0.036 m/s
 *
 * Die Richtung springt über 150°, während sich das Gerät mit zwei bis vier
 * Zentimetern je Sekunde „bewegt".
 *
 * ─── DAS IST KEIN FEHLER DES EMPFAENGERS ────────────────────────────────────
 * GNSS misst keine Himmelsrichtung. Es misst Positionen und leitet die
 * Richtung aus der BEWEGUNG zwischen zweien ab (course over ground). Steht das
 * Gerät, ist die gemessene Bewegung reines Rauschen, und die Richtung daraus
 * ist eine Zufallszahl zwischen 0 und 360. Jeder Empfänger tut das; ein Kompass
 * wäre etwas anderes, den hat der VK-162 nicht.
 *
 * ─── DESHALB: KEINE RICHTUNG STATT EINER ERFUNDENEN ─────────────────────────
 * Unterhalb {@link RICHTUNG_MIN_TEMPO_MS} wird `heading` auf `null` gesetzt.
 *
 * `null` und nicht „die letzte gültige weiterreichen": eine Richtung, die
 * niemand gemessen hat, gehört nicht in eine Schnittstelle, die auch nach MQTT
 * und in Home-Assistant-Entitäten geht. `null` heißt „unbekannt", und das ist
 * im Stand die Wahrheit.
 *
 * Die Oberfläche kommt damit von selbst richtig heraus: `map/viewMode.ts`
 * dreht die Karte nur, wenn eine Richtung DA ist, und lässt die Kamera sonst
 * stehen. Aus „unbekannt" wird also „es bleibt, wie es war" — genau das, was
 * man im Stand sehen will. Eine Hysterese braucht es dafür nicht: pendelt das
 * Tempo um die Schwelle, wechselt `heading` zwischen Wert und `null`, und
 * `null` bewegt nichts.
 */

import type { Position } from '@yapaia/shared';

/**
 * Ab diesem Tempo gilt die Richtung als gemessen — 1,0 m/s sind 3,6 km/h.
 *
 * Deutlich über dem beobachteten Rauschen (0,036 m/s, also das
 * Siebenundzwanzigfache Abstand) und deutlich unter allem, was in einem
 * Wohnmobil als Fahren durchgeht. Schrittgeschwindigkeit auf dem Stellplatz
 * liegt darunter — dort ist die letzte bekannte Ausrichtung der Karte
 * brauchbarer als eine, die sich alle zwei Sekunden um 150° dreht.
 */
export const RICHTUNG_MIN_TEMPO_MS = 1.0;

/**
 * Entfernt die Richtung, wenn das Tempo zu klein ist, um eine herzugeben.
 *
 * Gibt die Position unverändert zurück, wenn nichts zu tun ist — so bleibt die
 * Objektidentität erhalten, wo es keine Änderung gibt.
 *
 * Ist das TEMPO unbekannt (`null`), bleibt die Richtung stehen: dann lässt
 * sich nicht beurteilen, ob sie Rauschen ist, und eine Quelle, die Richtung
 * aber kein Tempo liefert, soll nicht stumm ihre einzige Richtungsangabe
 * verlieren.
 */
export function richtungImStandVerwerfen(position: Position): Position {
  if (position.heading === null) return position;
  if (position.speed === null) return position;
  if (position.speed >= RICHTUNG_MIN_TEMPO_MS) return position;
  return { ...position, heading: null };
}
