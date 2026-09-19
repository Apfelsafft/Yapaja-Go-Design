/**
 * Automatischer Zoom waehrend der Fahrt.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Füge bei der Navigation einen automatischen Zoom ein."
 *
 * ─── DIE GEFAEHRLICHE SEITE EINER SOLCHEN FUNKTION ──────────────────────────
 * Ein Zoom, der sich selbst verstellt, kann schlimmer sein als gar keiner:
 * wer gerade selbst herausgezoomt hat, um die Umgebung zu sehen, und dabei
 * gegen die Automatik ankaempft, gibt entnervt auf -- oder schaut laenger auf
 * den Bildschirm als auf die Strasse.
 *
 * Deshalb gilt hier eine harte Regel: **der Mensch gewinnt immer.** Der
 * Auto-Zoom greift nur, solange Follow-Me laeuft und NICHT pausiert ist --
 * und pausiert wird es bereits durch jeden manuellen Schwenk (`followMe.ts`,
 * 10 Sekunden). Wer die Karte anfasst, hat fuer diese Zeit Ruhe.
 *
 * ─── WORAN SICH DIE STUFE BEMISST ───────────────────────────────────────────
 * Zwei Dinge, in dieser Reihenfolge:
 *
 *   1. Ein naher Abbiegepunkt gewinnt IMMER. Kurz vor einer Kreuzung nuetzt
 *      die Uebersicht nichts -- man muss die Spur sehen.
 *   2. Sonst die Geschwindigkeit: bei 30 km/h braucht man Detail, bei
 *      130 km/h will man sehen, was kommt. Wer schnell faehrt, legt in
 *      derselben Zeit mehr Strecke zurueck; der sichtbare Ausschnitt sollte
 *      dem folgen.
 *
 * ─── WARUM STUFEN UND KEINE FORMEL ──────────────────────────────────────────
 * Eine stetige Funktion verstellt den Zoom bei JEDER Positionsmeldung ein
 * kleines Stueck -- ein dauerndes, unruhiges Zittern der Karte, das im
 * Fahrzeug besonders unangenehm ist. Stufen aendern sich selten und nur dann,
 * wenn sich wirklich etwas geaendert hat.
 */

import { metersPerPixel } from './scale.js';
import { DRIVE_VEHICLE_Y } from './drivePadding.js';

/**
 * ─── WAS 0.17.2 DARAN GEAENDERT HAT ─────────────────────────────────────────
 * Gemeldet nach einer Probefahrt:
 *
 *   „Der Zoom ist nicht smart genug. Man kann die nächste Abbiegung nicht gut
 *    erkennen. […] Erscheint dass Google Maps die nächste Abbiegung in der
 *    Karte immer anzeigt. Also in Abhängigkeit der Entfernung, nicht wenn man
 *    noch 10km vor sich hat. Aber wenn man recht nah ist."
 *
 * Die Stufen unten bemassen den Abbiegepunkt an ZWEI festen Schwellen (250 m,
 * 150 m). Dazwischen und darueber entschied allein das Tempo -- auf der
 * Autobahn also Stufe 14, bis die Abfahrt auf 250 m heran war. Wer bei 120
 * km/h faehrt, legt 250 m in siebeneinhalb Sekunden zurueck: die Abfahrt
 * erschien im Bild, als es zum Einordnen bereits zu spaet war.
 *
 * Feste Schwellen koennen das nicht loesen, denn die richtige Stufe haengt
 * nicht nur an der Entfernung, sondern auch daran, wie GROSS die Anzeige ist
 * und wo auf der Erde man faehrt (in Web-Mercator schrumpft der Massstab mit
 * dem Kosinus der Breite -- auf 49,5 Grad um 35 %).
 *
 * Deshalb wird die Frage jetzt umgedreht. Nicht „welche Stufe gehoert zu
 * dieser Entfernung", sondern: **welche Stufe holt den Abbiegepunkt gerade
 * ins Bild?** Das ist rechenbar, weil beide Stuecke schon da sind --
 * `scale.ts#metersPerPixel` und `drivePadding.ts#DRIVE_VEHICLE_Y`.
 *
 * ─── UND WARUM ER TROTZDEM NICHT AUF 10 km HINAUSZOOMT ──────────────────────
 * Weil die Rechnung nur HERANholen darf, nie heraus. Ergibt sie eine groebere
 * Stufe als das Tempo verlangt -- der Abbiegepunkt ist weit --, gilt das
 * Tempo. Genau das ist der Halbsatz „nicht wenn man noch 10km vor sich hat".
 */

/** Ab dieser Entfernung zum Abbiegepunkt zaehlt er als „nah" (Meter). */
export const MANEUVER_CLOSE_M = 250;

/** Die Stufe, auf die ein naher Abbiegepunkt heranholt. */
export const MANEUVER_ZOOM = 17;

