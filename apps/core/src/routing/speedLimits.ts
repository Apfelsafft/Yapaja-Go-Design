/**
 * Tempolimits zu einer bereits berechneten Route.
 *
 * ─── WARUM DAS EINEN ZWEITEN AUFRUF BRAUCHT ─────────────────────────────────
 * Valhallas `/route` liefert KEINE Tempolimits je Abschnitt. Bis 0.5.0 stand
 * deshalb in `mapResponse.ts`:
 *
 *     const speed_limits: SpeedSegment[] = [];
 *
 * Das war ehrlich (lieber leer als erfunden), aber die Folge war eine
 * vollstaendige Kette ohne Inhalt: `sensor.yapaja_speed_limit` blieb immer
 * leer, `binary_sensor.yapaja_speeding` immer aus, das Verkehrsschild
 * erschien nie. Gemeldet als „Ich haette gerne ueberhaupt eine Anzeige".
 *
 * Die Limits liefert `/trace_attributes`: man reicht die fertige
 * Routengeometrie noch einmal hinein und bekommt sie je Kante zurueck.
 *
 * ─── ZWEI DINGE AUS VALHALLAS QUELLTEXT, NICHT AUS DEM GEDAECHTNIS ──────────
 * Gelesen in `src/tyr/trace_serializer.cc`:
 *
 *   1. `speed_limit` fehlt GANZ, wenn Valhalla keins kennt (`> 0`-Pruefung).
 *      In OSM ist das der Normalfall, nicht die Ausnahme.
 *   2. Der Wert kann die Zeichenkette `"unlimited"` sein — deutsche Autobahn
 *      ohne Limit. Wer hier blind `Number()` rechnet, bekommt `NaN` und
 *      zeigt im Zweifel ein Schild mit Unsinn darauf.
 *
 * Die Einheit ist km/h, solange nicht `units: "miles"` angefordert wird
 * (`serialize_speed` skaliert nur dann).
 *
 * ─── WAS „UNBEGRENZT" HIER BEDEUTET ─────────────────────────────────────────
 * `kmh: null`. Das ist derselbe Wert wie „unbekannt", und das ist Absicht:
 * beide heissen fuer die Anzeige „kein Schild, keine Warnung". Eine Zahl zu
 * erfinden (etwa 130) waere eine Richtgeschwindigkeit als Limit ausgegeben —
 * bei einer Anzeige im Fahrzeug ist das die falsche Sorte Fehler.
 */

import type { SpeedSegment } from '@yapaja/shared';

/** Eine Kante aus der `/trace_attributes`-Antwort (nur, was hier zaehlt). */
export interface TraceAttributesEdge {
  begin_shape_index?: unknown;
  end_shape_index?: unknown;
  speed_limit?: unknown;
}

export interface TraceAttributesResponse {
  edges?: unknown;
}

/** Valhallas Zeichenkette fuer „keine Begrenzung". */
export const UNLIMITED = 'unlimited';

function asIndex(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Der Tempolimit-Wert einer Kante.
 *
 * `null` heisst „kein Schild": unbekannt ODER unbegrenzt. Alles, was keine
 * plausible Zahl ist, faellt ebenfalls auf `null` — die Antwort kommt von
 * einem fremden Dienst, und ein unerwarteter Wert darf hier keine Zahl
 * erzeugen, die im Fahrzeug als Limit erscheint.
 */
export function speedLimitOf(edge: TraceAttributesEdge): number | null {
  const raw = edge.speed_limit;
  if (raw === undefined || raw === null) return null;
  if (raw === UNLIMITED) return null;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  // Ein Limit von 0 gibt es nicht; Valhalla schreibt das Feld dann gar nicht,
  // aber ein 0 aus einer anderen Quelle darf nie als Schild erscheinen.
  if (raw <= 0) return null;
  // Oberhalb dessen ist es kein Strassentempolimit mehr, sondern ein Fehler.
  if (raw > 300) return null;
  return Math.round(raw);
}

/**
 * Macht aus einer `/trace_attributes`-Antwort die Abschnitte, die
 * `navigation/instructions.ts` auf die Route legt.
 *
 * Kanten OHNE Limit werden weggelassen statt mit `kmh: null` aufgenommen: die
 * Nachschlage-Logik liefert fuer eine Luecke ohnehin `null`, und ein Eintrag
 * ohne Aussage waere nur Ballast.
 *
 * Wirft nie. Die Antwort ist Fremddaten; eine unerwartete Form darf eine
 * fertig berechnete Route nicht zu Fall bringen.
 */
export function speedSegmentsFromTraceAttributes(
  response: TraceAttributesResponse | null | undefined,
): SpeedSegment[] {
  if (!response || !Array.isArray(response.edges)) return [];

  const segments: SpeedSegment[] = [];
  for (const raw of response.edges) {
    if (!raw || typeof raw !== 'object') continue;
    const edge = raw as TraceAttributesEdge;

    const begin = asIndex(edge.begin_shape_index);
    const end = asIndex(edge.end_shape_index);
    if (begin === null || end === null || end <= begin) continue;

    const kmh = speedLimitOf(edge);
    if (kmh === null) continue;

    segments.push({ begin_shape_index: begin, end_shape_index: end, kmh });
  }
  return segments;
}

/** Der Anfrage-Rumpf fuer `/trace_attributes`. */
export function buildTraceAttributesBody(
  encodedPolyline: string,
  costing: string,
): Record<string, unknown> {
  return {
    // ─── DIE GEOMETRIE UNVERAENDERT DURCHREICHEN ───────────────────────────
    // Valhalla nimmt `encoded_polyline` fuer JEDE Aktion an und dekodiert sie
    // mit polyline6 -- genau dem Format, in dem unsere Route ohnehin vorliegt
    // (nachgelesen in `src/worker.cc`, nicht angenommen: die polyline5-
    // Ausnahme gilt nur fuer `height`). Selbst zu dekodieren und wieder als
    // Punktliste zu schicken waere ein Umweg, bei dem sich die Geometrie
    // durch Rundung veraendern koennte -- und dann lagen die Limits an
    // leicht anderen Stellen als die Route.
    encoded_polyline: encodedPolyline,
    costing,
    // Die Geometrie stammt aus Valhallas eigener Antwort, liegt also exakt auf
    // den Kanten. `edge_walk` laeuft sie ab; eine echte Kartenzuordnung
    // (`map_snap`) waere teurer und koennte die Route veraendern -- angezeigt
    // werden muss aber die Route, die berechnet wurde.
    shape_match: 'edge_walk',
    // km/h -- `serialize_speed` skaliert nur bei `miles`.
    units: 'kilometers',
    // Ohne Filter liefert Valhalla je Kante ein grosses Objekt. Gebraucht wird
    // nichts davon; bei einer langen Route ist der Unterschied erheblich.
    filters: {
      attributes: ['edge.speed_limit', 'edge.begin_shape_index', 'edge.end_shape_index'],
      action: 'include',
    },
  };
}
