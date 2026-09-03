/**
 * `target.push(...source)` — und warum das eine Falle ist.
 *
 * ─── DER FEHLER, DEN ES HIER GAB ────────────────────────────────────────────
 * Der Spread-Operator macht aus jedem Element ein ARGUMENT. `push(...arr)` mit
 * einer halben Million Einträgen ruft `push` mit einer halben Million
 * Argumenten auf — und V8 hat dafür eine Obergrenze. Was dann kommt, ist:
 *
 *     Maximum call stack size exceeded
 *
 * Es sieht aus wie eine Endlosrekursion und ist keine. Vor allem aber
 * PASSIERT ES NUR BEI GROSSEN DATEN: für Liechtenstein (3 189 Datensätze) lief
 * derselbe Code jahrelang durch, in der CI und auf dem Gerät. Erst
 * Rheinland-Pfalz brachte ihn zum Absturz — beim Betreiber, nicht bei uns.
 *
 * Genau das ist die Tücke: eine Grenze, die von der Datenmenge abhängt, ist
 * in einem Test mit einer kleinen Beispielregion unsichtbar. Deshalb prüft
 * `appendAll.test.ts` ausdrücklich mit einer Menge OBERHALB der Grenze.
 *
 * ─── WARUM EINE EIGENE FUNKTION ────────────────────────────────────────────
 * Die Stellen, an denen zwei Listen zusammengehängt werden, sind über den
 * Quelltext verteilt und sehen harmlos aus. Eine benannte Funktion mit dieser
 * Begründung macht aus einer unsichtbaren Falle eine sichtbare Entscheidung —
 * und der nächste, der zwei Listen verbindet, findet sie.
 */

/**
 * Hängt alle Elemente von `source` an `target` an, ohne den Aufrufstapel zu
 * belasten. Verändert `target` (wie `push`) und gibt es zurück.
 *
 * Bewusst eine Schleife und kein `concat`: `concat` legt bei jedem Aufruf
 * eine NEUE Liste an, was in einer Schleife über viele Teilstücke quadratisch
 * wird. Die Schleife hier ist linear und kommt ohne Zwischenkopie aus.
 */
export function appendAll<T>(target: T[], source: readonly T[]): T[] {
  for (let i = 0; i < source.length; i++) {
    target.push(source[i]);
  }
  return target;
}