/**
 * ─── UND EINE STUFE NAEHER, UNMITTELBAR VOR DEM ABBIEGEN ────────────────────
 * Gemeldet: „kurz vor der Abfahrt nach rechts bin ich noch recht weit
 * rausgezoomt. Da waere es besser wenn man genau die Strassen und Abfahrten
 * sieht."
 *
 * Die Stufe 17 GRIFF dabei bereits -- gemessen: bei 222 m zum Abbiegepunkt
 * stand die Karte auf 16,99. Sie war nur zu weit weg: mittig sind auf 17 nur
 * 281 m voraus zu sehen, die Abfahrt sass also fast am oberen Bildrand.
 *
 * Diese zweite, engere Stufe ist erst moeglich, seit das Fahrzeug waehrend
 * der Fahrt im unteren Bilddrittel sitzt (`map/drivePadding.ts`). MITTIG
 * waere sie schaedlich: auf 18 sind dann nur 141 m voraus sichtbar, und ein
 * Abbiegepunkt in 150 m laege ausserhalb des Bildes. Mit der Verschiebung
 * sind es 219 m -- er bleibt im Bild und ist doppelt so gross.
 *
 * Deshalb gehoeren die beiden Zahlen zusammen; wer die eine aendert, muss die
 * andere nachrechnen.
 */
export const MANEUVER_AT_M = 150;
export const MANEUVER_AT_ZOOM = 18;

/**
 * Geschwindigkeitsstufen, von langsam nach schnell.
 *
 * `upToKmh` ist die OBERE Grenze der Stufe. Die letzte gilt fuer alles
 * darueber.
 */
export const SPEED_ZOOM_STEPS: ReadonlyArray<{ upToKmh: number; zoom: number }> = [
  { upToKmh: 30, zoom: 17 },
  { upToKmh: 60, zoom: 16 },
  { upToKmh: 100, zoom: 15 },
  { upToKmh: Number.POSITIVE_INFINITY, zoom: 14 },
];

/**
 * Wie viel Luft ueber dem Abbiegepunkt bleiben soll.
 *
 * 1,0 hiesse: er sitzt genau auf der Oberkante -- also halb abgeschnitten und
 * ohne jeden Zusammenhang, weil man die Strasse dahinter nicht sieht. 1,3
 * laesst ihn bei rund drei Vierteln der sichtbaren Strecke liegen, mit dem
 * Stueck danach noch im Bild.
 */
export const MANEUVER_LUFT = 1.3;

/**
 * Die feinste Stufe, auf die der Auto-Zoom herangeht.
 *
 * Bei einer Abbiegung in 20 m ergaebe die Rechnung sonst Stufe 21 und mehr --
 * eine Karte, auf der eine einzelne Kreuzung den ganzen Schirm fuellt und
 * nichts mehr einzuordnen ist. `MANEUVER_AT_ZOOM` (18) ist die Stufe, die
 * sich in der Praxis bewaehrt hat; darueber hinaus bringt Heranholen nichts.
 */
export const MAX_ZOOM = MANEUVER_AT_ZOOM;

/** Auf halbe Stufen. Siehe „WARUM STUFEN UND KEINE FORMEL" im Kopf. */
export const ZOOM_SCHRITT = 0.5;

export interface AutoZoomInput {
  /** Aktuelle Geschwindigkeit in km/h, oder `null`/`undefined` wenn unbekannt. */
  speedKmh: number | null | undefined;
  /** Entfernung zum naechsten Abbiegepunkt in Metern, oder `null`. */
  distanceToManeuverM: number | null | undefined;
  /**
   * Hoehe der Karte in CSS-Bildpunkten -- und die geografische Breite.
   *
   * ─── WARUM DAS JETZT HEREINKOMMT ──────────────────────────────────────────
   * Weil die richtige Stufe ohne beides nicht auszurechnen ist. Die alten
   * Schwellen (250 m, 150 m) haben stillschweigend ein Tablet quer auf 49,5
   * Grad angenommen -- nachzulesen in der Tabelle in `drivePadding.ts`. Auf
   * einem Telefon hochkant stimmte die Rechnung nicht mehr, und in Nordnorwegen
   * auch nicht.
   *
   * Fehlt eines von beiden, faellt die Rechnung weg und es bleibt bei den
   * Stufen. Das ist kein Notbehelf, sondern der richtige Rueckfall: eine
   * geratene Bildhoehe verstellte die Kamera aufgrund einer Zahl, die niemand
   * gemessen hat.
   */
  mapHeightPx?: number | null;
  lat?: number | null;
}

