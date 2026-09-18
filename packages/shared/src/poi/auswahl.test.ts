/**
 * Die Schalter für die einzelnen Sonderziele.
 *
 * ─── WAS HIER GEPRÜFT WIRD UND WAS NICHT ────────────────────────────────────
 * NICHT die Namen der dreizehn Kategorien — die stehen in `kategorien.ts`
 * und `fehlendeKlassen.ts` und haben dort ihre eigenen Prüfungen. Diese
 * Datei prüft die drei Eigenschaften, ohne die die Schalter still falsch
 * wären:
 *
 *  1. dass wirklich JEDE Kategorie einen bekommt,
 *  2. dass ein unbekannter Schlüssel nichts verbirgt,
 *  3. dass derselbe Zustand immer denselben Parameter ergibt.
 */

import { describe, it, expect } from 'vitest';
import {
  POI_AUSWAHL,
  POI_SCHLUESSEL,
  alsPoiParameter,
  istBekannterPoi,
  nichtAbgeschaltet,
  parseAbgeschaltet,
} from './auswahl';
import { POI_KATEGORIEN } from './kategorien';
import { FEHLENDE_KLASSEN } from './fehlendeKlassen';

describe('der Katalog ist abgeleitet, nicht abgeschrieben', () => {
  it('enthält jede Kachel-Kategorie', () => {
    // Die eigentliche Zusicherung dieser Änderung: wer in `kategorien.ts`
    // etwas hinzufügt, bekommt den Schalter, ohne daran zu denken. Eine
    // vergessene Kategorie wäre ein Symbol, das man nicht loswird.
    for (const k of POI_KATEGORIEN) {
      const eintrag = POI_AUSWAHL.find((e) => e.schluessel === k.symbol);
      expect(eintrag, `${k.symbol} hat keinen Schalter`).toBeDefined();
      expect(eintrag?.name).toBe(k.name);
      expect(eintrag?.quelle).toBe('kachel');
    }
  });

  it('enthält jede Index-Kategorie', () => {
    for (const k of FEHLENDE_KLASSEN) {
      const eintrag = POI_AUSWAHL.find((e) => e.schluessel === k.symbol);
      expect(eintrag, `${k.symbol} hat keinen Schalter`).toBeDefined();
      expect(eintrag?.name).toBe(k.name);
      expect(eintrag?.quelle).toBe('index');
    }
  });

  it('enthält nichts darüber hinaus', () => {
    // Die Gegenrichtung. Ohne sie könnte ein Schlüssel im Katalog stehen,
    // den keine Ebene je zeichnet — ein Schalter, der nachweislich nichts
    // tut, und der nicht von einem kaputten zu unterscheiden wäre.
    expect(POI_AUSWAHL).toHaveLength(POI_KATEGORIEN.length + FEHLENDE_KLASSEN.length);
  });

  it('kein Schlüssel kommt doppelt vor', () => {
    // Beide Listen tragen Sprite-Namen, und der Sprite-Name IST der
    // Schlüssel. Kollidierten zwei, schaltete ein Klick zwei Kategorien
    // gleichzeitig ab.
    expect(new Set(POI_SCHLUESSEL).size).toBe(POI_SCHLUESSEL.length);
  });

  it('steht in der Reihenfolge der Karte, nicht im Alphabet', () => {
    const raenge = POI_AUSWAHL.map((e) => e.rang);
    expect(raenge).toEqual([...raenge].sort((a, b) => a - b));
    // Die Probe aufs Exempel: der Stellplatz ist Rang 1 und steht vorn.
    // Sortierte man alphabetisch, stünde „Campingplatz" davor.
    expect(POI_AUSWAHL[0]?.schluessel).toBe('poi-wohnmobil');
  });

  it('mischt beide Quellen ineinander, statt sie zu blocken', () => {
    // ─── WAS DIESE SORTIERUNG WIRKLICH ENTSCHEIDET ──────────────────────
    // Die Ränge der Index-Kategorien sind mit Absicht Zwischenwerte (2,5,
    // 2,6, 8,5, 8,6) und setzen die Reihe der Kachel-Kategorien fort. Wären
    // die zwei Quellen getrennt aufgelistet -- erst neun, dann vier --,
    // stünde „Entsorgungsstation" unter „Wasser und Entsorgung", obwohl sie
    // auf der Karte davor gewinnt.
    //
    // Ohne diese Prüfung bliebe die Liste auch dann sortiert, wenn jemand
    // einfach beide Arrays hintereinanderhängte: nach Quelle geordnet ist
    // sie ja ebenfalls „irgendwie" geordnet.
    const quellen = POI_AUSWAHL.map((e) => e.quelle);
    const wechsel = quellen.filter((q, i) => i > 0 && q !== quellen[i - 1]).length;
    expect(wechsel, 'die beiden Quellen stehen in Blöcken statt nach Rang').toBeGreaterThan(1);

    // Namentlich, damit auch die Richtung stimmt: die Entsorgungsstation
    // (Index, 2,5) steht VOR der Tankstelle (Kachel, 3).
    const stelle = (s: string): number => POI_AUSWAHL.findIndex((e) => e.schluessel === s);
    expect(stelle('poi-entsorgung')).toBeLessThan(stelle('poi-tanken'));
    expect(stelle('poi-muell')).toBeLessThan(stelle('poi-versorgung'));
  });
});

