/**
 * Was ein Tipper auf die Karte BEDEUTET.
 *
 * ─── ZWEI GEMELDETE FEHLER, EINE STELLE ─────────────────────────────────────
 * `DestinationSelector.handlePick` endete bedingungslos mit `setDestination`.
 * Daraus folgten beide Meldungen des Betreibers:
 *
 *   1. „Wenn die Navigation aktiv ist und man auf die Karte klickt, wird in
 *      den Zielsetzen-Modus gewechselt. Die Route verschwindet."
 *
 *      Jeder Tipper waehrend der Fahrt -- auch ein verrutschter Schwenk --
 *      ersetzte die laufende Route durch einen Zielpunkt. Ohne Rueckfrage,
 *      ohne Weg zurueck.
 *
 *   2. „Wenn ich hier nicht genau treffe, bin ich wieder in der Zieleingabe.
 *      Alle vorgeschlagenen Routen sind weg."
 *
 *      Der Treffertest fragte GENAU EINEN Pixel ab (`e.point`). Eine
 *      Fingerkuppe ist keinen Pixel breit; jeder Tipper knapp neben die Linie
 *      fiel durch und setzte ein neues Ziel -- was die Alternativen verwarf.
 *
 * Beides ist dieselbe Sorte Fehler: eine Handlung mit grossen Folgen, die
 * ausgeloest wird, ohne dass jemand sie gemeint hat.
 *
 * ─── WARUM DAS HIER STEHT UND NICHT IM HANDLER ──────────────────────────────
 * Im Event-Handler waere die Regel nur durch einen Browser-Test pruefbar. Als
 * reine Funktion laesst sich jede Kombination durchgehen -- und die Regel
 * steht an EINER Stelle, statt sich ueber `if`-Zweige zu verteilen.
 */

import type { NavState } from '@yapaia/shared';
import { DRIVE_ACTIVE_STATUSES } from '../drive/driveActive.js';

/**
 * Wie weit ein Tipper von einer Route entfernt sein darf, um noch als
 * Treffer zu gelten -- in Bildschirmpunkten.
 *
 * 18 ist keine Zierde: eine Fingerkuppe deckt auf einem Tablet rund 7-10 mm
 * ab. Mit dem vorherigen Wert (ein einziger Pixel) traf man die Linie nur
 * mit der Maus zuverlaessig -- und dieses Geraet wird mit dem Finger
 * bedient, im Fahrzeug, oft in Bewegung.
 */
export const ROUTE_TAP_RADIUS_PX = 18;

// Die Liste stand hier einmal abgeschrieben, „dieselbe wie in
// ManeuverPanel.tsx". Zwei Kopien laufen frueher oder spaeter auseinander --
// jetzt gibt es nur noch eine (`drive/driveActive.ts`).

/**
 * Wie die Karte berührt wurde.
 *
 * ─── DIE DRITTE MELDUNG DERSELBEN SORTE ─────────────────────────────────────
 * „Wenn man auf die Karte tippt übernimmt er ja die Position und markiert sie
 *  als roten Punkt. Bspw als nächstes Ziel. Kannst du das bitte ändern dass
 *  das nur mit einem Long press der Fall ist? Oftmals passiert das wenn man
 *  auf der Karte sucht, dass ein neues Ziel gewählt wird."
 *
 * Dieselbe Sorte Fehler wie die beiden oben, nur ausserhalb der Fahrt: eine
 * Handlung mit grossen Folgen, ausgeloest, ohne dass jemand sie gemeint hat.
 * Meldung 1 hat sie waehrend der Fahrt abgestellt; beim Suchen auf der Karte
 * -- also genau dann, wenn man viel wischt und zoomt -- blieb sie.
 *
 * Ein Wischer, der um zwei Bildpunkte danebengeht, IST fuer den Browser ein
 * Klick. Gegen eine Bewegungsschwelle allein ist das nicht zu trennen; gegen
 * die DAUER schon, und eine absichtliche Zielwahl ein halbe Sekunde zu halten
 * kostet nichts.
 */
export type Geste = 'tipp' | 'lang';

export type MapTapIntent =
  /** Diese Alternative wird zur aktiven Route. */
  | { kind: 'select-route'; routeId: string }
  /** Der Tipper setzt den Startpunkt (Startpunkt-Modus ist aktiv). */
  | { kind: 'set-origin' }
  /** Der Tipper setzt ein neues Ziel. */
  | { kind: 'set-destination' }
  /** Der Tipper setzt ein Zwischenziel (Zwischenziel-Modus ist aktiv). */
  | { kind: 'set-waypoint' }
  /** Der Tipper bewirkt nichts. */
  | { kind: 'ignore'; reason: 'drive-active' | 'nur-langer-druck' };

