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
 *             Angezeigte Region  unterwegs im Grenzgebiet mehrmals am Tag
 *
 *   GEFALTET  Darstellung      Hell/Dunkel, Sprache, Schriftgröße, POI-Dichte
 *             Gerät            Links-/Rechtshänder, Setup-Assistent
 *
 * „Angezeigte Region" erscheint ohnehin nur bei mehr als einer installierten
 * Karte — bei einer einzigen gibt es nichts zu wählen.
 *
 * ─── WARUM DAS HIER STEHT UND NICHT IN DER KOMPONENTE ───────────────────────
 * Weil es eine ENTSCHEIDUNG ist und keine Darstellung. Sie gehört geprüft,
 * und in einer React-Komponente wäre sie nur noch im Browser zu erreichen.
 */

export type AbschnittId = 'stil' | 'region' | 'darstellung' | 'geraet';

/**
 * Bis zu wie vielen Karten die Regionsliste offen bleibt.
 *
 * Ein bis drei Nachbarländer sind der Normalfall; dort soll der Wechsel EIN
 * Tipp sein. Wer ein Dutzend Karten installiert hat, sucht ohnehin in einer
 * Liste — und dann darf sie nicht alles andere aus dem Bild schieben.
 */
export const REGIONEN_NOCH_OFFEN = 4;

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
 * @param regionen Zahl der installierten Karten
 */
export function panelAbschnitte(regionen: number): Abschnitt[] {
  const abschnitte: Abschnitt[] = [
    { id: 'stil', titel: 'Kartenstil', offen: true },
  ];
  if (regionen > 1) {
    abschnitte.push({
      id: 'region',
      titel: 'Angezeigte Region',
      // ─── DER EINZIGE ABSCHNITT, DER MIT DEN DATEN WÄCHST ──────────────
      // Stile, Sprachen und Schriftgrößen sind feste Listen. Die Regionen
      // sind es nicht: wer quer durch Europa fährt, hat ein Dutzend.
      //
      // Ein erster Entwurf ließ diesen Abschnitt immer offen. Die Rechnung
      // unten hat gezeigt, dass er damit bei sechs Regionen genau die Grenze
      // reisst, die er einhalten sollte — also ausgerechnet auf der langen
      // Fahrt, auf der man ihn am nötigsten braucht.
      //
      // Bis vier Karten bleibt er offen: das ist der Normalfall (ein bis
      // drei Nachbarländer), und dort soll der Wechsel EIN Tipp sein.
      // Darüber klappt er zu und kostet einen zweiten.
      offen: regionen <= REGIONEN_NOCH_OFFEN,
    });
  }
  abschnitte.push(
    { id: 'darstellung', titel: 'Darstellung', offen: false },
    { id: 'geraet', titel: 'Gerät', offen: false },
  );
  return abschnitte;
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
 * @param stile    Zahl der Kartenstile
 * @param regionen Zahl der installierten Karten
 */
export function zeilenBeimOeffnen(stile: number, regionen: number): number {
  let zeilen = 0;
  for (const a of panelAbschnitte(regionen)) {
    zeilen += 1; // die Überschrift, immer sichtbar
    if (!a.offen) continue;
    if (a.id === 'stil') zeilen += stile;
    // „Alle" plus eine Zeile je Region.
    if (a.id === 'region') zeilen += regionen + 1;
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