/**
 * Die Stufe, auf der der Abbiegepunkt gerade ins Bild passt — oder `null`.
 *
 * Umgestellte Massstabsformel: sichtbar voraus ist
 *
 *   hoehe * DRIVE_VEHICLE_Y * metersPerPixel(zoom, lat)
 *
 * und das soll mindestens `entfernung * MANEUVER_LUFT` sein. Nach `zoom`
 * aufgeloest ergibt das einen Logarithmus zur Basis 2 -- keine Naeherung,
 * sondern dieselbe Rechnung wie die Tabelle in `drivePadding.ts`, nur
 * rueckwaerts.
 */
export function passtInsBildZoom(
  distanceM: number,
  mapHeightPx: number,
  lat: number,
): number | null {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return null;
  if (!Number.isFinite(mapHeightPx) || mapHeightPx <= 0) return null;
  const massstab = metersPerPixel(0, lat);
  if (massstab === null) return null;

  const vorausPx = mapHeightPx * DRIVE_VEHICLE_Y;
  const gebraucht = distanceM * MANEUVER_LUFT;
  // hoehePx * (massstab0 / 2^zoom) >= gebraucht   =>   2^zoom <= hoehePx * massstab0 / gebraucht
  const verhaeltnis = (vorausPx * massstab) / gebraucht;
  if (!Number.isFinite(verhaeltnis) || verhaeltnis <= 0) return null;
  return Math.log2(verhaeltnis);
}

/**
 * Die gewuenschte Zoomstufe -- oder `null`, wenn sich keine begruenden laesst.
 *
 * `null` heisst ausdruecklich „nichts tun", nicht „Standardwert nehmen": ohne
 * Geschwindigkeit und ohne Abbiegepunkt gibt es keinen Anlass, die Karte zu
 * verstellen. Ein Vorgabewert waere hier eine Bewegung, die niemand
 * angefordert hat.
 */
export function autoZoomFor({
  speedKmh,
  distanceToManeuverM,
  mapHeightPx,
  lat,
}: AutoZoomInput): number | null {
  const entfernungDa =
    typeof distanceToManeuverM === 'number' &&
    Number.isFinite(distanceToManeuverM) &&
    distanceToManeuverM >= 0;

  // ─── 1. DIE GRUNDSTUFE AUS DEM TEMPO ─────────────────────────────────────
  // Sie ist der Boden: gruber als das wird es nie, egal wie weit der
  // Abbiegepunkt weg ist. Genau das verhindert das Hinauszoomen auf einen
  // Punkt in 10 km.
  let grund: number | null = null;
  if (typeof speedKmh === 'number' && Number.isFinite(speedKmh) && speedKmh >= 0) {
    for (const step of SPEED_ZOOM_STEPS) {
      if (speedKmh <= step.upToKmh) {
        grund = step.zoom;
        break;
      }
    }
  }

  // ─── 2. HERANHOLEN, DAMIT DER ABBIEGEPUNKT INS BILD PASST ────────────────
  if (entfernungDa && typeof mapHeightPx === 'number' && typeof lat === 'number') {
    const passt = passtInsBildZoom(distanceToManeuverM as number, mapHeightPx, lat);
    if (passt !== null) {
      // Abrunden auf halbe Stufen: eine stetige Zahl verstellte die Kamera bei
      // jeder Positionsmeldung um ein Haar -- das Zittern, vor dem der Kopf
      // dieser Datei warnt. ABrunden und nicht runden, damit ein Wert knapp
      // unter der Grenze nicht zwischen zwei Stufen hin und her springt.
      const stufe = Math.min(
        MAX_ZOOM,
        Math.floor(passt / ZOOM_SCHRITT) * ZOOM_SCHRITT,
      );
      // NUR heranholen, nie heraus: `grund` bleibt die Untergrenze.
      if (grund === null) return stufe;
      return Math.max(grund, stufe);
    }
  }

  // ─── 3. DER RUECKFALL: DIE ALTEN SCHWELLEN ───────────────────────────────
  // Greift, wenn Bildhoehe oder Breite fehlen -- etwa bevor die Karte einmal
  // gemessen wurde. Sie sind dann nicht ideal, aber sie sind gemessen und
  // begruendet (siehe `drivePadding.ts`), und sie sind besser als nichts.
  if (entfernungDa) {
    if ((distanceToManeuverM as number) <= MANEUVER_AT_M) return MANEUVER_AT_ZOOM;
    if ((distanceToManeuverM as number) <= MANEUVER_CLOSE_M) return MANEUVER_ZOOM;
  }

  return grund;
}

/**
 * Ob die Karte fuer diese Stufe wirklich bewegt werden soll.
 *
 * Ohne diese Pruefung setzte jede Positionsmeldung die Kamera neu -- auch
 * wenn sich am Ziel nichts geaendert hat. Das ist der Unterschied zwischen
 * „passt sich an" und „zappelt".
 */
export function shouldApplyZoom(currentZoom: number | null | undefined, target: number): boolean {
  if (typeof currentZoom !== 'number' || !Number.isFinite(currentZoom)) return true;
  return Math.abs(currentZoom - target) >= 0.5;
}
