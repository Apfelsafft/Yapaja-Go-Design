/**
 * Das Fahrzeug gehoert waehrend der Fahrt nach UNTEN, nicht in die Mitte.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Zum Zoom, kurz vor der Abfahrt nach rechts bin ich noch recht weit
 * rausgezoomt. Da waere es besser wenn man genau die Strassen und Abfahrten
 * sieht."
 *
 * ─── WARUM MEHR ZOOM ALLEIN FALSCH WAERE ────────────────────────────────────
 * Der Auto-Zoom greift, das ist gemessen: bei 222 m zum Abbiegepunkt stand die
 * Karte auf Stufe 16,99, bei 445 m auf 15,99. Die Stufe 17 ist also da -- sie
 * ist nur zu weit weg.
 *
 * Nachgerechnet fuer ein Tablet quer (Karte ~725 CSS-px hoch, Breite 49,5°):
 *
 *   Stufe | Meter je Bildpunkt | mittig sichtbar voraus
 *   ------+--------------------+-----------------------
 *     16  |      1,551         |        562 m
 *     17  |      0,776         |        281 m
 *     18  |      0,388         |        141 m
 *
 * Bei 206 m zur Abfahrt und Stufe 17 liegt sie also auf 73 % des Weges zum
 * oberen Bildrand -- sichtbar, aber klein und ganz am Rand. Und eine Stufe
 * naeher waere SCHLIMMER: auf 18 sind mittig nur 141 m voraus zu sehen, die
 * Abfahrt laege ausserhalb des Bildes.
 *
 * Der eigentliche Fehler ist also nicht die Stufe, sondern die Lage: das
 * Fahrzeug sitzt in der Bildmitte, und die gesamte untere Bildhaelfte zeigt
 * Strecke, die schon hinter einem liegt. Bei einer Navigation ist die Haelfte
 * des Bildschirms damit verschenkt.
 *
 * ─── WAS SICH DADURCH AENDERT ───────────────────────────────────────────────
 * Sitzt das Fahrzeug bei 75 % der Hoehe, wird aus derselben Stufe:
 *
 *   Stufe | sichtbar voraus
 *   ------+----------------
 *     17  |     422 m
 *     18  |     211 m
 *
 * Erst dadurch wird die naechste Stufe ueberhaupt bezahlbar -- siehe
 * `autoZoom.ts#MANEUVER_AT_M` (150 m, und 211 m sind sichtbar).
 *
 * ─── WARUM EIN ANTEIL UND KEINE FESTE ZAHL ──────────────────────────────────
 * Die Anzeige laeuft vom Telefon bis zum Tablet quer. Eine feste Zahl von
 * Bildpunkten waere auf dem einen zu viel und auf dem anderen zu wenig.
 */

/**
 * Wo das Fahrzeug im Bild sitzen soll, als Anteil der Hoehe von oben.
 *
 * 0,5 waere die Mitte (der Zustand vorher), 1,0 der untere Rand. Drei Viertel
 * lassen unten noch Platz fuer die Strecke, aus der man gerade kommt -- ganz
 * am Rand zu kleben, macht das Mitdrehen der Karte unruhig.
 *
 * ─── WARUM HIER KEINE OBERGRENZE STEHT ────────────────────────────────────
 * Zuerst stand hier 0,78 und darunter eine Deckelung auf die halbe Hoehe,
 * damit die Verschiebung „nie zu gross" wird. Der erste Test hat gezeigt,
 * dass die Deckelung IMMER griff: sie ist ein Anteil der Hoehe, genau wie
 * die Verschiebung selbst, also entscheidet sie nicht von Fall zu Fall,
 * sondern verstellt schlicht die Konstante -- gemessen kam statt 0,78
 * ueberall 0,75 heraus. Eine Grenze, die nie eine Grenze ist, ist keine
 * Sicherung, sondern ein zweiter Wert am falschen Ort. Sie ist geloescht,
 * und der Wert steht jetzt so da, wie er wirkt.
 */
export const DRIVE_VEHICLE_Y = 0.75;

/**
 * Wo das Fahrzeug waagerecht sitzt, als Anteil der Breite von links -- je
 * nach Einbau.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Können wir den [blauen Punkt] aus dem Zentrum mehr in die Mitte des linken
 * unteren Quadranten legen - bzw, je nach LHD oder RHD rechten unteren
 * Quadranten."
 *
 * Die Mitte des unteren linken Viertels ist (0,25 | 0,75). Links bei einem
 * Linkslenker, rechts bei einem Rechtslenker -- die Einstellung dafuer gibt
 * es schon (`shell/handedness.ts`), sie stellt bisher die Knoepfe um.
 *
 * Die Hoehe bleibt `DRIVE_VEHICLE_Y`. Die waagerechte Verschiebung aendert
 * nichts daran, wie weit man VORAUS sieht, und damit nichts an der Rechnung
 * in `autoZoom.ts#passtInsBildZoom`.
 */
export const DRIVE_VEHICLE_X = { lhd: 0.25, rhd: 0.75 } as const;

/** Die Raender waehrend der Fahrt. `bottom` gehoert anderen und fehlt hier. */
export interface DriveRaender {
  top: number;
  left: number;
  right: number;
}

/**
 * Alle drei Raender, mit denen MapLibre das Fahrzeug an seinen Platz schiebt.
 *
 * Dieselbe Ueberlegung wie oben bei `drivePaddingTop`, nur waagerecht: der
 * Mittelpunkt liegt in der Mitte des Restbereichs. Soll er bei x = 0,25
 * liegen, braucht es RECHTS einen Rand von 2·(0,5 − 0,25) = die halbe
 * Breite; bei 0,75 entsprechend links.
 *
 * `null`, wenn eine der beiden Abmessungen unbekannt ist -- aus demselben
 * Grund wie bei `drivePaddingTop`.
 */
export function driveRaender(
  breitePx: number | null | undefined,
  hoehePx: number | null | undefined,
  einbau: 'lhd' | 'rhd',
): DriveRaender | null {
  const top = drivePaddingTop(hoehePx);
  if (top === null) return null;
  if (typeof breitePx !== 'number' || !Number.isFinite(breitePx) || breitePx <= 0) return null;
  const x = DRIVE_VEHICLE_X[einbau];
  const seitlich = Math.round(breitePx * 2 * Math.abs(x - 0.5));
  return x < 0.5 ? { top, left: 0, right: seitlich } : { top, left: seitlich, right: 0 };
}

/**
 * Der Randabstand, mit dem MapLibre den Kartenmittelpunkt nach unten schiebt.
 *
 * MapLibre setzt den Mittelpunkt in die Mitte des Bereichs, der nach Abzug
 * der Raender uebrig bleibt. Ein Rand OBEN schiebt ihn also nach unten -- das
 * ist die richtige Seite, auch wenn es sich zuerst falsch herum anfuehlt.
 *
 * `null` heisst „keine Verschiebung" (ausserhalb der Fahrt, oder wenn die
 * Hoehe der Karte nicht zu ermitteln ist -- dann laege das Fahrzeug nach
 * einer geratenen Zahl irgendwo).
 */
export function drivePaddingTop(mapHeightPx: number | null | undefined): number | null {
  if (typeof mapHeightPx !== 'number' || !Number.isFinite(mapHeightPx) || mapHeightPx <= 0) {
    return null;
  }
  // Aus „Fahrzeug bei y" wird der Rand oben: der Mittelpunkt des Restbereichs
  // muss auf y liegen, also ist der Rand 2*(y - 0,5) der Hoehe.
  return Math.round(mapHeightPx * 2 * (DRIVE_VEHICLE_Y - 0.5));
}
