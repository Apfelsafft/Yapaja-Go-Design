/**
 * Die Autobahnen einer Route erkennen.
 *
 * ─── WAS HIER GEPRÜFT WIRD UND WAS NICHT ────────────────────────────────────
 * Geprüft wird, dass JEDE plausible Schreibweise gelesen wird. NICHT geprüft
 * ist, welche davon Valhalla tatsächlich liefert — dafür bräuchte es einen
 * Graphen mit deutschen Daten, und den gibt es in dieser Entwicklungsumgebung
 * nicht.
 *
 * Das ist ausdrücklich eine Lücke und keine Nachlässigkeit. Sie ist dadurch
 * abgefedert, dass alle Formen gelesen werden statt einer geratenen — und
 * dadurch, dass die Oberfläche anzeigt, was sie erkannt hat. Bleibt die Liste
 * leer, obwohl die Route über die A61 führt, sieht man es sofort.
 */

import { describe, it, expect } from 'vitest';
import { autobahnenAusRoute } from './autobahnenAusRoute';

describe('autobahnenAusRoute — die Schreibweisen', () => {
  it('liest „A61" ohne Leerzeichen', () => {
    expect(autobahnenAusRoute([{ street_names: ['A61'] }])).toEqual(['A61']);
  });

  it('liest „A 61" MIT Leerzeichen — so steht es in OpenStreetMap', () => {
    expect(autobahnenAusRoute([{ street_names: ['A 61'] }])).toEqual(['A61']);
  });

  it('liest „A-61" mit Bindestrich', () => {
    expect(autobahnenAusRoute([{ street_names: ['A-61'] }])).toEqual(['A61']);
  });

  it('liest mehrere Nummern aus EINEM Eintrag', () => {
    // OSM trennt mehrere `ref`-Werte mit Semikolon: `A 61;A 6`.
    expect(autobahnenAusRoute([{ street_names: ['A 61;A 6'] }])).toEqual(['A6', 'A61']);
  });

  it('kümmert sich nicht um Groß- und Kleinschreibung', () => {
    expect(autobahnenAusRoute([{ street_names: ['a61'] }])).toEqual(['A61']);
  });

  it('zieht führende Nullen zusammen', () => {
    // „A 061" und „A61" sind dieselbe Autobahn. Zwei Einträge daraus zu
    // machen hiesse, dieselbe Straße zweimal nach draußen abzufragen.
    expect(autobahnenAusRoute([{ street_names: ['A 061', 'A61'] }])).toEqual(['A61']);
  });

  it('liest die Nummer auch aus der Ansage', () => {
    // Bei Auffahrten heißt der Weg selbst oft nur „Auffahrt" — die Autobahn
    // steht dann allein im Satz.
    expect(
      autobahnenAusRoute([{ street_names: ['Auffahrt'], instruction: 'Auffahrt auf A 61' }]),
    ).toEqual(['A61']);
  });
});

describe('autobahnenAusRoute — was NICHT mitkommt', () => {
  it('Bundesstraßen bleiben draußen', () => {
    // Die Schnittstelle der Autobahn GmbH führt ausschließlich
    // Bundesautobahnen. Eine Anfrage nach „B9" ginge als LEERE LISTE zurück —
    // ununterscheidbar von „auf der B9 ist nichts los".
    expect(autobahnenAusRoute([{ street_names: ['B9', 'B 27'] }])).toEqual([]);
  });

  it('gewöhnliche Straßennamen ergeben nichts', () => {
    expect(
      autobahnenAusRoute([{ street_names: ['Hauptstraße', 'Am Hofgarten', 'Zeiskamer Schneise'] }]),
    ).toEqual([]);
  });

  it('ein „A" ohne Nummer zählt nicht', () => {
    expect(autobahnenAusRoute([{ street_names: ['Ahornweg', 'A', 'Alte Poststraße'] }])).toEqual([]);
  });

  it('„A0" gibt es nicht', () => {
    expect(autobahnenAusRoute([{ street_names: ['A0', 'A 00'] }])).toEqual([]);
  });

  it('eine Zahl mitten im Wort zählt nicht', () => {
    // Die Wortgrenze im Muster hält „Bundesstraße A61-Zubringer" vom
    // Falschen ab, aber „Gebäude A612" ebenso.
    expect(autobahnenAusRoute([{ street_names: ['Halle 7A61'] }])).toEqual([]);
  });
});

describe('autobahnenAusRoute — die Liste selbst', () => {
  it('entdoppelt über die ganze Route', () => {
    // Eine Autobahn taucht in Dutzenden Manövern auf. Sie mehrfach
    // abzufragen wäre eine Salve nach draußen.
    expect(
      autobahnenAusRoute([
        { street_names: ['A61'] },
        { street_names: ['A61'] },
        { street_names: ['A 61'] },
      ]),
    ).toEqual(['A61']);
  });

  it('sortiert nach ZAHL, nicht alphabetisch', () => {
    // Sonst stünde A10 vor A3. Diese Liste wird dem Betreiber gezeigt, und
    // sie soll lesbar sein.
    expect(
      autobahnenAusRoute([{ street_names: ['A10', 'A3', 'A61', 'A5'] }]),
    ).toEqual(['A3', 'A5', 'A10', 'A61']);
  });

  it('kommt mit einer leeren Route zurecht', () => {
    expect(autobahnenAusRoute([])).toEqual([]);
  });

  it('kommt ohne street_names zurecht', () => {
    expect(autobahnenAusRoute([{}, { instruction: 'Geradeaus fahren' }])).toEqual([]);
  });

  it('verträgt Unsinn in der Liste, statt zu stürzen', () => {
    // `street_names` kommt aus einer Antwort. Was dort steht, ist nicht
    // meine Entscheidung.
    const kaputt = [{ street_names: [null, 42, undefined, 'A61'] as unknown as string[] }];
    expect(autobahnenAusRoute(kaputt)).toEqual(['A61']);
  });

  it('der globale Ausdruck verhakt sich nicht zwischen zwei Texten', () => {
    // Ein regulärer Ausdruck mit `g` merkt sich seine Position. Ohne
    // Zurücksetzen fände der zweite Text erst ab der Stelle des ersten
    // Treffers etwas — und die Hälfte der Route fiele lautlos heraus.
    expect(
      autobahnenAusRoute([
        { street_names: ['irgendein sehr langer Straßenname mit A61 darin'] },
        { street_names: ['A3'] },
      ]),
    ).toEqual(['A3', 'A61']);
  });
});
