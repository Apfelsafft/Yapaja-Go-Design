/**
 * Wo die Bedienelemente auf der Karte liegen -- an EINER Stelle.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Wir haben viele Knöpfe und Anzeigen auf der Karte, die sich teilweise
 * überlappen. Bspw. wenn die Navigation aktiv ist, liegen die neuen Buttons
 * über der Zentrierung. Die nächste Abbiegung über der Suchzeile. Oder aber
 * auch die Karteneinstellung über den Zoom-Einstellungen der Karte."
 *
 * ─── WARUM DAS PASSIERT IST ─────────────────────────────────────────────────
 * Jedes Overlay hat seine Position SELBST gewaehlt: `bottom-20`, `bottom-24`,
 * `bottom-[120px]`, `bottom-36`, `top-3`, `top-20`, `top-36`, `top-52` --
 * verteilt ueber ein Dutzend Dateien, keine kannte ihre Nachbarn.
 * `DriveOverlay.tsx` begruendete seinen Abstand sogar ausdruecklich, aber nur
 * gegenueber `DriveControls`; die drei Karten-Knoepfe auf derselben Seite
 * kamen darin gar nicht vor.
 *
 * Gemessen (`e2e/control-overlap.spec.ts`) waren es fuenf Ueberlappungen:
 *
 *     search-input        <-> maneuver-panel          4442 / 5878 qpx
 *     viewmode-button     <-> tts-toggle              1536 qpx
 *     recenter-button     <-> tts-toggle               768 qpx
 *     speed-limit-sign    <-> maplibre-zoom-controls  1728 qpx
 *     regions-panel-toggle<-> maplibre-zoom-controls   391 qpx
 *
 * ─── DIE REGEL ──────────────────────────────────────────────────────────────
 * Die Werte stehen jetzt hier, und die Komponenten lesen sie. Wer eine
 * Position aendert, aendert sie an einer Stelle -- und `control-overlap.spec.ts`
 * misst die ECHTEN Kaesten im Browser nach, kann also nicht von dieser Datei
 * abdriften.
 */

/* ─── RECHTER RAND, VON UNTEN ──────────────────────────────────────────────
 * Eine Spalte, in der sich alles stapelt: waehrend der Fahrt zuunterst die
 * Fahrt-Bedienung, darueber die Ansagen-Taste, darueber die drei
 * Karten-Knoepfe. Ohne Fahrt faellt der untere Teil weg und die Knoepfe
 * ruecken nach.
 */

/** Abstand zum unteren Rand. */
export const EDGE_INSET_PX = 16;
/** Luft zwischen zwei gestapelten Elementen. */
export const STACK_GAP_PX = 12;
/** Kantenlaenge der runden Karten-Knoepfe (`w-12 h-12`). */
export const FAB_SIZE_PX = 48;
/** Hoehe der Ansagen-Taste (`min-h-[64px]`). */
export const TTS_HEIGHT_PX = 64;
/**
 * Hoehe des Fahrt-Bedienblocks (Pause/Stopp).
 *
 * Die Knoepfe sind `min-h-[64px]` und stehen in einer Spalte mit `gap-2`.
 * Zwei davon waeren 136 -- gerechnet wird mit dem Platz fuer ZWEI, weil
 * „Pause" und „Stopp" beide da sind, sobald gefahren wird.
 */
export const DRIVE_CONTROLS_HEIGHT_PX = 64 * 2 + 8;

/** Ein Platz in der rechten Spalte, von unten nach oben. */
export type RightStackSlot = 'drive-controls' | 'tts' | 'viewmode' | 'compass' | 'recenter';

interface StackEntry {
  slot: RightStackSlot;
  heightPx: number;
  /** Nur waehrend einer laufenden Fahrt vorhanden. */
  driveOnly: boolean;
}

/** Die Reihenfolge von unten nach oben. Wer hier etwas einfuegt, verschiebt
 *  automatisch alles darueber -- das ist der ganze Zweck. */
