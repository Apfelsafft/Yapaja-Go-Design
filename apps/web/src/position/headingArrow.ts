/**
 * Der Richtungspfeil am Positionspunkt.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Der blaue Punkt, unsere Position, hat oft eine schmale blaue Linie die
 * wahrscheinlich das aktuelle heading anzeigt. Können wir das ändern?"
 *
 * Es war eine 20 Pixel lange Linie der Staerke 2 -- fadenduenn, und im
 * Augenwinkel waehrend der Fahrt kaum als Richtung zu lesen. An ihre Stelle
 * tritt ein gefuellter Pfeil, wie man ihn aus Autonavigationen kennt.
 *
 * ─── WARUM VOR DEM PUNKT UND NICHT UEBER IHM ────────────────────────────────
 * Der Punkt hat 8 Pixel Radius plus 2 Pixel weissen Rand. Laege der Pfeil
 * darueber, verdeckte er genau das, was die Position anzeigt. Seine Basis
 * beginnt deshalb knapp AUSSERHALB des Punktes: zusammen ergibt das einen
 * Punkt mit Spitze, statt zweier Dinge, die sich gegenseitig im Weg stehen.
 *
 * ─── WARUM IN BILDPUNKTEN GERECHNET ─────────────────────────────────────────
 * Der Pfeil soll auf jeder Zoomstufe GLEICH GROSS aussehen. Deshalb kommen
 * die Masse hier in Bildpunkten herein und werden ueber `metersPerPixel` in
 * Meter umgerechnet -- genauso, wie es der Genauigkeitsring schon macht.
 */

/** Abstand der Spitze vom Mittelpunkt, in Bildpunkten. */
export const ARROW_TIP_PX = 32;
/** Abstand der beiden hinteren Ecken vom Mittelpunkt, in Bildpunkten. */
export const ARROW_BASE_PX = 18;
/**
 * Halber Oeffnungswinkel der Basis, in Grad.
 *
 * Aus 18 px und 34 Grad ergibt sich eine Basis, die 14,9 px vor dem
 * Mittelpunkt liegt -- ausserhalb des Punktes samt Rand (10 px) -- und 10,1 px
 * breit zu jeder Seite. Wer eines der drei Masse aendert, sollte das
 * nachrechnen, sonst wandert der Pfeil in den Punkt hinein.
 */
export const ARROW_SPREAD_DEG = 34;

/** GeoJSON-Reihenfolge: `[lon, lat]`. */
export type Coord = [number, number];

const R_ERDE_M = 6_371_000;

/** Ein Punkt in `distanzM` Metern Entfernung unter dem Kurs `kursGrad`. */
function versetzt(lon: number, lat: number, kursGrad: number, distanzM: number): Coord {
  const kurs = (kursGrad * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const dLat = (Math.cos(kurs) * distanzM) / R_ERDE_M;
  const dLon = (Math.sin(kurs) * distanzM) / (R_ERDE_M * Math.cos(latRad));
  return [lon + (dLon * 180) / Math.PI, lat + (dLat * 180) / Math.PI];
}

/**
 * Der geschlossene Ring des Pfeils -- Spitze voraus, zwei Ecken hinten.
 *
 * `null`, wenn kein Kurs bekannt ist oder das Massband unbrauchbar ist: dann
 * gibt es keine Richtung zu zeigen, und ein geratener Pfeil waere schlimmer
 * als keiner.
 */
export function headingArrowRing(
  lon: number,
  lat: number,
  headingDeg: number | null | undefined,
  metersPerPixel: number,
): Coord[] | null {
  if (headingDeg === null || headingDeg === undefined || !Number.isFinite(headingDeg)) return null;
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return null;

  const spitze = versetzt(lon, lat, headingDeg, ARROW_TIP_PX * metersPerPixel);
  const links = versetzt(lon, lat, headingDeg - ARROW_SPREAD_DEG, ARROW_BASE_PX * metersPerPixel);
  const rechts = versetzt(lon, lat, headingDeg + ARROW_SPREAD_DEG, ARROW_BASE_PX * metersPerPixel);

  // GeoJSON verlangt einen geschlossenen Ring -- erster Punkt gleich letztem.
  return [spitze, links, rechts, spitze];
}
