/**
 * Welche Spur man nehmen sollte.
 *
 * ─── WOFÜR ──────────────────────────────────────────────────────────────────
 * Gewünscht nach einer Probefahrt: „Und auch welche Spur man wählen sollte."
 *
 * ─── DIE EINE UNTERSCHEIDUNG, AUF DIE ES ANKOMMT ────────────────────────────
 * Valhalla liefert je Spur zwei Masken, und ihr Unterschied ist die ganze
 * Auskunft:
 *
 *   `valid`  — auf dieser Spur KANN man die Abbiegung nehmen, muss dafür aber
 *              unter Umständen noch einmal wechseln.
 *   `active` — das ist die richtige Spur. Wer hier fährt, kommt durch.
 *
 * Hervorgehoben wird nur `active`. Wer `valid` hervorhöbe, schickte jemanden
 * mit einem Wohnmobil auf eine Spur, von der aus er sich kurz vor der
 * Ausfahrt noch einmal einfädeln muss — zwischen LKW, mit sieben Metern
 * Fahrzeug. Das ist der Unterschied zwischen einer Hilfe und einer Falle.
 *
 * ─── WARUM KEINE EIGENEN PFEILE ─────────────────────────────────────────────
 * Die Richtungen werden auf `ArrowKey` abgebildet — dasselbe Vokabular, das
 * der große Manöverpfeil benutzt (`arrows.tsx`). Ein zweiter Satz Pfeile
 * sähe anders aus als der darüber, und der Fahrer müsste zwei Bildsprachen
 * lesen. Dass es dabei nur `turn_left` und nicht `slight_left` gibt, ist
 * kein Verlust: `maneuverMapping.ts` im Kern fasst genauso zusammen.
 */

import { SPUR, type LaneInfo } from '@yapaia/shared';
import type { ArrowKey } from './arrows.js';

/**
 * Ab wann die Spuren erscheinen (Meter zum Abbiegepunkt).
 *
 * ─── WARUM ÜBERHAUPT EINE GRENZE ────────────────────────────────────────────
 * Weil eine Spurangabe drei Kilometer im Voraus keine Hilfe ist, sondern
 * etwas, das dauernd im Bild steht und beim nächsten Mal übersehen wird.
 *
 * 500 m ist die Zahl, bei der man auf der Autobahn zu reagieren beginnt: bei
 * 120 km/h sind das fünfzehn Sekunden — genug, um einmal zu schauen, den
 * Spiegel zu prüfen und zu wechseln, auch mit einem langen Fahrzeug.
 */
export const SPUREN_AB_M = 500;

/** Eine Spur, fertig zum Zeichnen. */
export interface SpurAnzeige {
  /** Die Pfeile, die in dieser Spur stehen. Nie leer. */
  pfeile: ArrowKey[];
  /** Ob diese Spur die richtige ist — nur sie wird hervorgehoben. */
  aktiv: boolean;
}

/**
 * Die Bits der Maske auf zeichenbare Pfeile.
 *
 * Die Reihenfolge ist die auf der Fahrbahn: von links nach rechts. Ein
 * Spurpfeil-Paar „links, geradeaus" muss auch so herum stehen — andersherum
 * gelesen zeigte es in die falsche Richtung.
 *
 * `SPUR.UNBESTIMMT` (1, „keine bestimmte Richtung") und `SPUR.KEINE` (0)
 * ergeben keinen Pfeil: dafür gibt es kein Bild, und eines zu erfinden hiesse
 * eine Richtung zu behaupten, die die Daten nicht hergeben.
 */
const BIT_ZU_PFEIL: ReadonlyArray<readonly [number, ArrowKey]> = [
  [SPUR.WENDEN, 'uturn_left'],
  [SPUR.SCHARF_LINKS, 'turn_left'],
  [SPUR.LINKS, 'turn_left'],
  [SPUR.LEICHT_LINKS, 'turn_left'],
  [SPUR.EINFAEDELN_LINKS, 'turn_left'],
  [SPUR.GERADEAUS, 'straight'],
  [SPUR.LEICHT_RECHTS, 'turn_right'],
  [SPUR.RECHTS, 'turn_right'],
  [SPUR.SCHARF_RECHTS, 'turn_right'],
  [SPUR.EINFAEDELN_RECHTS, 'turn_right'],
];

/** Die Pfeile einer Richtungsmaske, ohne Doppelte, von links nach rechts. */
export function pfeileAusMaske(maske: number): ArrowKey[] {
  if (!Number.isFinite(maske) || maske <= 0) return [];
  const raus: ArrowKey[] = [];
  for (const [bit, pfeil] of BIT_ZU_PFEIL) {
    // Mehrere Bits fallen auf denselben Pfeil (links, leicht links und
    // scharf links sind alle `turn_left`). Zweimal derselbe Pfeil in einer
    // Spur waere kein Mehr an Auskunft, sondern ein doppeltes Bild.
    if ((maske & bit) !== 0 && !raus.includes(pfeil)) raus.push(pfeil);
  }
  return raus;
}

/**
 * Die Spuren, fertig zum Zeichnen — oder `null`.
 *
 * `null` heisst „nichts anzeigen", und das ist der Normalfall: Spurdaten
 * hängen in OSM an `turn:lanes`, und wo die fehlen, liefert Valhalla nichts.
 * Eine leere Leiste zu zeichnen hiesse „hier gibt es Spuren, nämlich keine".
 *
 * `distanceM` entscheidet mit: siehe `SPUREN_AB_M`.
 */
export function spurAnzeige(
  lanes: readonly LaneInfo[] | null | undefined,
  distanceM: number | null | undefined,
): SpurAnzeige[] | null {
  if (!Array.isArray(lanes) || lanes.length === 0) return null;
  if (typeof distanceM !== 'number' || !Number.isFinite(distanceM)) return null;
  if (distanceM > SPUREN_AB_M) return null;

  const spuren = lanes.map((l) => ({
    pfeile: pfeileAusMaske(l?.directions ?? 0),
    // `!== 0` und nicht `?? 0 > 0`: `active: 0` ist eine Aussage („fuer keine
    // Richtung ist dies die beste Spur"), ein fehlendes Feld ist keine. Beide
    // fuehren hier zu `false`, aber aus verschiedenen Gruenden.
    aktiv: typeof l?.active === 'number' && l.active !== 0,
  }));

  // Spuren ohne jeden Pfeil fallen weg -- ein leerer Kasten sieht aus, als
  // fehle etwas, und ist von einer Spur ohne Markierung nicht zu
  // unterscheiden.
  const brauchbar = spuren.filter((s) => s.pfeile.length > 0);
  return brauchbar.length > 0 ? brauchbar : null;
}
