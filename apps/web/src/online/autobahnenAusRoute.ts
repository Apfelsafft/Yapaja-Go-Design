/**
 * Welche Bundesautobahnen liegen auf dieser Route?
 *
 * ─── WOZU ───────────────────────────────────────────────────────────────────
 * Der Kern fragt Verkehrsmeldungen NUR für Straßen ab, die ihm genannt werden
 * (siehe `apps/core/src/online/verkehr.ts`). Welche das sind, weiß allein die
 * App — sie hat die Route. Diese Datei ist die Brücke.
 *
 * ─── WARUM NUR „A" UND NICHT AUCH „B" ───────────────────────────────────────
 * Die Schnittstelle der Autobahn GmbH führt ausschließlich BUNDESAUTOBAHNEN.
 * Eine Anfrage nach „B9" ginge ins Leere — und zwar als leere Liste, also
 * ununterscheidbar von „auf der B9 ist nichts los". Genau diese Verwechslung
 * kostet in diesem Projekt seit Monaten Zeit, deshalb wird hier gefiltert und
 * nicht gehofft.
 *
 * ─── UND WARUM DIE SCHREIBWEISE SO GROSSZÜGIG GELESEN WIRD ──────────────────
 * Ich habe NICHT gemessen, wie Valhalla deutsche Autobahnen in
 * `street_names` schreibt — dafür bräuchte es einen Graphen mit deutschen
 * Daten, und den gibt es in dieser Entwicklungsumgebung nicht. In OSM steht
 * `ref=A 61` (mit Leerzeichen), Valhalla reicht `ref` oft unverändert durch,
 * manchmal aber auch zusammengezogen, und mehrere Nummern trennt OSM mit
 * Semikolon (`A 61;A 6`).
 *
 * Statt eine dieser Formen zu raten, werden alle gelesen. Das kostet nichts
 * und deckt den Fall ab, dass meine Annahme falsch ist.
 *
 * Damit ein Irrtum trotzdem SICHTBAR wird, gibt die Oberfläche aus, welche
 * Autobahnen sie erkannt hat. Erscheinen dort keine, obwohl die Route über
 * die A61 führt, sieht man das sofort — statt sich zu fragen, warum die Karte
 * leer bleibt.
 */

/** Was hier gelesen wird — absichtlich nur das, was wirklich gebraucht wird. */
export interface MitStrassennamen {
  street_names?: string[];
  /** Die Ansage, z. B. „Auffahrt auf A 61". Zweite Quelle, siehe unten. */
  instruction?: string;
}

/**
 * Eine Autobahnkennung, wie die Schnittstelle sie erwartet: `A61`.
 *
 * Erlaubt sind ein bis vier Ziffern. Die höchste deutsche Autobahnnummer ist
 * dreistellig (A 995), aber eine Grenze bei drei wäre eine Annahme über die
 * Zukunft, die nichts einbringt.
 */
const AUTOBAHN = /\bA[\s-]?(\d{1,4})\b/gi;

/**
 * Sammelt die Autobahnen aus einer Liste von Manövern.
 *
 * `street_names` ist die verlässlichere Quelle. Die `instruction` wird
 * ZUSÄTZLICH gelesen, weil Valhalla die Nummer dort manchmal nennt, wo
 * `street_names` leer bleibt — bei Auffahrten etwa steht die Autobahn im
 * Satz, aber der Weg selbst heißt nur „Auffahrt".
 */
export function autobahnenAusRoute(manoever: readonly MitStrassennamen[]): string[] {
  const gefunden = new Set<string>();

  for (const m of manoever) {
    const texte = [...(m.street_names ?? [])];
    if (m.instruction) texte.push(m.instruction);

    for (const text of texte) {
      if (typeof text !== 'string') continue;
      // ─── EIN ENTFERNTER WÄCHTER, DER NIE EINER WAR ──────────────────────
      // Hier stand `AUTOBAHN.lastIndex = 0`, begründet damit, ein globaler
      // Ausdruck merke sich seine Position zwischen den Texten. Nachgemessen:
      //
      //   re.lastIndex nach matchAll → 0      (unberührt)
      //   re.lastIndex nach exec     → 3
      //
      // `matchAll` arbeitet auf einer Kopie und lässt das Original in Ruhe.
      // Die Zeile war also wirkungslos, und ihre Begründung war falsch.
      //
      // Auch für `exec` wäre sie entbehrlich, SOLANGE bis zum Ende geschleift
      // wird — der letzte, erfolglose Aufruf setzt selbst zurück. Gefährlich
      // wäre allein ein einzelnes `exec` ohne Schleife. Das ist so eng, dass
      // es hier keinen Wächter rechtfertigt; es steht als Warnung da.
      //
      // Aufgeschrieben, weil eine Vorsichtsmaßnahme, die nichts schützt,
      // schlimmer ist als keine: sie sieht beim Lesen wie eine Absicherung
      // aus und lenkt von der Stelle ab, an der es wirklich klemmt.
      for (const treffer of text.matchAll(AUTOBAHN)) {
        // Führende Nullen weg: „A 061" und „A61" sind dieselbe Autobahn, und
        // die Schnittstelle kennt nur eine Schreibweise davon.
        const nummer = String(Number(treffer[1]));
        if (nummer === '0') continue;
        gefunden.add(`A${nummer}`);
      }
    }
  }

  // Nach Nummer sortiert und nicht alphabetisch: sonst stünde A10 vor A3,
  // und eine Liste, die man dem Betreiber zeigt, soll lesbar sein.
  return [...gefunden].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}
