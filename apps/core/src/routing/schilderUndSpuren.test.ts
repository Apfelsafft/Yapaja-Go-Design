/**
 * Schildertexte und Spurführung — von Valhalla bis in die Route.
 *
 * ─── WOFÜR ──────────────────────────────────────────────────────────────────
 * Gewünscht nach einer Probefahrt:
 *
 *   „Was mir bei Maps noch gefällt ist die Anzeige was auf den Schildern auf
 *    der Straße steht wenn man abbiegt. Und auch welche Spur man wählen
 *    sollte."
 *
 * ─── DIE ZAHLEN UND NAMEN SIND NACHGELESEN ──────────────────────────────────
 * Jedes Beispiel unten stammt aus Valhallas API-Referenz (`docs/api/route/
 * api-reference.md`), nicht aus der Erinnerung. Das ist hier besonders
 * wichtig, weil die alte `LaneInfo` in `@yapaia/shared` ein Platzhalter war
 * (`lane_index`, `is_usable`), der mit Valhallas tatsächlicher Antwort nichts
 * gemein hatte — und der zugehörige Test war trotzdem grün, weil er den
 * Platzhalter gegen sich selbst prüfte.
 */

import { describe, it, expect } from 'vitest';
import { spreizeSchild, spreizeSpuren } from './mapResponse.js';

describe('spreizeSchild', () => {
  it('bildet alle vier Listen ab und lässt die Endung weg', () => {
    expect(
      spreizeSchild({
        exit_number_elements: [{ text: '26' }],
        exit_branch_elements: [{ text: 'A 61', consecutive_count: 2 }],
        exit_toward_elements: [{ text: 'Ludwigshafen' }, { text: 'Mannheim' }],
        exit_name_elements: [{ text: 'Kreuz Mutterstadt' }],
      }),
    ).toEqual({
      sign: {
        exit_number: [{ text: '26' }],
        exit_branch: [{ text: 'A 61', consecutive_count: 2 }],
        exit_toward: [{ text: 'Ludwigshafen' }, { text: 'Mannheim' }],
        exit_name: [{ text: 'Kreuz Mutterstadt' }],
      },
    });
  });

  it('lässt `consecutive_count` weg, wo Valhalla ihn weglässt', () => {
    // Die Referenz sagt ausdrücklich „This item is optional." — ein
    // ausdrückliches `undefined` wäre ein Feld, und `maneuverSignElement`
    // verbietet unbekannte Felder nicht, aber ein `undefined` im JSON ist
    // etwas anderes als ein fehlendes.
    const raus = spreizeSchild({ exit_toward_elements: [{ text: 'Mainz' }] });
    expect('consecutive_count' in raus.sign!.exit_toward![0]).toBe(false);
  });

  it('gibt GAR KEIN `sign`, wenn alle Listen leer sind', () => {
    // ─── DER FALL, DER EINE LEERE TAFEL GEZEICHNET HÄTTE ─────────────────
    // Valhalla schickt an manchen Manövern einen `sign`-Block, in dem alle
    // vier Listen leer sind. Unverändert durchgereicht ergäbe das ein
    // `sign: {}` — ein Feld, das „es gibt Schilder" behauptet, während
    // nichts darauf steht.
    expect(spreizeSchild({ exit_toward_elements: [], exit_branch_elements: [] })).toEqual({});
  });

  it('gibt gar kein `sign` ohne Block', () => {
    // Der Normalfall: Schilder gibt es fast nur an Kreuzen und Abfahrten.
    expect(spreizeSchild(undefined)).toEqual({});
  });

  it('wirft Einträge ohne Aufschrift weg', () => {
    // Ein Schild ohne Text ist in der Anzeige ein leeres Feld — sichtbar,
    // aber ohne Auskunft.
    expect(
      spreizeSchild({
        exit_toward_elements: [
          { text: '' },
          { text: 'Speyer' },
          { consecutive_count: 1 } as never,
        ],
      }),
    ).toEqual({ sign: { exit_toward: [{ text: 'Speyer' }] } });
  });

  it('stürzt an einer kaputten Antwort nicht ab', () => {
    // Valhalla ist ein fremder Dienst. Eine unerwartete Form darf
    // höchstens das Schild kosten, nie die Route.
    expect(() => spreizeSchild({ exit_toward_elements: 'kaputt' as never })).not.toThrow();
    expect(spreizeSchild({ exit_toward_elements: 'kaputt' as never })).toEqual({});
    expect(spreizeSchild(null as never)).toEqual({});
  });
});

describe('spreizeSpuren', () => {
  it('bildet das Beispiel aus Valhallas Referenz ab', () => {
    // Wörtlich von dort: zwei Spuren, die erste nur links (8) und die
    // bevorzugte, die zweite links oder geradeaus (8|2 = 10), aber nur für
    // links brauchbar.
    expect(
      spreizeSpuren([
        { directions: 8, active: 8 },
        { directions: 10, valid: 8 },
      ]),
    ).toEqual({
      lanes: [
        { directions: 8, active: 8 },
        { directions: 10, valid: 8 },
      ],
    });
  });

  it('lässt `valid` und `active` weg, wo Valhalla sie weglässt', () => {
    const raus = spreizeSpuren([{ directions: 2 }]);
    expect('valid' in raus.lanes![0]).toBe(false);
    expect('active' in raus.lanes![0]).toBe(false);
  });

  it('unterscheidet `active: 0` von „fehlt"', () => {
    // ─── WARUM DAS ZÄHLT ─────────────────────────────────────────────────
    // `0` ist eine Aussage: „für keine Richtung ist dies die beste Spur".
    // Ein fehlendes Feld ist keine. Würde `0` wie „fehlt" behandelt (etwa
    // durch ein `if (l.active)`), verlöre die Anzeige genau die Auskunft,
    // dass diese Spur die falsche ist.
    const raus = spreizeSpuren([{ directions: 10, active: 0 }]);
    expect(raus.lanes![0].active).toBe(0);
    expect('active' in raus.lanes![0]).toBe(true);
  });

  it('gibt gar kein `lanes` ohne Spuren', () => {
    // Eine leere Spurliste hiesse „hier gibt es Spuren, nämlich keine".
    expect(spreizeSpuren(undefined)).toEqual({});
    expect(spreizeSpuren([])).toEqual({});
  });

  it('wirft Spuren ohne `directions` weg', () => {
    // Eine Spur ohne jede Richtung wäre in der Anzeige ein leerer Kasten,
    // der so aussieht, als fehle etwas.
    expect(spreizeSpuren([{ valid: 8 } as never, { directions: 64 }])).toEqual({
      lanes: [{ directions: 64 }],
    });
  });

  it('stürzt an einer kaputten Antwort nicht ab', () => {
    expect(() => spreizeSpuren('kaputt' as never)).not.toThrow();
    expect(spreizeSpuren('kaputt' as never)).toEqual({});
    expect(spreizeSpuren([null as never])).toEqual({});
  });
});
