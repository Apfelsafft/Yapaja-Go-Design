/**
 * Die Kategorie-Schalter im Zustandsspeicher.
 *
 * ─── WARUM NEBEN `styleStore.test.ts` ───────────────────────────────────────
 * Weil dort die Frage „ändert ein Setzer nur sein eigenes Feld" geprüft wird
 * — über die Optionen hinweg und deshalb grün, egal was in `poiAus` steht.
 *
 * Hier stehen die Eigenschaften, die nur diese eine Einstellung hat: dass
 * ein Klick eine Kategorie umlegt und keine zweite, dass die Reihenfolge der
 * Klicks nicht durchschlägt, und dass ein alter gespeicherter Zustand in die
 * Richtung repariert wird, in der nichts verborgen bleibt.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { POI_AUSWAHL } from '@yapaia/shared';
import { useStyleStore, normalizeStoredOptions } from './styleStore';
import { DEFAULT_STYLE_ID, DEFAULT_STYLE_OPTIONS } from '../map/styleClient';

const aus = (): string[] => useStyleStore.getState().options.poiAus;

describe('einzelne Kategorien schalten', () => {
  beforeEach(() => {
    useStyleStore.setState({ styleId: DEFAULT_STYLE_ID, options: DEFAULT_STYLE_OPTIONS });
  });

  it('beginnt mit allem an', () => {
    // Die Vorgabe ist „nichts abgeschaltet". Eine Karte, die nach der
    // Installation Symbole verschweigt, wäre nicht zu erklären.
    expect(aus()).toEqual([]);
  });

  it('schaltet eine Kategorie ab und wieder an', () => {
    useStyleStore.getState().setPoiKategorie('poi-tanken', false);
    expect(aus()).toEqual(['poi-tanken']);

    useStyleStore.getState().setPoiKategorie('poi-tanken', true);
    expect(aus()).toEqual([]);
  });

  it('lässt die übrigen Kategorien dabei in Ruhe', () => {
    useStyleStore.getState().setPoiKategorie('poi-tanken', false);
    useStyleStore.getState().setPoiKategorie('poi-dusche', false);
    useStyleStore.getState().setPoiKategorie('poi-tanken', true);
    expect(aus()).toEqual(['poi-dusche']);
  });

  it('hängt dieselbe Kategorie nicht zweimal an', () => {
    // Zwei Klicks auf „aus" -- etwa weil der erste nicht durchkam. Ohne die
    // Entdopplung wüchse die gespeicherte Einstellung bei jedem Klick.
    useStyleStore.getState().setPoiKategorie('poi-tanken', false);
    useStyleStore.getState().setPoiKategorie('poi-tanken', false);
    expect(aus()).toEqual(['poi-tanken']);
  });

  it('ordnet unabhängig von der Klickreihenfolge', () => {
    // ─── WAS DARAN HÄNGT ────────────────────────────────────────────────
    // `poiAus` geht in den Stil-Schlüssel in `MapView` und in die
    // Stil-Adresse ein. Wäre die Reihenfolge die der Klicks, ergäbe
    // DERSELBE Zustand zwei verschiedene Adressen -- ein zweiter Abruf und
    // ein zweiter Eintrag im Zwischenspeicher für dieselbe Karte.
    useStyleStore.getState().setPoiKategorie('poi-dusche', false);
    useStyleStore.getState().setPoiKategorie('poi-tanken', false);
    const einWeg = [...aus()];

    useStyleStore.setState({ options: DEFAULT_STYLE_OPTIONS });
    useStyleStore.getState().setPoiKategorie('poi-tanken', false);
    useStyleStore.getState().setPoiKategorie('poi-dusche', false);

    expect(aus()).toEqual(einWeg);
  });

  it('ignoriert einen Schlüssel, den es nicht gibt', () => {
    // Die sichere Richtung: was nicht im Katalog steht, kann keine Kategorie
    // verbergen.
    useStyleStore.getState().setPoiKategorie('poi-gibtsnicht', false);
    expect(aus()).toEqual([]);
  });

  it('`Alle aus` schaltet wirklich jede ab, `Alle an` jede wieder ein', () => {
    useStyleStore.getState().setPoiAus(POI_AUSWAHL.map((e) => e.schluessel));
    expect(aus()).toHaveLength(POI_AUSWAHL.length);

    useStyleStore.getState().setPoiAus([]);
    expect(aus()).toEqual([]);
  });
});

describe('was aus dem Browser-Speicher zurückkommt', () => {
  it('wirft Kategorien weg, die es nicht mehr gibt', () => {
    // Nicht, um aufzuräumen, sondern wegen der Richtung: ein unbekannter
    // Schlüssel, der liegen bliebe, stünde für immer im Filter, ohne dass
    // ihm noch ein Schalter entspräche. Die Kategorie wäre unerreichbar
    // abgeschaltet.
    expect(
      normalizeStoredOptions({ poiAus: ['poi-tanken', 'poi-von-frueher'] }).poiAus,
    ).toEqual(['poi-tanken']);
  });

  it('stürzt an allem ab, was in einem localStorage stehen kann', () => {
    // Ein Absturz beim Einlesen der Einstellungen heisst: gar keine Karte.
    expect(normalizeStoredOptions({ poiAus: null as never }).poiAus).toEqual([]);
    expect(normalizeStoredOptions({ poiAus: 'poi-tanken' as never }).poiAus).toEqual([]);
    expect(normalizeStoredOptions({ poiAus: 42 as never }).poiAus).toEqual([]);
    expect(normalizeStoredOptions({ poiAus: [1, 2] as never }).poiAus).toEqual([]);
    expect(normalizeStoredOptions({}).poiAus).toEqual([]);
  });

  it('ein Zustand von vor 0.17.0 heisst „alles an", nicht „alles aus"', () => {
    // Der Fall, den jeder bestehende Betreiber beim Update durchläuft: im
    // Speicher liegt eine Optionsmenge ganz ohne `poiAus`. Sie als „alles
    // abgeschaltet" zu lesen wäre eine leere Karte nach dem Update.
    expect(normalizeStoredOptions({ lang: 'name_de', labelScale: '1.0', poi: 'full' }).poiAus).toEqual(
      [],
    );
  });
});
