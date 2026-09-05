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

/** Ab dieser Entfernung zum Abbiegepunkt zaehlt er als „nah" (Meter). */
export const MANEUVER_CLOSE_M = 250;

/** Die Stufe, auf die ein naher Abbiegepunkt heranholt. */
export const MANEUVER_ZOOM = 17;

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

export interface AutoZoomInput {
  /** Aktuelle Geschwindigkeit in km/h, oder `null`/`undefined` wenn unbekannt. */
  speedKmh: number | null | undefined;
  /** Entfernung zum naechsten Abbiegepunkt in Metern, oder `null`. */
  distanceToManeuverM: number | null | undefined;
}

/**
 * Die gewuenschte Zoomstufe -- oder `null`, wenn sich keine begruenden laesst.
 *
 * `null` heisst ausdruecklich „nichts tun", nicht „Standardwert nehmen": ohne
 * Geschwindigkeit und ohne Abbiegepunkt gibt es keinen Anlass, die Karte zu
 * verstellen. Ein Vorgabewert waere hier eine Bewegung, die niemand
 * angefordert hat.
 */
export function autoZoomFor({ speedKmh, distanceToManeuverM }: AutoZoomInput): number | null {
  // 1. Naher Abbiegepunkt gewinnt.
  if (
    typeof distanceToManeuverM === 'number' &&
    Number.isFinite(distanceToManeuverM) &&
    distanceToManeuverM >= 0 &&
    distanceToManeuverM <= MANEUVER_CLOSE_M
  ) {
    return MANEUVER_ZOOM;
  }

  // 2. Sonst die Geschwindigkeit.
  if (typeof speedKmh !== 'number' || !Number.isFinite(speedKmh) || speedKmh < 0) {
    return null;
  }
  for (const step of SPEED_ZOOM_STEPS) {
    if (speedKmh <= step.upToKmh) return step.zoom;
  }
  /* istanbul ignore next -- die letzte Stufe ist Infinity, die Schleife endet immer darin */
  return null;
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
