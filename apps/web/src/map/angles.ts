/**
 * Winkel vergleichen, ohne dass 359 und 1 weit auseinander liegen.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Und das schlimmste, nach kurzer Zeit verschwindet die gesamte Anzeige und
 * man sieht nur noch einen blanken Screen." -- spaeter, mit der Fehlergrenze
 * aus 0.6.1, kam der Text dazu: „Maximum call stack size exceeded."
 *
 * ─── DIE URSACHE ────────────────────────────────────────────────────────────
 * `viewMode.ts#syncHeadingToBearing` verglich den Kurs des Fahrzeugs (0..360,
 * so liefert ihn GPS) mit dem Kartenwinkel -- und den speichert MapLibre
 * GEWICKELT. Gemessen im Browser:
 *
 *     gesetzt ->  gelesen
 *         0   ->     0
 *       179   ->   179
 *       180   ->   180
 *       181   ->  -179
 *       200   ->  -160
 *       270   ->   -90
 *       359   ->    -1
 *
 * Bei Kurs 200 stand da also `Math.abs(-160 - 200) > 0.1`, und das sind 360.
 * Die Abfrage sollte eine Rueckkopplung verhindern; ab 180 Grad konnte sie
 * gar nicht mehr zur Ruhe kommen. Da `setCamera` ohne Animation springt und
 * MapLibre `moveend` dabei SOFORT meldet, rief sich die Kette
 * `moveend -> setCamera -> moveend` selbst auf, bis der Aufrufstapel voll
 * war. Auf dem iPad kippt der frueher als hier -- deshalb sah der Betreiber
 * es und die Testfahrten unter Chromium nicht.
 *
 * Getroffen hat es jede Fahrt Richtung WESTEN im Kurs-Modus. „Nach kurzer
 * Zeit" war der Moment, in dem die Route nach Westen drehte.
 *
 * ─── WARUM EIN EIGENES MODUL ────────────────────────────────────────────────
 * Damit die Regel eine Stelle hat, an der sie geprueft wird, statt zweimal
 * nebeneinander im Kartencode zu stehen. Der Core hat dieselbe Funktion
 * laengst (`navigation/geo.ts#angularDifference`) -- sie liegt aber nicht auf
 * der oeffentlichen Oberflaeche von `@yapaja/shared`, und der Browser haengt
 * nicht am Core. Gleiche Formel, gleiche Regel, eigener Ort. (Dasselbe
 * Muster wie `search/distance.ts`, siehe dort.)
 */

/**
 * Der kleinste Weg von `von` nach `nach`, in Grad, im Bereich (-180, 180].
 *
 * Positiv heisst „im Uhrzeigersinn". Fuer die Frage „stehen die beiden
 * gleich?" zaehlt nur der Betrag.
 */
export function angleDifferenceDeg(von: number, nach: number): number {
  const roh = (nach - von) % 360;
  if (roh > 180) return roh - 360;
  if (roh <= -180) return roh + 360;
  return roh;
}

/**
 * Zeigen zwei Winkel praktisch in dieselbe Richtung?
 *
 * `toleranzGrad` ist der Abstand, unterhalb dessen eine Kamerabewegung nicht
 * lohnt -- und, wichtiger, unterhalb dessen sie unterbleiben MUSS, damit aus
 * dem Nachfuehren keine Endlosschleife wird.
 */
export function anglesMatch(a: number, b: number, toleranzGrad: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(angleDifferenceDeg(a, b)) <= toleranzGrad;
}
