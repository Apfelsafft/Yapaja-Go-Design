/**
 * `?poiAus=` — einzelne Sonderziel-Kategorien abschalten.
 *
 * ─── DIE DREI FEHLER, DIE HIER ABGEFANGEN WERDEN ────────────────────────────
 * Alle drei sind lautlos. Keiner davon lässt eine Anfrage fehlschlagen; sie
 * zeigen nur mehr oder weniger Symbole als gewollt, und das fällt auf einer
 * Karte mit hunderten Punkten niemandem auf:
 *
 *  1. Der Filter greift gar nicht, weil `?poi=` fehlt. Das war der erste
 *     Entwurf: `applyStyleOptions` rief den POI-Umbau nur `if (options.poi)`
 *     auf. Wer die Dichte nie angefasst hat — also fast jeder — hätte seine
 *     abgeschalteten Kategorien weiterhin gesehen.
 *
 *  2. Der Filter greift zu viel, weil `full` als Vorgabe eingesetzt wird.
 *     `yapaja-contrast` bringt seine reduzierte POI-Auswahl selbst mit. Ein
 *     eingesetztes `full` hätte die gelöscht: wer eine Kategorie abschaltet,
 *     bekäme insgesamt MEHR Symbole als vorher.
 *
 *  3. Der Filter trifft etwas anderes als das Symbol. Deshalb prüft er
 *     gegen `symbolNachKategorie()` und nicht gegen eine eigene Klassenliste
 *     — dieselbe Funktion, die auch `icon-image` bestimmt.
 */

import { describe, it, expect } from 'vitest';
import { POI_LAYER_ID_PREFIX, REDUCED_POI_CLASSES } from './constants.js';
import { applyStyleOptions, parseStyleOptions } from './options.js';
import { symbolNachKategorie } from '@yapaia/shared';
import type { MapStyleDocument, StyleLayer, SymbolLayer } from './types.js';

const POI_LAYER_ID = `${POI_LAYER_ID_PREFIX}alle`;

function stil(poiLayer: Partial<StyleLayer> = {}): MapStyleDocument {
  return {
    version: 8,
    sources: {},
    layers: [
      { id: 'hintergrund', type: 'background', layout: {}, paint: {} },
      {
        id: POI_LAYER_ID,
        type: 'symbol',
        source: 'omt',
        layout: { 'text-field': ['get', 'name'] },
        ...poiLayer,
      },
    ],
  } as MapStyleDocument;
}

/**
 * Die POI-Ebene, eingegrenzt auf `SymbolLayer`.
 *
 * ─── WARUM DIE EINGRENZUNG SEIN MUSS ────────────────────────────────────────
 * `StyleLayer` ist eine Vereinigung, und `BackgroundLayer` -- ein Glied davon
 * -- hat weder `filter` noch `layout`. Ohne diese Zusicherung uebersetzt die
 * Datei nicht.
 *
 * Als `as` waere das eine Behauptung ins Blaue. Die Pruefung auf `type` ist
 * dieselbe Frage, nur beantwortet statt behauptet -- und sie faellt LAUT aus,
 * wenn die POI-Ebene eines Tages keine Symbolebene mehr ist.
 */
function poiEbene(dok: MapStyleDocument): SymbolLayer {
  const ebene: StyleLayer | undefined = dok.layers.find((l) => l.id === POI_LAYER_ID);
  if (!ebene) throw new Error('POI-Ebene verschwunden');
  if (ebene.type !== 'symbol') throw new Error(`POI-Ebene ist ${ebene.type}, keine Symbolebene`);
  return ebene;
}

describe('parseStyleOptions liest `poiAus`', () => {
  it('nimmt bekannte Schlüssel', () => {
    expect(parseStyleOptions({ poiAus: 'poi-tanken,poi-dusche' }).poiAus).toEqual([
      'poi-tanken',
      'poi-dusche',
    ]);
  });

  it('lässt `poiAus` ungesetzt, wenn nichts Gültiges übrig bleibt', () => {
    // Nicht `[]`, sondern gar nicht gesetzt: eine leere Liste ist dasselbe
    // wie „nicht mitgeschickt", und sie trotzdem zu setzen hiesse, den Stil
    // ohne Not umzuschreiben.
    expect(parseStyleOptions({ poiAus: '' }).poiAus).toBeUndefined();
    expect(parseStyleOptions({ poiAus: 'quatsch' }).poiAus).toBeUndefined();
    expect(parseStyleOptions({}).poiAus).toBeUndefined();
  });

  it('stürzt an einer kaputten Anfrage nicht ab', () => {
    expect(() => parseStyleOptions({ poiAus: 42 })).not.toThrow();
    expect(parseStyleOptions({ poiAus: 42 }).poiAus).toBeUndefined();
  });
});

