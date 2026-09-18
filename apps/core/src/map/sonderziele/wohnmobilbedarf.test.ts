/**
 * Die vier Dinge, wegen denen ein Wohnmobil überhaupt anhält.
 *
 * ─── WARUM ES DIESE DATEI ZUSÄTZLICH GIBT ───────────────────────────────────
 * `ausIndex.test.ts` prüft die Liste der Sonderziele STRUKTURELL: jede
 * Kategorie darin muss gesammelt werden, jedes Symbol muss existieren, keine
 * zwei dürfen dasselbe Bild tragen. Diese Prüfungen laufen über die Liste
 * hinweg — sie bleiben grün, egal was darin steht.
 *
 * Genau daran wäre diese Änderung unbemerkt rückgängig zu machen. Wer
 * `water_point` wieder herausnimmt, bricht keinen einzigen bestehenden Test:
 * die Liste ist dann eben kürzer und weiterhin in sich stimmig.
 *
 * Deshalb steht hier, was NAMENTLICH drin sein muss, und warum. Es sind die
 * Bedürfnisse, um die sich ein Reisetag baut — Frischwasser rein, Abwasser
 * raus, Müll weg, und wenn es gut läuft eine Dusche.
 */

import { describe, it, expect } from 'vitest';
import { FEHLENDE_KLASSEN, FEHLENDE_KATEGORIEN, klasseFuer } from './fehlendeKlassen.js';
import { POI_CATEGORIES } from '../../search/lite/poiCategories.js';

/** Alle Kategorien, die der Suchindex beim Bau einsammelt. */
const GESAMMELT = new Set(
  Object.values(POI_CATEGORIES).flatMap((liste) => liste.map((c) => c.value)),
);

describe('die Wohnmobil-Grundbedürfnisse stehen auf der Karte', () => {
  it.each([
    ['sanitary_dump_station', 'Entsorgungsstation'],
    ['water_point', 'Frischwasser-Zapfstelle'],
    ['waste_disposal', 'Müllentsorgung'],
    ['shower', 'Dusche'],
  ])('%s ist als „%s" dabei', (kategorie, name) => {
    const klasse = klasseFuer(kategorie);
    expect(klasse, `${kategorie} fehlt in FEHLENDE_KLASSEN`).toBeDefined();
    expect(klasse?.name).toBe(name);
    expect(klasse?.symbol, `${kategorie} hat kein Symbol`).toBeTruthy();
  });

  it.each(['sanitary_dump_station', 'water_point', 'waste_disposal', 'shower'])(
    '%s wird auch wirklich in den Index gesammelt',
    (kategorie) => {
      // ─── DIE HÄLFTE, DIE 0.13.0 NOCH NICHT NÖTIG HATTE ──────────────────
      // Bei der Entsorgungsstation lagen die Daten längst im Index; es fehlte
      // nur der Weg zur Karte. Bei `water_point` und `shower` fehlten sie
      // ÜBERALL -- `poiCategories.ts` sammelte sie nicht. Ein Eintrag in
      // FEHLENDE_KLASSEN allein verspräche dann ein Symbol, das nie
      // erscheinen kann.
      expect(GESAMMELT.has(kategorie), `${kategorie} steht in keiner POI_CATEGORIES-Liste`).toBe(
        true,
      );
    },
  );
});