describe('parseAbgeschaltet', () => {
  it('nimmt, was es gibt', () => {
    expect(parseAbgeschaltet('poi-tanken,poi-dusche')).toEqual(['poi-tanken', 'poi-dusche']);
  });

  it('wirft weg, was es nicht gibt', () => {
    // Die sichere Richtung: ein Schlüssel, den niemand kennt, darf keine
    // Kategorie verbergen. Er verschwindet, und das Symbol ist da.
    expect(parseAbgeschaltet('poi-tanken,poi-gibtsnicht')).toEqual(['poi-tanken']);
    expect(parseAbgeschaltet('quatsch')).toEqual([]);
  });

  it('kommt mit leer, Leerzeichen und `null` klar', () => {
    // Das kommt so aus einer URL und aus einem fremden localStorage.
    expect(parseAbgeschaltet('')).toEqual([]);
    expect(parseAbgeschaltet(null)).toEqual([]);
    expect(parseAbgeschaltet(undefined)).toEqual([]);
    expect(parseAbgeschaltet(' poi-tanken , poi-dusche ')).toEqual(['poi-tanken', 'poi-dusche']);
    expect(parseAbgeschaltet(',,,')).toEqual([]);
  });

  it('wirft Doppelte weg', () => {
    // Sonst wüchse die gespeicherte Einstellung bei jedem Klick, und der
    // Parameter mit ihr.
    expect(parseAbgeschaltet('poi-tanken,poi-tanken')).toEqual(['poi-tanken']);
  });

  it('ordnet immer gleich — egal in welcher Reihenfolge geklickt wurde', () => {
    // ─── WARUM DAS MEHR IST ALS SCHÖNHEIT ───────────────────────────────
    // `poiAus` geht in den Stil-Schlüssel und in die Stil-Adresse ein. Wäre
    // die Reihenfolge die der Klicks, ergäbe DERSELBE Zustand zwei
    // verschiedene Adressen — der Browser hielte zwei Fassungen derselben
    // Karte vor, und der Vergleich in `MapView` fände einen Unterschied, wo
    // keiner ist.
    const a = parseAbgeschaltet('poi-dusche,poi-tanken');
    const b = parseAbgeschaltet('poi-tanken,poi-dusche');
    expect(a).toEqual(b);
  });
});

describe('alsPoiParameter', () => {
  it('macht aus der Liste wieder einen Parameterwert', () => {
    expect(alsPoiParameter(['poi-tanken', 'poi-dusche'])).toBe('poi-tanken,poi-dusche');
  });

  it('ergibt bei nichts Abgeschaltetem die leere Zeichenkette', () => {
    // Der Aufrufer prüft darauf, um den Parameter ganz wegzulassen. Käme
    // hier etwas Wahrheitsgemäßes wie `','` heraus, stünde in jeder
    // Stil-Adresse ein leeres `poiAus=`.
    expect(alsPoiParameter([])).toBe('');
    expect(alsPoiParameter(['gibtsnicht'])).toBe('');
  });

  it('ist zu `parseAbgeschaltet` rund', () => {
    const roh = 'poi-dusche,poi-tanken,poi-dusche';
    expect(parseAbgeschaltet(alsPoiParameter(parseAbgeschaltet(roh)))).toEqual(
      parseAbgeschaltet(roh),
    );
  });
});

describe('nichtAbgeschaltet', () => {
  it('gibt `null`, wenn nichts abgeschaltet ist', () => {
    // Kein Filter ist etwas anderes als ein Filter, der alles durchlässt --
    // MapLibre muss ihn dann gar nicht erst je Punkt auswerten.
    expect(nichtAbgeschaltet(['get', 'symbol'], [])).toBeNull();
    expect(nichtAbgeschaltet(['get', 'symbol'], ['gibtsnicht'])).toBeNull();
  });

  it('baut die Verneinung um den übergebenen Ausdruck', () => {
    expect(nichtAbgeschaltet(['get', 'symbol'], ['poi-tanken'])).toEqual([
      '!',
      ['in', ['get', 'symbol'], ['literal', ['poi-tanken']]],
    ]);
  });

  it('nimmt jeden Ausdruck als Kategorie-Quelle', () => {
    // ─── DER GRUND, WARUM DER AUSDRUCK VON AUSSEN KOMMT ─────────────────
    // Die Kachelebene rechnet ihre Kategorie mit `symbolNachKategorie()`
    // aus, die Indexebene liest sie mit `['get', 'symbol']`. Beide sollen
    // DENSELBEN Filterbau benutzen, sonst driften die zwei Ebenen
    // auseinander -- und ein abgeschaltetes „Frischwasser" verschwände auf
    // der einen und bliebe auf der anderen.
    const gerechnet = ['case', ['==', ['get', 'class'], 'fuel'], 'poi-tanken', ''];
    expect(nichtAbgeschaltet(gerechnet, ['poi-tanken'])).toEqual([
      '!',
      ['in', gerechnet, ['literal', ['poi-tanken']]],
    ]);
  });
});

describe('istBekannterPoi', () => {
  it('kennt die echten und nur die echten', () => {
    expect(istBekannterPoi('poi-wohnmobil')).toBe(true);
    expect(istBekannterPoi('poi-dusche')).toBe(true);
    expect(istBekannterPoi('poi-gibtsnicht')).toBe(false);
    expect(istBekannterPoi('')).toBe(false);
  });
});
