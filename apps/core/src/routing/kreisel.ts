/**
 * Was ein Kreisel fuer die Anzeige braucht: die wievielte Ausfahrt und wohin
 * sie fuehrt.
 *
 * ─── WOFÜR ──────────────────────────────────────────────────────────────────
 * Gemeldet nach einer Probefahrt: „wenn ich auf einen Kreisel zu fahre zeigt
 * der ESP komische Symbole an. Besser wären sowas wie ein viertelkreis,
 * Halbkreis etc. oder eine zusätzliche Nummerierung wann man den Kreisel
 * wieder verlassen muss."
 *
 * Bis dahin wusste das Display nur „roundabout_enter" -- und zeichnete fuer
 * JEDEN Kreisel dasselbe Bild, egal ob man ihn nach einem Viertel oder nach
 * drei Vierteln verlaesst.
 *
 * ─── WOHER DER WINKEL KOMMT ─────────────────────────────────────────────────
 * Valhalla nennt keinen „Ausfahrtswinkel". Es gibt aber an JEDEM Manoever die
 * Fahrtrichtung davor und danach (`bearing_before`, `bearing_after`). Die
 * Einfahrt (Typ 26) traegt die Richtung, aus der man kommt; die Ausfahrt
 * (Typ 27) die, in die man den Kreisel verlaesst. Die Differenz ist genau
 * das, was ein Fahrer als „rechts raus" oder „geradeaus durch" versteht.
 *
 * Die Ausfahrt gibt es als eigenes Manoever, weil Valhalla sie standardmaessig
 * ausgibt (`roundabout_exits`, Vorgabe `true`, API-Referenz). Fehlt sie doch
 * -- etwa wenn das Ziel im Kreisel liegt --, bleibt es bei der Nummer.
 */

import type { ValhallaManeuver } from './types.js';

/** Valhallas Manoevertypen, siehe `maneuverMapping.ts`. */
const EINFAHRT = 26;
const AUSFAHRT = 27;

export interface KreiselAngaben {
  roundabout_exit_count?: number;
  roundabout_turn_deg?: number;
}

/**
 * Eine Richtungsaenderung auf (-180, 180] gebracht, ganzzahlig.
 *
 * 350° → 10° ist eine Drehung um +20°, nicht um -340°. Ganzzahlig, weil das
 * Display in Grad zeichnet und ein Zehntelgrad dort nichts aendert -- in
 * Home Assistant aber in jedem Attribut als Rauschen stuende.
 */
export function drehung(vorher: number, nachher: number): number {
  let d = Math.round(nachher - vorher) % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}

function winkel(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

/**
 * Die Kreisel-Angaben fuer jedes Manoever EINES Abschnitts, gleich lang wie
 * die Eingabe; wo es nichts gibt, ein leeres Objekt.
 *
 * Einfahrt UND Ausfahrt bekommen dieselben Angaben. Sobald man im Kreisel
 * ist, ist die Ausfahrt das naechste Manoever -- und das Display soll dann
 * weiter zeigen, wohin es geht, statt auf ein nacktes Symbol zurueckzufallen.
 *
 * Nur innerhalb eines Abschnitts (`leg`): ein Zwischenziel zwischen Ein- und
 * Ausfahrt waere ein Halt IM Kreisel, und die Richtung ueber diesen Halt
 * hinweg beschriebe keinen Weg, den jemand faehrt.
 */
export function kreiselAngaben(manoever: readonly ValhallaManeuver[]): KreiselAngaben[] {
  const raus: KreiselAngaben[] = manoever.map(() => ({}));

  manoever.forEach((m, i) => {
    if (m.type !== EINFAHRT) return;
    const angaben: KreiselAngaben = {};

    const nummer = m.roundabout_exit_count;
    if (typeof nummer === 'number' && Number.isInteger(nummer) && nummer >= 1) {
      angaben.roundabout_exit_count = nummer;
    }

    // Die zugehoerige Ausfahrt: die NAECHSTE, und nur, solange kein weiterer
    // Kreisel dazwischen beginnt. Sonst gehoerte die Ausfahrt des zweiten
    // Kreisels zur Einfahrt des ersten.
    let j = -1;
    for (let k = i + 1; k < manoever.length; k++) {
      const typ = manoever[k]!.type;
      if (typ === AUSFAHRT) {
        j = k;
        break;
      }
      if (typ === EINFAHRT) break;
    }

    if (j >= 0) {
      const vorher = winkel(m.bearing_before);
      const nachher = winkel(manoever[j]!.bearing_after);
      if (vorher !== null && nachher !== null) {
        angaben.roundabout_turn_deg = drehung(vorher, nachher);
      }
      raus[j] = angaben;
    }
    raus[i] = angaben;
  });

  return raus;
}