const RIGHT_STACK: readonly StackEntry[] = [
  { slot: 'drive-controls', heightPx: DRIVE_CONTROLS_HEIGHT_PX, driveOnly: true },
  { slot: 'tts', heightPx: TTS_HEIGHT_PX, driveOnly: true },
  { slot: 'viewmode', heightPx: FAB_SIZE_PX, driveOnly: false },
  { slot: 'compass', heightPx: FAB_SIZE_PX, driveOnly: false },
  { slot: 'recenter', heightPx: FAB_SIZE_PX, driveOnly: false },
];

/**
 * Der Abstand dieses Platzes zum unteren Rand, in Bildpunkten.
 *
 * Waehrend der Fahrt zaehlen alle Eintraege, sonst nur die, die es ohne Fahrt
 * gibt -- so ruecken die Karten-Knoepfe nach unten, statt eine Luecke zu
 * lassen, wo die Fahrt-Bedienung waere.
 */
export function rightStackBottomPx(slot: RightStackSlot, driveActive: boolean): number {
  let bottom = EDGE_INSET_PX;
  for (const entry of RIGHT_STACK) {
    if (entry.driveOnly && !driveActive) continue;
    if (entry.slot === slot) return bottom;
    bottom += entry.heightPx + STACK_GAP_PX;
  }
  // Ein Platz, den es in diesem Zustand nicht gibt (etwa `tts` ohne Fahrt):
  // der Aufrufer rendert dann ohnehin nichts.
  return bottom;
}

/** Die belegten Bereiche der rechten Spalte -- fuer den Test. */
export function rightStackRects(driveActive: boolean): { slot: RightStackSlot; bottom: number; top: number }[] {
  return RIGHT_STACK.filter((e) => driveActive || !e.driveOnly).map((entry) => {
    const bottom = rightStackBottomPx(entry.slot, driveActive);
    return { slot: entry.slot, bottom, top: bottom + entry.heightPx };
  });
}

/* ─── OBERER RAND ──────────────────────────────────────────────────────────*/

/**
 * Abstand vom RECHTEN Rand fuer alles, was oben rechts liegt.
 *
 * MapLibre setzt seine eigene Zoom-/Kompass-Gruppe nach oben rechts. Gemessen
 * ist sie 29 Bildpunkte breit und sitzt 10 vom Rand -- belegt also 10..39.
 * Unsere Knoepfe standen auf `right-4` (16) und lagen damit mitten darin;
 * genau das ist „die Karteneinstellung über den Zoom-Einstellungen".
 *
 * ─── WARUM DIESE ZAHL SEIT 0.5.8 GERECHNET UND NICHT GEMESSEN WIRD ─────────
 * Sie stand auf 56 -- gemessen gegen die MapLibre-Gruppe, und dagegen stimmte
 * sie auch. Nur beruecksichtigte sie den ZWEITEN Stapel nicht: die
 * Fahr-Knoepfe am rechten Rand (`RIGHT_STACK`, `EDGE_INSET_PX` = 16, 48
 * breit) belegen 16..64 vom Rand. Bei 56 belegte die obere Spalte 56..104 --
 * acht Punkte Ueberschneidung.
 *
 * Aufgefallen ist das erst, als die obere Spalte auf vier Knoepfe wuchs und
 * damit weit genug nach unten reichte, um den Fahr-Stapel zu treffen. Der
 * Fehler war vorher schon da, nur ausser Reichweite -- `control-overlap.spec.ts`
 * hat ihn beim vierten Knopf gefunden.
 *
 * Jetzt gerechnet statt geraten: hinter dem Fahr-Stapel, plus derselbe
 * Zwischenraum wie zwischen dessen eigenen Knoepfen. Das ergibt 76 und
 * laesst der MapLibre-Gruppe (10..39) erst recht Luft.
 */
export const TOP_RIGHT_INSET_PX = EDGE_INSET_PX + FAB_SIZE_PX + STACK_GAP_PX;

