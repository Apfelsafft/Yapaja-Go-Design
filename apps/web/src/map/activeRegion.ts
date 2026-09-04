/**
 * Welche installierte Kartenregion gerade angezeigt wird.
 *
 * ─── WARUM ES DIESE DATEI GIBT ──────────────────────────────────────────────
 * Bis 2026-09-03 gab es keine Wahl: `MapView` nahm `regions[0]`, und der Core
 * baute die Kachel-URL im Stil ebenfalls aus `regions[0]`
 * (`apps/core/src/map/routes.ts`). `listRegions` sortiert alphabetisch. Wer
 * also Liechtenstein UND Rheinland-Pfalz installiert hatte, bekam immer
 * Liechtenstein — und weil Follow-Me die Kamera sofort auf die eigene
 * Position zieht, stand die Karte danach ueber Rheinland-Pfalz und zeigte
 * eine LEERE Flaeche: der geladene Kachelsatz hat dort keine Daten.
 *
 * Das war der bösartigste Teil daran. Es gab keinen Fehler, keinen Hinweis,
 * keinen Knopf — nur eine leere Karte, die aussah wie ein kaputter Kachelbau.
 * Der Betreiber, dem das passierte, hatte Rheinland-Pfalz korrekt gebaut; die
 * Installationspruefung meldete beide Regionen als vorhanden.
 *
 * ─── DIE REGEL ──────────────────────────────────────────────────────────────
 * Ein MapLibre-Stil hat GENAU EINE Vektorquelle, also genau ein PMTiles-
 * Archiv. Mehrere Regionen gleichzeitig zu zeigen hiesse, Quellen und alle
 * Layer zu vervielfachen — das ist eine eigene Aufgabe. Solange es eine
 * Region zur Zeit ist, muss es aber die RICHTIGE sein, und richtig heisst:
 * die, in der man sich befindet.
 *
 * Vorrang hat immer eine ausdrueckliche Wahl des Betreibers (Reiseplanung in
 * einer Region, in der man gerade nicht ist). Ohne sie entscheidet die
 * Position. Ohne Position bleibt die erste — das ist kein Rateversuch,
 * sondern der einzige Zustand, in dem jede Wahl gleich gut ist.
 */

import type { MapRegionSummary } from './regions';

/** Eine Position, soweit diese Datei sie braucht. */
export interface LatLonLike {
  lat: number;
  lon: number;
}

/**
 * Liegt der Punkt in den Grenzen dieser Region?
 *
 * `bounds` ist `[minLon, minLat, maxLon, maxLat]` — die Reihenfolge, die
 * `apps/core/src/map/regions.ts` aus dem PMTiles-Header liest. Die Grenzen
 * werden EINSCHLIESSLICH geprueft: ein Punkt genau auf der Kante gehoert zur
 * Region, sonst faellt ein Grenzort in keine.
 */
export function regionContains(region: MapRegionSummary, point: LatLonLike): boolean {
  const [minLon, minLat, maxLon, maxLat] = region.bounds;
  return (
    point.lon >= minLon && point.lon <= maxLon && point.lat >= minLat && point.lat <= maxLat
  );
}

/** Flaeche der Bounding-Box in Quadratgrad. Nur zum Vergleichen gedacht —
 *  eine echte Flaechenberechnung braucht es dafuer nicht. */
function boundsArea(region: MapRegionSummary): number {
  const [minLon, minLat, maxLon, maxLat] = region.bounds;
  return Math.max(0, maxLon - minLon) * Math.max(0, maxLat - minLat);
}