describe('Zapfstelle und Trinkbrunnen sind nicht dasselbe', () => {
  it('`water_point` und `drinking_water` sind zwei Einträge', () => {
    // ─── DER UNTERSCHIED, UM DEN ES GEHT ────────────────────────────────────
    // `drinking_water` ist eine Stelle, an der man TRINKT -- ein Brunnen, ein
    // Wasserhahn am Spielplatz. `water_point` ist eine Zapfstelle, die dafür
    // gemacht ist, einen TANK zu füllen.
    //
    // Für ein Wohnmobil ist das der Unterschied zwischen „hier kann ich einen
    // Becher füllen" und „hier kann ich weiterfahren". Sie
    // zusammenzuwerfen liesse die seltenere und wichtigere Sorte in der
    // häufigeren verschwinden.
    expect(GESAMMELT.has('water_point')).toBe(true);
    expect(GESAMMELT.has('drinking_water')).toBe(true);
  });

  it('nur die Zapfstelle kommt aus dem Suchindex auf die Karte', () => {
    // Der Trinkbrunnen steht im OpenMapTiles-Schema (1×) und kommt damit aus
    // den KACHELN -- über `poiKategorien.ts`, Rang 9. Ihn zusätzlich aus dem
    // Index zu zeichnen hiesse, jeden Brunnen doppelt auf die Karte zu legen.
    expect(FEHLENDE_KATEGORIEN).toContain('water_point');
    expect(
      FEHLENDE_KATEGORIEN,
      'drinking_water steht in den Kacheln — aus dem Index gezeichnet wäre es doppelt',
    ).not.toContain('drinking_water');
  });

  it('sie tragen verschiedene Namen', () => {
    // Die Gegenprobe: hiessen beide „Trinkwasser", wäre die Unterscheidung
    // zwar im Code vorhanden und für den Bedienenden trotzdem weg.
    const zapfstelle = klasseFuer('water_point');
    expect(zapfstelle?.name).not.toBe('Trinkwasser');
    expect(zapfstelle?.name).toContain('Frischwasser');
  });
});

describe('die Rangfolge, wenn Symbole übereinanderliegen', () => {
  it('Frischwasser und Entsorgung stehen vorn — weil es davon wenige gibt', () => {
    // Nicht weil sie wichtiger wären als eine Tankstelle (Rang 3), sondern
    // weil man eine verdeckte Tankstelle zwei Straßen weiter wiederfindet
    // und eine verdeckte Entsorgungsstation nicht.
    expect(klasseFuer('sanitary_dump_station')?.rang).toBeLessThan(3);
    expect(klasseFuer('water_point')?.rang).toBeLessThan(3);
  });

  it('Müll und Dusche stehen hinten — sie sind Bequemlichkeit', () => {
    expect(klasseFuer('waste_disposal')?.rang).toBeGreaterThan(8);
    expect(klasseFuer('shower')?.rang).toBeGreaterThan(8);
  });

  it('kein Rang kommt doppelt vor', () => {
    // Bei Gleichstand entschiede die Reihenfolge im Array, und die ist keine
    // Aussage. Zwei Symbole an derselben Stelle wären dann mal so und mal so
    // sichtbar.
    const raenge = FEHLENDE_KLASSEN.map((k) => k.rang);
    expect(new Set(raenge).size).toBe(raenge.length);
  });

  it('alle Ränge liegen im Zahlenraum von `poiKategorien.ts` (1 bis 9)', () => {
    // Beide Ebenen liegen auf derselben Karte. Ein eigener Zahlenraum wäre
    // bequemer zu pflegen und trotzdem falsch — ein Rang hat nur dann eine
    // Bedeutung, wenn er mit dem der Nachbarebene vergleichbar ist.
    for (const k of FEHLENDE_KLASSEN) {
      expect(k.rang, `${k.kategorie} liegt ausserhalb`).toBeGreaterThan(0);
      expect(k.rang, `${k.kategorie} liegt ausserhalb`).toBeLessThan(10);
    }
  });
});

describe('die Suchbegriffe', () => {
  /** Die Begriffe, unter denen eine Kategorie gefunden wird. */
  function begriffeVon(wert: string): string[] {
    for (const liste of Object.values(POI_CATEGORIES)) {
      const treffer = liste.find((c) => c.value === wert);
      if (treffer) return [treffer.label.toLowerCase(), ...treffer.terms];
    }
    return [];
  }

  it('wer „frischwasser" tippt, findet die Zapfstelle', () => {
    expect(begriffeVon('water_point')).toContain('frischwasser');
  });

  it('wer „duschen" tippt, findet die Dusche', () => {
    // Die gebeugte Form gehört dazu: niemand tippt den Infinitiv eines
    // Substantivs, aber „duschen" tippt jeder.
    expect(begriffeVon('shower')).toContain('duschen');
  });

  it('jede der vier Kategorien hat überhaupt Suchbegriffe', () => {
    // Ein Eintrag ohne Begriffe ist nur über seinen Namen zu finden -- und
    // den kennt, wer sucht, meistens gerade nicht.
    for (const kategorie of FEHLENDE_KATEGORIEN) {
      expect(begriffeVon(kategorie).length, `${kategorie} hat keine Suchbegriffe`).toBeGreaterThan(
        1,
      );
    }
  });
});