export interface MapTapContext {
  /** Die Route unter dem Finger, oder `null`. Bereits MIT Toleranz ermittelt. */
  tappedRouteId: string | null;
  /** Worauf sich der Tipper bezieht, aus `useRoutingStore`. */
  pickTarget: 'origin' | 'destination' | 'waypoint';
  /** Der Status aus `useNavStore`, oder `null`/`undefined` wenn unbekannt. */
  navStatus: NavState['status'] | null | undefined;
  /**
   * Kurz getippt oder lange gedrueckt.
   *
   * Ohne Angabe gilt `tipp` -- der vorsichtigere der beiden Werte. Ein
   * vergessenes Feld setzt damit kein Ziel, statt eines zu setzen.
   */
  geste?: Geste;
}

/**
 * Die eine Entscheidung.
 *
 * Reihenfolge mit Absicht:
 *
 *  1. Eine getroffene Alternative gewinnt IMMER. Auch waehrend einer Fahrt --
 *     eine andere Route zu waehlen ist kein Verwerfen, sondern ein Wechsel,
 *     und der Betreiber hat sichtbar auf eine Linie gezielt.
 *
 *  2. Waehrend einer laufenden Fahrt bewirkt ein Tipper daneben NICHTS.
 *     Das ist die Behebung von Meldung 1. Bewusst kein Rueckfrage-Dialog:
 *     ein Dialog ueber der Karte ist im Fahrzeug gefaehrlicher als der
 *     ignorierte Tipper. Wer waehrend der Fahrt woandershin will, hat
 *     „Stopp" und die Suche -- beides absichtliche Handlungen.
 *
 *  3. Der Zwischenziel-Modus gilt AUCH waehrend der Fahrt. Das ist kein
 *     Widerspruch zu Punkt 2: in diesen Modus kommt man nur ueber einen
 *     eigenen Knopf, das Antippen der Karte ist also bereits die zweite
 *     bewusste Handlung. Genau das unterscheidet ihn vom verrutschten
 *     Schwenk, um den es in Meldung 1 ging -- und der Betreiber hat
 *     Zwischenziele ausdruecklich „auch waehrend aktiver Navigation"
 *     verlangt.
 *
 *  4. Sonst gilt der Startpunkt-Modus, dann das Ziel -- wie bisher.
 *
 *  5. Ein NEUES Ziel verlangt den langen Druck. Das ist die Behebung von
 *     Meldung 3, und es gilt bewusst NUR hier:
 *
 *     - Die Alternative (1) ist ein Tipper auf eine sichtbare Linie. Wer
 *       darauf zielt, meint sie.
 *     - Start- und Zwischenziel-Modus (3, 4) betritt man ueber einen eigenen
 *       Knopf. Das Antippen ist dort bereits die ZWEITE bewusste Handlung,
 *       und einen halben Sekundendruck zusaetzlich zu verlangen waere
 *       Schikane -- diese Modi sind ausserdem an einem sichtbaren Zustand
 *       erkennbar, das freie Zielsetzen nicht.
 *
 *     Das freie Zielsetzen ist die einzige Handlung, die JEDERZEIT aus einem
 *     verrutschten Wischer entstehen kann. Nur sie bekommt die Huerde.
 */
export function mapTapIntent(ctx: MapTapContext): MapTapIntent {
  if (ctx.tappedRouteId !== null) {
    return { kind: 'select-route', routeId: ctx.tappedRouteId };
  }
  if (ctx.pickTarget === 'waypoint') {
    return { kind: 'set-waypoint' };
  }
  if (ctx.navStatus != null && DRIVE_ACTIVE_STATUSES.has(ctx.navStatus)) {
    return { kind: 'ignore', reason: 'drive-active' };
  }
  if (ctx.pickTarget === 'origin') {
    return { kind: 'set-origin' };
  }
  // Fehlt die Angabe, gilt `tipp`: ein vergessenes Feld setzt dann kein Ziel,
  // statt eines zu setzen. Die unauffaelligere Richtung ist hier die
  // richtige -- ein ausbleibendes Ziel merkt man sofort, ein ungewolltes
  // erst, wenn die Route weg ist.
  if ((ctx.geste ?? 'tipp') !== 'lang') {
    return { kind: 'ignore', reason: 'nur-langer-druck' };
  }
  return { kind: 'set-destination' };
}
