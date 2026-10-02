import { describe, expect, it } from 'vitest';
import { glaetten, verstehe } from './verstehen.js';

describe('verstehe -- die gewünschten Beispielsätze', () => {
  it('„Bitte fahre mich zur Ziolkowski Straße nach Magdeburg"', () => {
    expect(verstehe('Bitte fahre mich zur Ziolkowski Straße nach Magdeburg')).toEqual({
      art: 'ziel',
      ort: 'ziolkowski straße magdeburg',
    });
  });
  it('„Yapaia, wo ist die nächste Tankstelle?"', () => {
    expect(verstehe('Yapaia, wo ist die nächste Tankstelle?')).toEqual({ art: 'naechste', kategorie: 'fuel' });
  });
  it('„Stoppe Navigation"', () => {
    expect(verstehe('Stoppe Navigation')).toEqual({ art: 'stopp' });
    expect(verstehe('Navigation beenden')).toEqual({ art: 'stopp' });
  });
  it('„Lies mir die nächste Verkehrsinfo auf der Route vor"', () => {
    expect(verstehe('Lies mir die nächste Verkehrsinfo auf der Route vor')).toEqual({ art: 'verkehr', anzahl: 1 });
    expect(verstehe('Lies mir alle Baustellen vor')).toEqual({ art: 'verkehr', anzahl: 3 });
  });
});

describe('verstehe -- weitere Sätze', () => {
  it.each([
    ['navigiere nach Speyer', { art: 'ziel', ort: 'speyer' }],
    ['Yapaja bring uns zum Campingplatz am See', { art: 'ziel', ort: 'campingplatz am see' }],
    ['fahr mich zur nächsten Entsorgung', { art: 'naechste', kategorie: 'sanitary_dump_station' }],
    ['wir brauchen Diesel', { art: 'naechste', kategorie: 'fuel' }],
    ['wo können wir übernachten in der Nähe', { art: 'naechste', kategorie: 'caravan_site' }],
    ['Pause', { art: 'pause' }],
    ['weiterfahren', { art: 'weiter' }],
    ['wie lange noch', { art: 'ankunft' }],
    ['wann sind wir da', { art: 'ankunft' }],
    ['Ansagen aus', { art: 'ansagen', an: false }],
    ['ja', { art: 'ja' }],
    ['los', { art: 'ja' }],
    ['nein', { art: 'nein' }],
    ['die zweite', { art: 'wahl', nummer: 2 }],
    ['nummer 3', { art: 'wahl', nummer: 3 }],
    ['finde den nächsten Aldi', { art: 'naechste_name', name: 'aldi' }],
    ['Yapaia, wo ist der nächste Lidl?', { art: 'naechste_name', name: 'lidl' }],
    ['fahr mich zum nächsten Bauhaus', { art: 'naechste_name', name: 'bauhaus' }],
    ['wo ist hier ein Edeka', { art: 'naechste_name', name: 'edeka' }],
    ['nächster Aldi Süd in der Nähe', { art: 'naechste_name', name: 'aldi süd' }],
    ['fahr zu Aldi', { art: 'ziel', ort: 'aldi' }],
  ])('%s', (satz, erwartet) => {
    expect(verstehe(satz)).toEqual(erwartet);
  });

  it('Unverstandenes bleibt unverstanden, statt zu raten', () => {
    expect(verstehe('wie wird das Wetter morgen').art).toBe('unbekannt');
  });

  it('glätten entfernt Anrede, Füllwörter und Satzzeichen', () => {
    expect(glaetten('Hey Yapaia, kannst du bitte mal...')).toBe('');
  });
});
