/**
 * Welche Sonderziele die Karte zeigt — einzeln an- und abschaltbar.
 *
 * ─── WOFÜR ──────────────────────────────────────────────────────────────────
 * Gewünscht:
 *
 *   „Kann ich die einzelnen sonderziele auch an und abschalten? Zapfstellen
 *    brauche ich eher selten und dann stören sie bspw."
 *
 * Bis 0.16.5 gab es dafür genau einen Schalter: „POI-Dichte" mit den Stufen
 * voll / reduziert / aus. Er beantwortet die Frage nicht. Wer die Zapfstellen
 * loswerden wollte, hatte die Wahl zwischen „alle Symbole" und „keine
 * Symbole" — und mit „keine" verliert man auch die Stellplätze, also genau
 * das, wofür die Symbole überhaupt da sind.
 *
 * ─── DIE LISTE IST ABGELEITET, NICHT ABGESCHRIEBEN ──────────────────────────
 * Die dreizehn Kategorien stehen NICHT hier. Sie stehen in `./kategorien.ts`
 * (was die Kacheln hergeben) und `./fehlendeKlassen.ts` (was nur der
 * Suchindex hat), und diese Datei setzt die beiden bloß zusammen.
 *
 * Das ist Absicht und hat einen Namen: `supermarket`. In `constants.ts` stand
 * bis 0.9.0 eine zweite, von Hand gepflegte Klassenliste, die von der ersten
 * abgedriftet war — „reduzierte POIs" zeigte deshalb keinen einzigen
 * Supermarkt, und nichts schlug fehl. Behoben wurde das nicht mit einem
 * Test, der beide Listen vergleicht, sondern indem die zweite verschwand.
 *
 * Wer also eine Kategorie hinzufügt, bekommt ihren Schalter geschenkt. Wer
 * eine entfernt, verliert ihn. Ein Vergessen ist nicht möglich.
 *
 * ─── WARUM DER SPRITE-NAME DER SCHLÜSSEL IST ────────────────────────────────
 * Ein eigenes Schlüsselfeld wäre ein vierzehnter Name, den jemand pflegen
 * müsste. Der Sprite-Name leistet dasselbe und ist bereits eindeutig — ein
 * Test in `ausIndex.test.ts` hält fest, dass keine zwei Kategorien dasselbe
 * Bild tragen, denn zwei gleiche Bilder wären auf der Karte schon
 * unbrauchbar.
 *
 * Er ist ausserdem der Wert, auf den die Karte ohnehin schon filtert: die
 * Kachelebene rechnet ihn mit `symbolNachKategorie()` aus, die Indexebene
 * trägt ihn als `properties.symbol`. Derselbe Schlüssel wirkt damit auf
 * beiden Ebenen, ohne Übersetzungstabelle dazwischen.
 *
 * ─── WAS GESPEICHERT WIRD, IST DAS ABGESCHALTETE ────────────────────────────
 * Nicht die Menge der eingeschalteten. Der Unterschied zählt genau einmal,
 * und zwar beim nächsten Update: kommt eine Kategorie dazu, ist sie bei
 * „abgeschaltet gespeichert" automatisch DA, und bei „eingeschaltet
 * gespeichert" automatisch WEG.
 *
 * Für eine Karte, die einem sagen soll, wo man Wasser bekommt, ist nur die
 * erste Richtung vertretbar. Das Schlimmste, was ein neues Symbol anrichten
 * kann, ist, dass man es wegklickt. Das Schlimmste, was ein fehlendes
 * anrichten kann, ist ein verpasster Halt.
 */

import { POI_KATEGORIEN } from './kategorien';
import { FEHLENDE_KLASSEN } from './fehlendeKlassen';

/**
 * Woher die Punkte einer Kategorie kommen.
 *
 * Steht hier, weil es für den Bedienenden einen sichtbaren Unterschied macht:
 * `index`-Kategorien gibt es nur, wenn der Suchindex gebaut wurde, und sie
 * fehlen in einem Index, der vor 0.16.1 gebaut wurde (siehe
 * `./fehlendeKlassen.ts`). Ein Schalter, der nichts bewirkt, weil die Daten
 * fehlen, ist sonst nicht von einem kaputten zu unterscheiden.
 */
export type PoiQuelle = 'kachel' | 'index';