/**
 * Oberkante der Abbiege-Anzeige.
 *
 * Sie stand auf `top-3` (12) und lag damit ueber der Suchzeile -- die
 * `TopBar` beginnt bei 0 und ist gemessen 62 Punkte hoch. Darunter statt
 * darueber.
 */
export const TOP_BAR_HEIGHT_PX = 62;
export const MANEUVER_PANEL_TOP_PX = TOP_BAR_HEIGHT_PX + 10;

/** Kantenlaenge des runden Tempolimit-Schilds (`w-16 h-16`). */
export const SPEED_LIMIT_SIGN_SIZE_PX = 64;

/**
 * Wie viel Platz die `TopBar` am rechten Rand freilassen muss.
 *
 * In ihrem Band liegen MapLibres Zoom-Gruppe (10..39 vom Rand) und das
 * Tempolimit-Schild (`TOP_RIGHT_INSET_PX` .. + 64). Die Suchzeile darf nicht
 * darunter durchlaufen -- vorher stand dort `pr-16` (64), und das Schild lag
 * mitten in der Suche.
 */
export const TOP_BAR_RIGHT_RESERVE_PX = TOP_RIGHT_INSET_PX + SPEED_LIMIT_SIGN_SIZE_PX + 8;

/**
 * Die Knopfsaeule am rechten oberen Rand, von oben nach unten.
 *
 * ─── WARUM DAS HIER STEHT ───────────────────────────────────────────────────
 * Diese vier Knoepfe standen mit handgewaehlten `top`-Werten (80, 144, 208)
 * in vier verschiedenen Dateien. Keine kannte ihre Nachbarn -- genau die
 * Ausgangslage, die zu „die Karteneinstellung über den Zoom-Einstellungen"
 * gefuehrt hat. Ein fuenfter Knopf mit einer fuenften geratenen Zahl haette
 * denselben Fehler ein weiteres Mal gemacht.
 *
 * `0` gehoert MapLibres eigener Zoom-/Kompass-Gruppe; unsere Saeule beginnt
 * darunter. Die Abstaende sind gemessen (Knopf 48 hoch, 16 Luft) und
 * `control-overlap.spec.ts` misst nach.
 */
export const TOP_RIGHT_STACK = ['regions', 'store', 'preflight', 'simulator'] as const;
export type TopRightSlot = (typeof TOP_RIGHT_STACK)[number];

/** Oberkante der MapLibre-Gruppe bis zum ersten eigenen Knopf. */
export const TOP_RIGHT_STACK_START_PX = 80;
/** Mitte-zu-Mitte-Abstand zweier Knoepfe der Saeule (48 Knopf + 16 Luft). */
export const TOP_RIGHT_STACK_STEP_PX = 64;

export function topRightSlotPx(slot: TopRightSlot): number {
  const index = TOP_RIGHT_STACK.indexOf(slot);
  /* istanbul ignore next -- der Typ laesst nichts anderes zu */
  if (index < 0) return TOP_RIGHT_STACK_START_PX;
  return TOP_RIGHT_STACK_START_PX + index * TOP_RIGHT_STACK_STEP_PX;
}

/* ─── UNTERER RAND, MITTE ──────────────────────────────────────────────────*/

/**
 * Unterkante der Fahrtdaten (Ankunft / Restzeit / Entfernung).
 *
 * Mittig unten, weil dort waehrend der Fahrt nichts anderes liegt: die
 * Fahrt-Bedienung und die Karten-Knoepfe stehen rechts, der Tacho links.
 *
 * 16 waere buendig mit der Fahrt-Bedienung -- bei schmalen Fenstern lagen
 * beide dann nebeneinander auf derselben Hoehe und beruehrten sich. Der Wert
 * hebt die Fahrtdaten darueber; `control-overlap.spec.ts` misst nach.
 */
export const TRIP_INFO_BOTTOM_PX = EDGE_INSET_PX;
