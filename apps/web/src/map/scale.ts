/**
 * Wie viele Meter ein Bildpunkt der Karte gerade bedeutet.
 *
 * ─── WARUM DAS EINE EIGENE STELLE HAT ───────────────────────────────────────
 * Im Puck stand die Umrechnung als Einzeiler mit dem Vermerk „Rough
 * approximation":
 *
 *     const metersPerPixel = 40075000 / (256 * Math.pow(2, zoom));
 *
 * Sie war in ZWEI Punkten falsch, und beide fielen erst auf, als der
 * Richtungspfeil (0.6.8) sichtbar zu gross herauskam:
 *
 *  1. Die BREITE fehlte. In der Web-Mercator-Projektion schrumpft der
 *     Massstab mit dem Kosinus der Breite. Auf 47,4 Grad sind das 32 %.
 *  2. MapLibre rechnet mit 512er Kacheln, nicht mit 256er. Das ist glatt der
 *     Faktor 2.
 *
 * Zusammen war der Wert auf 47,4 Grad um das 2,95-fache zu gross. Gemessen
 * hat das der Pfeil: seine Spitze lag 52 Bildpunkte vom Punkt entfernt statt
 * der vorgesehenen 26.
 *
 * ─── WAS DAS BISHER ANGERICHTET HAT ─────────────────────────────────────────
 * Der Genauigkeitsring TEILT durch diesen Wert, war also um dasselbe Mass zu
 * KLEIN: eine Ungenauigkeit von 8 m erschien als Radius von 6,7 statt 19,8
 * Bildpunkten -- vollstaendig unter dem Punkt (Radius 8) verborgen. Der Ring
 * war da, sichtbar war er nie. Genau die Sorte Fehler, die dieses Projekt
 * schon mehrfach hatte: gebaut, aber nicht erreichbar.
 */

/**
 * Der Erdumfang am Aequator in Metern, geteilt durch die Kachelgroesse, die
 * MapLibre verwendet (512). Das ist der Massstab auf Zoomstufe 0 am Aequator.
 */
export const METERS_PER_PIXEL_AT_ZOOM_0 = 40_075_016.686 / 512;

/**
 * Meter je Bildpunkt auf `zoom` und geografischer Breite `lat`.
 *
 * `null`, wenn eines von beiden unbrauchbar ist -- ein geratener Massstab
 * zoege jede Anzeige, die daran haengt, in die Irre.
 */
export function metersPerPixel(zoom: number, lat: number): number | null {
  if (!Number.isFinite(zoom) || !Number.isFinite(lat)) return null;
  if (lat <= -90 || lat >= 90) return null;
  return (METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}