/** Eine Kategorie, wie die Einstellungen sie anbieten. */
export interface PoiAuswahlEintrag {
  /** Der Sprite-Name; zugleich der Schlüssel im gespeicherten Zustand. */
  readonly schluessel: string;
  /** Deutscher Name für den Schalter. */
  readonly name: string;
  readonly quelle: PoiQuelle;
  /** Reihenfolge auf der Karte — kleiner ist wichtiger. */
  readonly rang: number;
}

/**
 * Alle abschaltbaren Kategorien, nach Rang sortiert.
 *
 * Die Sortierung ist die der KARTE, nicht das Alphabet: was bei Gedränge
 * stehen bleibt, steht auch in der Liste oben. Wer die Schalter durchgeht,
 * geht sie damit in der Reihenfolge durch, in der sie ihm auf der Karte
 * begegnen — Stellplatz zuerst, Dusche zuletzt.
 */
export const POI_AUSWAHL: readonly PoiAuswahlEintrag[] = [
  ...POI_KATEGORIEN.map(
    (k): PoiAuswahlEintrag => ({
      schluessel: k.symbol,
      name: k.name,
      quelle: 'kachel',
      rang: k.rang,
    }),
  ),
  ...FEHLENDE_KLASSEN.map(
    (k): PoiAuswahlEintrag => ({
      schluessel: k.symbol,
      name: k.name,
      quelle: 'index',
      rang: k.rang,
    }),
  ),
].sort((a, b) => a.rang - b.rang);

/** Jeder gültige Schlüssel. */
export const POI_SCHLUESSEL: readonly string[] = POI_AUSWAHL.map((e) => e.schluessel);

/** Ob ein Schlüssel zu einer Kategorie gehört, die es wirklich gibt. */
export function istBekannterPoi(schluessel: string): boolean {
  return POI_SCHLUESSEL.includes(schluessel);
}

/**
 * Macht aus `?poiAus=poi-tanken,poi-dusche` eine geprüfte Liste.
 *
 * ─── UNBEKANNTES FÄLLT WEG, UND ZWAR IN DIE SICHERE RICHTUNG ────────────────
 * Ein Schlüssel, den es nicht (mehr) gibt, wird ignoriert — die Kategorie
 * erscheint dann eben. Das ist die Richtung, in der ein Fehler nichts
 * verbirgt.
 *
 * Andersherum — Unbekanntes durchreichen — landete es im Kartenfilter, und
 * ein Filter gegen einen Wert, den keine Kategorie trägt, ist zwar
 * wirkungslos, aber eben auch nicht überprüfbar. Und ein getippter
 * Parameter würde damit still zur Einstellung.
 *
 * Doppelte Einträge fallen ebenfalls weg, sonst wüchse die gespeicherte
 * Einstellung bei jedem Klick.
 */
export function parseAbgeschaltet(roh: string | undefined | null): string[] {
  if (!roh) return [];
  const gesehen = new Set<string>();
  for (const teil of roh.split(',')) {
    const wert = teil.trim();
    if (wert && istBekannterPoi(wert)) gesehen.add(wert);
  }
  // Nach der Katalogreihenfolge, damit derselbe Zustand immer denselben
  // Parameter ergibt -- sonst wäre der Stil-Zwischenspeicher im Browser für
  // zwei gleiche Einstellungen zweimal kalt.
  return POI_SCHLUESSEL.filter((s) => gesehen.has(s));
}

/** Die Gegenrichtung: aus der Liste wieder ein Parameterwert. */
export function alsPoiParameter(abgeschaltet: readonly string[]): string {
  return parseAbgeschaltet(abgeschaltet.join(',')).join(',');
}

/**
 * Der MapLibre-Ausdruck „dieser Punkt ist nicht abgeschaltet".
 *
 * `symbolAusdruck` ist, woran die jeweilige Ebene ihre Kategorie erkennt:
 * auf der Kachelebene das gerechnete `symbolNachKategorie()`, auf der
 * Indexebene das schlichte `['get', 'symbol']`. Dass beide denselben
 * Wertebereich haben, ist keine Absprache, sondern Folge davon, dass der
 * Schlüssel der Sprite-Name IST.
 *
 * Gibt `null` zurück, wenn nichts abgeschaltet ist — ein Filter, der alles
 * durchlässt, gehört nicht in den Stil, sondern weggelassen.
 */
export function nichtAbgeschaltet(
  symbolAusdruck: unknown,
  abgeschaltet: readonly string[],
): unknown[] | null {
  const aus = parseAbgeschaltet(abgeschaltet.join(','));
  if (aus.length === 0) return null;
  return ['!', ['in', symbolAusdruck, ['literal', aus]]];
}
