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
 * Ist `kind` ein Teilgebiet von `eltern` — laut der Herkunft der Daten?
 *
 * ─── WARUM NICHT EINFACH DIE AUSDEHNUNG (0.40.0) ────────────────────────────
 * Gemeldet: „Ich habe Deutschland, Schweiz und Liechtenstein. Liechtenstein
 * wird bei mir aber nicht dargestellt." Die Ausdehnung ist ein RECHTECK, und
 * Liechtensteins Rechteck liegt vollständig in dem der Schweiz — obwohl kein
 * einziger Liechtensteiner Weg im Schweizer Extrakt steht. Die Regel
 * „liegt drin, also doppelt" hielt den Nachbarn für einen Teil.
 *
 * Woraus eine Region stammt, sagt der Katalog: Geofabrik legt Teilgebiete
 * in einem Unterverzeichnis des Landes ab
 * (`europe/germany/rheinland-pfalz-latest.osm.pbf` unter
 * `europe/germany-latest.osm.pbf`). Das ist eine Aussage über die Daten,
 * nicht über ein umschließendes Rechteck.
 */
export function teilgebietLautQuelle(kindUrl: string, elternUrl: string): boolean {
  const ohneEndung = (u: string): string => u.replace(/-latest\.osm\.pbf$/, '').replace(/\.osm\.pbf$/, '');
  const elternPfad = ohneEndung(elternUrl);
  const kindVerzeichnis = kindUrl.slice(0, kindUrl.lastIndexOf('/'));
  return kindVerzeichnis === elternPfad || kindVerzeichnis.startsWith(`${elternPfad}/`);
}

/** Woher eine Region stammt, soweit bekannt: Region → OSM-Quelle. */
export type QuellenVonRegion = (region: string) => string | undefined;

/** Liegt `kandidat` in `schon` — nach Quelle, sonst nach Ausdehnung? */
function liegtIn(schon: MapRegionInfo, kandidat: MapRegionInfo, quelle?: QuellenVonRegion): boolean {
  const kindUrl = quelle?.(kandidat.region);
  const elternUrl = quelle?.(schon.region);
  // Beide bekannt: allein die Herkunft entscheidet. Nachbarländer
  // überschneiden sich als Rechteck fast immer.
  if (kindUrl && elternUrl) return teilgebietLautQuelle(kindUrl, elternUrl);
  return enthaelt(schon.bounds, kandidat.bounds);
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
export function sichtbareRegionen(
  regionen: readonly MapRegionInfo[],
  quelle?: QuellenVonRegion,
): MapRegionInfo[] {
  const sortiert = [...regionen].sort((a, b) => {
    const d = flaeche(b.bounds) - flaeche(a.bounds);
    return d !== 0 ? d : a.region.localeCompare(b.region);
  });

  const behalten: MapRegionInfo[] = [];
  for (const kandidat of sortiert) {
    const verdeckt = behalten.some((schon) => liegtIn(schon, kandidat, quelle));
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
  quelle?: QuellenVonRegion,
): Array<{ region: string; verdecktVon: string }> {
  const sichtbar = sichtbareRegionen(regionen, quelle);
  const sichtbareNamen = new Set(sichtbar.map((r) => r.region));
  const ergebnis: Array<{ region: string; verdecktVon: string }> = [];
  for (const r of regionen) {
    if (sichtbareNamen.has(r.region)) continue;
    const traeger = sichtbar.find((s) => liegtIn(s, r, quelle));
    if (traeger) ergebnis.push({ region: r.region, verdecktVon: traeger.region });
  }
  return ergebnis.sort((a, b) => a.region.localeCompare(b.region));
}
