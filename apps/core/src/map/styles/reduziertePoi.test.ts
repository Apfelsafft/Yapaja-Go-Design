/**
 * „Reduzierte POIs" filtert mit GENAU der Liste, die auch die Symbole
 * bestimmt.
 *
 * ─── WARUM DAS EINEN EIGENEN TEST WERT IST ──────────────────────────────────
 * `REDUCED_POI_CLASSES` war bis 0.9.0 eine zweite, von Hand gepflegte
 * Klassenliste. Sie enthielt `supermarket` — einen Wert, den das
 * Kachelprofil gar nicht als Klasse vergibt. Wer „reduziert" wählte (und im
 * Stil „Kontrast" ist das die Vorgabe), bekam deshalb KEINEN einzigen
 * Supermarkt zu sehen. Nichts schlug fehl, nichts stand im Protokoll.
 *
 * Behoben wurde das nicht mit einem Vergleich zweier Listen, sondern indem
 * die zweite verschwand: `REDUCED_POI_CLASSES` IST seither
 * `POI_KLASSEN_MIT_SYMBOL`, unter anderem Namen.
 *
 * ─── UND WARUM ER JETZT HIER STEHT ──────────────────────────────────────────
 * Diese Zusicherung stand bis 0.17.0 bei der Kategorienliste selbst. Die ist
 * mit den einzelnen Kategorie-Schaltern nach `@yapaia/shared` gezogen —
 * `constants.ts` aber nicht, denn der Stil wird im Kern gebaut. Ein Test in
 * `shared` kann den Kern nicht erreichen.
 *
 * Er gehört ohnehin hierher: geprüft wird eine Aussage über `constants.ts`,
 * nicht über den Katalog. Und er ist weiterhin nötig, obwohl die Gleichheit
 * heute aus einem `export … from` folgt — genau dieses `export` ist es, was
 * jemand wieder durch eine eigene Liste ersetzen könnte.
 */

import { describe, it, expect } from 'vitest';
import { POI_KLASSEN_MIT_SYMBOL } from '@yapaia/shared';
import { REDUCED_POI_CLASSES } from './constants.js';

describe('REDUCED_POI_CLASSES', () => {
  it('ist dieselbe Liste wie die der Kategorien mit Symbol', () => {
    // `toBe` und nicht `toEqual`: gleicher INHALT wäre auch bei einer Kopie
    // gegeben, und eine Kopie ist genau das, was wieder abdriften kann.
    expect(REDUCED_POI_CLASSES).toBe(POI_KLASSEN_MIT_SYMBOL);
  });

  it('enthält `grocery` und nicht `supermarket`', () => {
    // Die Gegenprobe zum ursprünglichen Fehler. Sie steht auch im Katalog;
    // hier steht sie unter dem Namen, unter dem der Fehler passiert ist.
    expect(REDUCED_POI_CLASSES).toContain('grocery');
    expect(REDUCED_POI_CLASSES).not.toContain('supermarket');
  });
});