/**
 * Alle Regionen, die den Punkt enthalten — die GROESSTE zuerst.
 *
 * ─── HIER STAND „DIE KLEINSTE ZUERST", MIT FALSCHER BEGRUENDUNG ────────────
 * Der Grund war: „Die kleinere Datei deckt dieselbe Stelle mit weniger
 * Speicher und meist mehr Detail ab." Der zweite Teil stimmt nicht. Beide
 * Regionen werden mit demselben Profil und ohne `--maxzoom` gebaut
 * (`services/tiles/build-pmtiles.sh`, DEFAULT_ARGS) — die kleinere Datei hat
 * KEIN Detail mehr, sie deckt nur weniger ab.
 *
 * Und genau das war der gemeldete Effekt: „Wenn ich hier aus Rheinland-Pfalz
 * rauszoome, ist nichts daneben. Der Rest bleibt leer." Mit installiertem
 * Deutschland UND Rheinland-Pfalz gewann Rheinland-Pfalz, und die Karte
 * endete an einer unsichtbaren Grenze mitten im Land.
 *
 * Die groesste Region, die den Punkt enthaelt, gibt die zusammenhaengende
 * Karte — und das ist es, was man beim Fahren braucht. Wer trotzdem eine
 * bestimmte Region sehen will, waehlt sie unter „Angezeigte Region" fest;
 * diese Wahl gewinnt weiterhin gegen alles.
 */
export function regionsContaining(
  regions: MapRegionSummary[],
  point: LatLonLike,
): MapRegionSummary[] {
  return regions
    .filter((region) => regionContains(region, point))
    .sort((a, b) => boundsArea(b) - boundsArea(a));
}

export interface PickActiveRegionInput {
  regions: MapRegionSummary[];
  /** Aktuelle Position, oder `null`, wenn es (noch) keine gibt. */
  point: LatLonLike | null;
  /** Ausdrueckliche Wahl des Betreibers (Region-Name), oder `null`. */
  manual: string | null;
}

export interface ActiveRegionChoice {
  region: MapRegionSummary | null;
  /**
   * Woher die Wahl kommt. Die Oberflaeche sagt es dem Betreiber, statt eine
   * Automatik zu verstecken:
   *   `manual`    er hat sie selbst gewaehlt
   *   `position`  sie enthaelt die aktuelle Position
   *   `fallback`  keine Position, oder die Position liegt in keiner Region
   *   `none`      es ist gar keine Region installiert
   */
  reason: 'manual' | 'position' | 'fallback' | 'none';
  /**
   * Wahr, wenn eine Position vorliegt, aber KEINE installierte Region sie
   * enthaelt. Genau dieser Fall sah vorher wie eine kaputte Karte aus und
   * bekommt deshalb einen eigenen Hinweis (siehe `RegionCoverageNotice`).
   */
  positionOutsideAllRegions: boolean;
}

/**
 * Entscheidet, welche Region angezeigt wird. Wirft nie und liefert immer
 * etwas Anzeigbares, solange ueberhaupt eine Region installiert ist.
 *
 * Eine ausdrueckliche Wahl, die es nicht mehr gibt (Region geloescht, alter
 * Wert im localStorage), wird ignoriert statt zu einer leeren Karte zu
 * fuehren — dasselbe Prinzip wie beim Stil-Fallback in `styleClient.ts`.
 */
export function pickActiveRegion({
  regions,
  point,
  manual,
}: PickActiveRegionInput): ActiveRegionChoice {
  if (regions.length === 0) {
    return { region: null, reason: 'none', positionOutsideAllRegions: false };
  }

  const covering = point ? regionsContaining(regions, point) : [];
  const positionOutsideAllRegions = point !== null && covering.length === 0;

  if (manual !== null) {
    const chosen = regions.find((region) => region.region === manual);
    if (chosen) {
      return { region: chosen, reason: 'manual', positionOutsideAllRegions };
    }
  }

  if (covering.length > 0) {
    return { region: covering[0], reason: 'position', positionOutsideAllRegions };
  }

  // Ohne Position: die GROESSTE installierte Region. Bis 0.5.0 war es
  // schlicht die erste der Liste -- beim Start landete man deshalb in
  // Liechtenstein, obwohl Deutschland installiert war, und die Karte sprang
  // erst beim GPS-Fix um. Die groesste Region ist die, bei der die eigene
  // Position am wahrscheinlichsten schon drin liegt.
  const largestFirst = [...regions].sort((a, b) => boundsArea(b) - boundsArea(a));
  return { region: largestFirst[0], reason: 'fallback', positionOutsideAllRegions };
}
