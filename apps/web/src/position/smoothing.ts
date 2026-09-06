/**
 * Den blauen Punkt zwischen zwei Meldungen WANDERN lassen, statt ihn zu setzen.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Die Navigation wirkt immer noch abgehakt und nicht smooth. Der blaue Punkt
 * springt immer von Punkt zu Punkt anstelle sich flüssig zu bewegen."
 *
 * ─── WAS GEMESSEN WURDE ─────────────────────────────────────────────────────
 * Der Verdacht war, der Simulator liefere zu grobe Punkte. Nachgesehen:
 *
 *  - Der Simulator meldet EINE Position je simulierter Sekunde
 *    (`position/simulator/index.ts#scheduleNextTick`: 1000 ms / Zeitraffer).
 *  - Der Core gibt sie mit hoechstens 1 Hz weiter
 *    (`position/service.ts#publishThrottled`).
 *
 * Bei einfacher Geschwindigkeit kommt also EINE Meldung pro Sekunde im
 * Browser an -- genau wie bei einem echten Empfaenger. Bei 50 km/h sind das
 * Spruenge von 13,9 m. Im Zeitraffer stimmt der Verdacht dagegen: bei 32x
 * erzeugt der Simulator 32 Positionen je Sekunde, durchgelassen wird eine --
 * jede Meldung liegt dann rund 440 m weiter.
 *
 * Der Fehler ist aber nicht die Rate. Er ist, dass NICHTS dazwischen
 * gezeichnet wurde: seit 0.6.1 GLEITET die Kamera zur neuen Position, der
 * Punkt sprang dorthin. Zwei Dinge, die sich verschieden schnell bewegen --
 * genau das sieht man als Haken.
 *
 * ─── DER PREIS, UND WARUM ER RICHTIG IST ────────────────────────────────────
 * Wer zwischen zwei Meldungen zeichnet, zeigt einen Ort, an dem man vor bis
 * zu einer Sekunde war. Die Alternative waere, nach vorne zu RATEN -- und
 * eine geratene Position, die schon hinter der Abzweigung liegt, ist im
 * Fahrzeug gefaehrlicher als eine, die eine Sekunde nachhinkt. Die Kamera
 * macht es seit 0.6.1 genauso; erst dadurch bewegen sich beide im Gleichtakt.
 */

import { angleDifferenceDeg } from '../map/angles.js';

export interface SmoothFix {
  lat: number;
  lon: number;
  /** Grad, 0 = Norden. `null`, wenn der Empfaenger keinen Kurs meldet. */
  heading: number | null;
}

/**
 * Der Zwischenschritt zwischen zwei Meldungen, `t` von 0 (Start) bis 1 (Ziel).
 *
 * Laenge und Breite werden geradlinig verrechnet: ueber den Abstand zweier
 * Meldungen ist der Unterschied zur Kugel weit unter einem Meter.
 *
 * Der KURS dagegen liegt auf einem Kreis. Geradlinig gerechnet drehte sich
 * das Fahrzeug beim Uebergang von 350 auf 10 Grad einmal fast ganz herum,
 * statt zwanzig Grad weiter -- dieselbe Falle, die in 0.6.4 den Absturz
 * verursacht hat. Deshalb hier derselbe Weg wie dort (`map/angles.ts`).
 */
export function interpolateFix(von: SmoothFix, nach: SmoothFix, t: number): SmoothFix {
  const anteil = t <= 0 ? 0 : t >= 1 ? 1 : t;

  return {
    lat: von.lat + (nach.lat - von.lat) * anteil,
    lon: von.lon + (nach.lon - von.lon) * anteil,
    heading: interpolateHeading(von.heading, nach.heading, anteil),
  };
}

function interpolateHeading(von: number | null, nach: number | null, anteil: number): number | null {
  // Ohne Ausgangskurs gibt es nichts zu drehen -- dann gilt sofort der neue.
  // (Und ohne neuen Kurs gibt es kein Ziel: dann bleibt es beim alten, statt
  // die Nase des Pucks auf Norden schnappen zu lassen.)
  if (nach === null) return von;
  if (von === null) return nach;

  const gedreht = von + angleDifferenceDeg(von, nach) * anteil;
  // Zurueck in [0, 360): der Puck bekommt den Wert als Kartenausrichtung.
  return ((gedreht % 360) + 360) % 360;
}
