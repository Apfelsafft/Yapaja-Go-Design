import { describe, expect, it } from 'vitest';
import { kategorieAusKachel, ortAusMerkmal } from './ortAusMerkmal.js';

const P = { lat: 47.1, lon: 9.5 };

describe('ortAusMerkmal', () => {
  it('Kachel-POI: Stellplatz wird nach der Unterklasse erkannt', () => {
    const o = ortAusMerkmal({ name: 'Stellplatz Rhein', class: 'campsite', subclass: 'caravan_site' }, P);
    expect(o).toMatchObject({ name: 'Stellplatz Rhein', kategorie: 'Wohnmobilstellplatz', symbol: 'poi-wohnmobil' });
  });

  it('Kachel-POI: Campingplatz ohne Unterklasse', () => {
    expect(kategorieAusKachel('campsite', null)?.name).toBe('Campingplatz');
  });

  it('unbekannte Klasse ergibt keine Kategorie, der Name bleibt', () => {
    const o = ortAusMerkmal({ name: 'Imbiss', class: 'fast_food_xyz' }, P);
    expect(o).toMatchObject({ name: 'Imbiss', kategorie: null });
  });

  it('Sonderziel aus dem Suchindex: Bezeichnung, Symbol und Adresse', () => {
    const o = ortAusMerkmal(
      { name: 'Entsorgung', bezeichnung: 'Entsorgungsstation', symbol: 'poi-entsorgung', adresse: 'Hauptstr. 1', ort: 'Vaduz' },
      P,
    );
    expect(o).toMatchObject({ kategorie: 'Entsorgungsstation', symbol: 'poi-entsorgung', adresse: 'Hauptstr. 1, Vaduz' });
  });

  it('Sprachvariante des Namens hat Vorrang', () => {
    expect(ortAusMerkmal({ name: 'Vaduz', 'name:en': 'Vaduz EN' }, P, 'en')?.name).toBe('Vaduz EN');
  });

  it('ohne Name und Kategorie keine Karte', () => {
    expect(ortAusMerkmal({ class: 'nichts' }, P)).toBeNull();
    expect(ortAusMerkmal(null, P)).toBeNull();
  });
});