describe('`poiAus` wirkt auch ohne `poi`', () => {
  it('setzt den Filter, obwohl keine Dichte gewählt wurde', () => {
    // ─── FEHLER 1 ────────────────────────────────────────────────────────
    // Der eigentliche Alltagsfall: niemand fasst die POI-Dichte an.
    const ergebnis = applyStyleOptions(stil(), { poiAus: ['poi-tanken'] });
    expect(poiEbene(ergebnis).filter).toEqual([
      '!',
      ['in', symbolNachKategorie(), ['literal', ['poi-tanken']]],
    ]);
  });

  it('lässt einen mitgelieferten Filter stehen, statt ihn zu ersetzen', () => {
    // ─── FEHLER 2 ────────────────────────────────────────────────────────
    // `yapaja-contrast` bringt eine eigene Vorauswahl mit. Ohne `?poi=` darf
    // die nicht verschwinden -- sonst schaltet ein Schalter, der Symbole
    // WEGNEHMEN soll, in Summe welche DAZU.
    const eigen: unknown[] = ['in', ['get', 'class'], ['literal', ['fuel']]];
    const ergebnis = applyStyleOptions(stil({ filter: eigen }), { poiAus: ['poi-tanken'] });
    expect(poiEbene(ergebnis).filter).toEqual([
      'all',
      eigen,
      ['!', ['in', symbolNachKategorie(), ['literal', ['poi-tanken']]]],
    ]);
  });

  it('lässt die Sichtbarkeit unangetastet, solange keine Dichte gewählt ist', () => {
    const ergebnis = applyStyleOptions(stil({ layout: { visibility: 'none' } }), {
      poiAus: ['poi-tanken'],
    });
    expect(poiEbene(ergebnis).layout?.visibility).toBe('none');
  });

  it('rührt den Stil gar nicht an, wenn weder `poi` noch `poiAus` gesetzt sind', () => {
    const eingang = stil({ filter: ['in', ['get', 'class'], ['literal', ['fuel']]] });
    const ergebnis = applyStyleOptions(eingang, {});
    expect(poiEbene(ergebnis)).toEqual(poiEbene(eingang));
  });
});

describe('`poiAus` zusammen mit der Dichte', () => {
  it('`reduced` und abgeschaltete Kategorien greifen beide', () => {
    const ergebnis = applyStyleOptions(stil(), { poi: 'reduced', poiAus: ['poi-dusche'] });
    expect(poiEbene(ergebnis).filter).toEqual([
      'all',
      ['in', ['get', 'class'], ['literal', REDUCED_POI_CLASSES]],
      ['!', ['in', symbolNachKategorie(), ['literal', ['poi-dusche']]]],
    ]);
  });

  it('`full` behält nur den Kategorie-Filter', () => {
    const ergebnis = applyStyleOptions(stil({ filter: ['irgendwas'] }), {
      poi: 'full',
      poiAus: ['poi-dusche'],
    });
    // Der mitgelieferte Filter ist WEG -- das ist bei ausdrücklichem `full`
    // richtig und der Unterschied zum Fall ohne `poi` oben.
    expect(poiEbene(ergebnis).filter).toEqual([
      '!',
      ['in', symbolNachKategorie(), ['literal', ['poi-dusche']]],
    ]);
  });

  it('`off` blendet aus und braucht dann keinen Filter mehr', () => {
    const ergebnis = applyStyleOptions(stil(), { poi: 'off', poiAus: ['poi-dusche'] });
    expect(poiEbene(ergebnis).layout?.visibility).toBe('none');
    expect(poiEbene(ergebnis).filter).toBeUndefined();
  });

  it('`full` ohne abgeschaltete Kategorien setzt gar keinen Filter', () => {
    // Kein Filter ist etwas anderes als ein Filter, der alles durchlässt:
    // MapLibre muss ihn dann nicht je Punkt auswerten.
    const ergebnis = applyStyleOptions(stil({ filter: ['irgendwas'] }), { poi: 'full' });
    expect(poiEbene(ergebnis).filter).toBeUndefined();
    expect(poiEbene(ergebnis).layout?.visibility).toBe('visible');
  });
});

describe('der Filter erkennt die Kategorie so wie das Symbol', () => {
  it('benutzt `symbolNachKategorie()` und keine eigene Klassenliste', () => {
    // ─── FEHLER 3 ────────────────────────────────────────────────────────
    // Die Zusicherung, auf der alles steht: „was als Tankstelle gezeichnet
    // wird" und „was beim Abschalten von Tankstellen verschwindet" müssen
    // dieselbe Frage sein. Ein Filter über `class` wäre ähnlich und nicht
    // gleich -- der Stellplatz etwa hängt an `class` UND `subclass`.
    const ergebnis = applyStyleOptions(stil(), { poiAus: ['poi-wohnmobil'] });
    const filter = poiEbene(ergebnis).filter as unknown[];
    const drin = filter[1] as unknown[];
    expect(drin[1]).toEqual(symbolNachKategorie());
  });

  it('fasst Ebenen ohne POI-Präfix nicht an', () => {
    const ergebnis = applyStyleOptions(stil(), { poiAus: ['poi-tanken'] });
    const hintergrund = ergebnis.layers.find((l) => l.id === 'hintergrund');
    expect(hintergrund).toBeDefined();
    // Ueber `Record`, weil `BackgroundLayer` gar kein `filter` kennt -- die
    // Zusicherung lautet ja gerade, dass auch keines dazukommt.
    expect((hintergrund as unknown as Record<string, unknown>).filter).toBeUndefined();
  });
});
