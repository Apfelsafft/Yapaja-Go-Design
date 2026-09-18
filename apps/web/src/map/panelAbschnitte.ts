/**
 * Was im Karten-Menü offen steht und was zusammengeklappt ist.
 *
 * ─── DER GEMELDETE FALL ─────────────────────────────────────────────────────
 * Zweimal gemeldet, wörtlich gleich:
 *
 *   „Das options Menü ist überfrachtet. Man kann die oberen Einträge nicht
 *    mehr lesen."
 *
 * Beim ersten Mal habe ich nur die HÖHE begrenzt und das Menü scrollbar
 * gemacht. Das war ein Symptom-Fix, und ich habe das damals auch so gesagt:
 * der Inhalt blieb derselbe, er lief nur nicht mehr oben aus dem Bild.
 *
 * ─── WARUM ES ÜBERHAUPT SO VOLL IST ─────────────────────────────────────────
 * Sieben Abschnitte, alle gleichzeitig ausgeklappt. Mit drei installierten
 * Regionen sind das rund zwanzig Knöpfe untereinander in einem 256 Punkte
 * breiten Feld. Auf einem 13-Zoll-iPad reicht das über den Bildschirm hinaus.
 *
 * ─── DIE ABWÄGUNG ──────────────────────────────────────────────────────────
 * Alles zuklappen wäre die einfache Antwort und die falsche: dann kostet der
 * häufigste Handgriff — den Kartenstil wechseln — zwei Tipps statt einem.
 *
 * Also nach HÄUFIGKEIT geteilt:
 *
 *   OFFEN     Kartenstil       der Grund, aus dem man dieses Menü öffnet
 *
 *   GEFALTET  Darstellung      Hell/Dunkel, Sprache, Schriftgröße, POI-Dichte
 *             Gerät            Links-/Rechtshänder, Setup-Assistent
 *
 * ─── „ANGEZEIGTE REGION" IST SEIT 0.16.0 WEG ────────────────────────────────
 * Sie stand hier als der zweite offene Abschnitt, „unterwegs im Grenzgebiet
 * mehrmals am Tag". Gewünscht wurde das Gegenteil:
 *
 *   „Der Anwender soll immer alles angezeigt bekommen was er runtergeladen
 *    hat. […] Auch die Auswahl der Region ist dann unnötig da ja immer alles
 *    angezeigt wird."
 *
 * Das ist richtig, und es macht diesen Abschnitt nicht nur überflüssig,
 * sondern schädlich: seine einzige Wirkung war, die Karte auf eine Region zu
 * VERKLEINERN. Ein Bedienelement, dessen bester Zustand „unberührt" ist,
 * gehört weg — nicht auf eine tiefere Menüebene.
 *
 * Damit bleibt das Menü auch unabhängig von der Zahl der installierten
 * Karten gleich hoch. Der ganze Grund für die Rechnung unten war dieser eine
 * Abschnitt; sie bleibt trotzdem stehen, weil sie festhält, was sich nicht
 * wieder verschlechtern soll.
 *
 * ─── WARUM DAS HIER STEHT UND NICHT IN DER KOMPONENTE ───────────────────────
 * Weil es eine ENTSCHEIDUNG ist und keine Darstellung. Sie gehört geprüft,
 * und in einer React-Komponente wäre sie nur noch im Browser zu erreichen.
 */

export type AbschnittId = 'stil' | 'darstellung' | 'geraet';

export interface Abschnitt {
  id: AbschnittId;
  /** Die Überschrift, wie sie dasteht. */
  titel: string;
  /**
   * `true` heißt: beim Öffnen des Menüs sofort sichtbar.
   *
   * Nicht gespeichert. Ein Menü, das sich je nach letzter Sitzung anders
   * öffnet, ist unvorhersehbar — und die Wahl hier ist billig zu wiederholen.
   */
  offen: boolean;
}

/**
 * Die Abschnitte in der Reihenfolge, in der sie stehen.
 *
 * Seit 0.16.0 hängen sie an gar nichts mehr — die Regionsliste war der
 * einzige Teil, der mit den Daten wuchs. Die Funktion bleibt trotzdem eine
 * Funktion und keine Konstante: sie ist die Stelle, an der diese Entscheidung
 * steht, und die Rechnung unten soll sie weiter prüfen können.
 */
export function panelAbschnitte(): Abschnitt[] {
  return [
    { id: 'stil', titel: 'Kartenstil', offen: true },
    { id: 'darstellung', titel: 'Darstellung', offen: false },
    { id: 'geraet', titel: 'Gerät', offen: false },
  ];
}

/**
 * Wie viele Zeilen das Menü beim Öffnen hoch ist — als Zahl, nicht als Gefühl.
 *
 * ─── WOZU EINE RECHNUNG STATT EINES BLICKS ──────────────────────────────────
 * „Überfrachtet" ist kein Maß. Mit einer Zahl lässt sich festhalten, was sich
 * nicht wieder verschlechtern soll — und genau das ist hier zweimal passiert.
 *
 * Gezählt werden Bedienzeilen, nicht Bildpunkte: eine Überschrift, ein Knopf,
 * ein Umschalter. Bildpunkte hingen an Schriftgrößen und Rändern und wären
 * eine Genauigkeit, die diese Rechnung nicht hat.
 *
 * Seit 0.16.0 hängt die Höhe nicht mehr an der Zahl der Karten: der einzige
 * Abschnitt, der mit ihnen wuchs, ist weg. Genau das hält diese Rechnung
 * fest — ein Abschnitt, der wieder mit den Daten wüchse, fiele hier auf.
 *
 * @param stile Zahl der Kartenstile
 */
export function zeilenBeimOeffnen(stile: number): number {
  let zeilen = 0;
  for (const a of panelAbschnitte()) {
    zeilen += 1; // die Überschrift, immer sichtbar
    if (!a.offen) continue;
    if (a.id === 'stil') zeilen += stile;
  }
  return zeilen;
}

/**
 * Was beim Öffnen höchstens zu sehen sein darf.
 *
 * Auf einem 13-Zoll-iPad im Hochformat passen rund achtzehn solcher Zeilen in
 * die Höhe, die dem Menü bleibt. Die Grenze liegt bewusst darunter: das Menü
 * soll nicht gerade so passen, sondern erkennbar Platz lassen.
 *
 * Die Zahl ist eine Entscheidung und keine Messung. Sie steht deshalb benannt
 * da und nicht in einem Vergleich versteckt.
 */
export const ZEILEN_HOECHSTENS = 14;
