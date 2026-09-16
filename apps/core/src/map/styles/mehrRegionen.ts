/**
 * Mehrere Kartenregionen gleichzeitig zeichnen.
 *
 * ─── WOFÜR ──────────────────────────────────────────────────────────────────
 * Gemeldet: „Ich habe Deutschland, Liechtenstein und Schweiz Kacheln gebaut.
 * Sehe aber nur Deutschland. Wie kann ich alle Kacheln gleichzeitig sehen?
 * Bzw auch länderübergreifend fahren kann?"
 *
 * Bis 0.9.0 hatte das Stildokument GENAU EINE Kachelquelle, beim Ausliefern
 * umgeschrieben auf `./tiles/<region>.pmtiles`. Welche Region: die aus der
 * Adresszeile — und weil die Oberfläche nie eine mitschickte, immer die
 * erste der Liste. Alphabetisch. Wer Deutschland und die Schweiz gebaut
 * hatte, sah Deutschland, und es gab nicht einmal einen Umschalter.
 *
 * Für ein Wohnmobil ist eine Grenze der Normalfall. Das Routing hat das seit
 * 0.4.0 berücksichtigt (ein Graph über alle Extrakte), die Suche seit 0.5.0
 * (ein Index je Region, gesucht wird in allen). Nur die Karte nicht.
 *
 * ─── DIE FALLE: REGIONEN ÜBERLAPPEN SICH ────────────────────────────────────
 * „Einfach alle zeichnen" geht nicht. In der gemeldeten Installation lagen
 * `germany` UND `rheinland-pfalz` nebeneinander — und Rheinland-Pfalz liegt
 * vollständig in Deutschland. Beide zu zeichnen hieße jede Straße doppelt,
 * jeden Ortsnamen zweimal, jedes Symbol als Paar. Doppelte Beschriftung
 * verdrängt sich bei MapLibre außerdem gegenseitig, das Ergebnis flackert.
 *
 * Deshalb wird eine Region weggelassen, deren Ausdehnung VOLLSTÄNDIG in der
 * einer anderen liegt. Das ist genau der gemeldete Fall, es ist aus den
 * PMTiles-Kopfdaten ausrechenbar, und es ist nachvollziehbar zu erklären.
 *
 * Was es NICHT löst: zwei Regionen, die sich nur teilweise überschneiden
 * (etwa ein Sammelextrakt „DACH" neben `germany`). Dort würde im Überlappungs-
 * bereich doppelt gezeichnet. Das steht hier, statt verschwiegen zu werden —
 * es zu lösen hieße, Kacheln beim Zeichnen zuzuschneiden, und das ist ein
 * eigener Brocken.
 */

import type { MapRegionInfo } from '../regions.js';

/** `[minLon, minLat, maxLon, maxLat]` — wie in `MapRegionInfo.bounds`. */
export type Ausdehnung = readonly [number, number, number, number];

/**
 * Liegt `innen` vollständig in `aussen`?
 *
 * Einschließlich der Ränder: zwei deckungsgleiche Ausdehnungen enthalten
 * einander. Das ist gewollt — eine doppelt installierte Region soll auch
 * dann nur einmal gezeichnet werden.
 */
export function enthaelt(aussen: Ausdehnung, innen: Ausdehnung): boolean {
  return (
    aussen[0] <= innen[0] && aussen[1] <= innen[1] && aussen[2] >= innen[2] && aussen[3] >= innen[3]
  );
}

/** Fläche der Ausdehnung in Grad². Nur zum Vergleichen, nicht als Angabe. */
export function flaeche(a: Ausdehnung): number {
  return Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
}

/**
 * Welche Regionen tatsächlich gezeichnet werden.
 *
 * Sortiert nach Fläche, größte zuerst — die größte ist damit die
 * „Hauptregion" (siehe `quellenId`). Anschließend fällt jede Region weg, die
 * vollständig in einer bereits übernommenen liegt.
 *
 * Bei DECKUNGSGLEICHEN Ausdehnungen gewinnt die alphabetisch erste. Ohne
 * diese Regel hinge das Ergebnis an der Reihenfolge des Dateisystems, und
 * dieselbe Installation zeigte nach einem Neustart eine andere Karte.
 */
export function sichtbareRegionen(regionen: readonly MapRegionInfo[]): MapRegionInfo[] {
  const sortiert = [...regionen].sort((a, b) => {
    const d = flaeche(b.bounds) - flaeche(a.bounds);
    return d !== 0 ? d : a.region.localeCompare(b.region);
  });

  const behalten: MapRegionInfo[] = [];
  for (const kandidat of sortiert) {
    const verdeckt = behalten.some((schon) => enthaelt(schon.bounds, kandidat.bounds));
    if (!verdeckt) behalten.push(kandidat);
  }
  return behalten;
}

/**
 * Welche Regionen weggelassen wurden, und von wem verdeckt.
 *
 * Damit die Oberfläche sagen kann „Rheinland-Pfalz wird nicht zusätzlich
 * gezeichnet, es liegt in Deutschland" — statt dass jemand eine
 * heruntergeladene Region vermisst und sie für kaputt hält. Genau diese
 * Sorte stummes Weglassen hat dieses Projekt schon mehrfach gekostet.
 */
export function verdeckteRegionen(
  regionen: readonly MapRegionInfo[],
): Array<{ region: string; verdecktVon: string }> {
  const sichtbar = sichtbareRegionen(regionen);
  const sichtbareNamen = new Set(sichtbar.map((r) => r.region));
  const ergebnis: Array<{ region: string; verdecktVon: string }> = [];
  for (const r of regionen) {
    if (sichtbareNamen.has(r.region)) continue;
    const traeger = sichtbar.find((s) => enthaelt(s.bounds, r.bounds));
    if (traeger) ergebnis.push({ region: r.region, verdecktVon: traeger.region });
  }
  return ergebnis.sort((a, b) => a.region.localeCompare(b.region));
}
