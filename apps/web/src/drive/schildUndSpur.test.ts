/**
 * Schildertext und Spurführung — die Regeln, nicht die Verdrahtung.
 *
 * Was hier geprüft wird, sind ENTSCHEIDUNGEN: was zuerst kommt, was wegfällt,
 * wann überhaupt etwas erscheint. Die Verdrahtung ins Bauteil prüft
 * `apps/web/e2e/spurfuehrung.spec.ts` im echten Browser.
 */

import { describe, it, expect } from 'vitest';
import { SPUR } from '@yapaia/shared';
import { MAX_TEILE, schildAnzeige } from './schildText.js';
import { SPUREN_AB_M, pfeileAusMaske, spurAnzeige } from './spuren.js';

describe('schildAnzeige', () => {
  it('liest das Schild in der Reihenfolge, in der es dasteht', () => {
    // Erst die Straße, dann wohin sie führt — genau so steht es auf dem
    // blauen Schild, und wer vergleicht, sucht in derselben Reihenfolge.
    expect(
      schildAnzeige({
        exit_number: [{ text: '26' }],
        exit_branch: [{ text: 'A 61' }],
        exit_toward: [{ text: 'Ludwigshafen' }],
      }),
    ).toEqual({ nummer: '26', teile: ['A 61', 'Ludwigshafen'] });
  });

  it('nimmt bei mehreren Zielen das häufigste zuerst', () => {
    // ─── DER GRUND, WARUM `consecutive_count` MITGEFÜHRT WIRD ────────────
    // Valhalla liefert die Ziele in der Reihenfolge der OSM-Daten. Welches
    // das WICHTIGE ist, sagt allein, wie oft es auf der Schilderfolge
    // wiederholt wird. Das zählt genau dann, wenn gekürzt wird — und Kürzen
    // ist auf dieser Kachel der Normalfall.
    const raus = schildAnzeige({
      exit_toward: [
        { text: 'Speyer', consecutive_count: 1 },
        { text: 'Ludwigshafen', consecutive_count: 5 },
        { text: 'Mannheim', consecutive_count: 3 },
      ],
    });
    expect(raus?.teile).toEqual(['Ludwigshafen', 'Mannheim', 'Speyer']);
  });

  it('kürzt auf das, was auf die Kachel passt', () => {
    const raus = schildAnzeige({
      exit_branch: [{ text: 'A 61' }, { text: 'A 650' }],
      exit_toward: [{ text: 'Ludwigshafen' }, { text: 'Mannheim' }, { text: 'Speyer' }],
    });
    expect(raus?.teile).toHaveLength(MAX_TEILE);
    // Und zwar von vorn: die Straße geht nie zugunsten eines Ziels verloren.
    expect(raus?.teile[0]).toBe('A 61');
  });

  it('zeigt dieselbe Straße nicht zweimal', () => {
    // An manchen Kreuzen steht sie als `branch` UND als `toward`. Zweimal
    // dasselbe kostet genau den Platz, an dem sonst das zweite Ziel stünde.
    expect(
      schildAnzeige({
        exit_branch: [{ text: 'A 61' }],
        exit_toward: [{ text: 'A 61' }, { text: 'Koblenz' }],
      })?.teile,
    ).toEqual(['A 61', 'Koblenz']);
  });

  it('gibt `null`, wo es nichts zu zeigen gibt', () => {
    // Der Normalfall. Ein leeres Objekt wäre die Antwort „ja, ein leeres
    // Schild" auf die Frage „gibt es ein Schild".
    expect(schildAnzeige(null)).toBeNull();
    expect(schildAnzeige(undefined)).toBeNull();
    expect(schildAnzeige({})).toBeNull();
    expect(schildAnzeige({ exit_toward: [] })).toBeNull();
    expect(schildAnzeige({ exit_toward: [{ text: '   ' }] })).toBeNull();
  });

  it('zeigt eine Ausfahrtsnummer auch ohne Ziel', () => {
    // „Ausfahrt 26" allein ist eine vollständige Auskunft.
    expect(schildAnzeige({ exit_number: [{ text: '26' }] })).toEqual({
      nummer: '26',
      teile: [],
    });
  });

  it('stürzt an einer kaputten Form nicht ab', () => {
    expect(() => schildAnzeige({ exit_toward: 'kaputt' as never })).not.toThrow();
    expect(schildAnzeige({ exit_toward: 'kaputt' as never })).toBeNull();
  });
});

describe('pfeileAusMaske', () => {
  it('liest das Beispiel aus Valhallas Referenz', () => {
    // `10` = Links (8) + Geradeaus (2).
    expect(pfeileAusMaske(10)).toEqual(['turn_left', 'straight']);
  });

  it('stellt die Pfeile von links nach rechts', () => {
    // ─── WARUM DIE REIHENFOLGE ZÄHLT ─────────────────────────────────────
    // Ein Spurpfeil-Paar „links, geradeaus" muss so herum stehen, wie es auf
    // der Fahrbahn steht. Andersherum gelesen zeigte es in die falsche
    // Richtung.
    expect(pfeileAusMaske(SPUR.RECHTS | SPUR.LINKS | SPUR.GERADEAUS)).toEqual([
      'turn_left',
      'straight',
      'turn_right',
    ]);
  });

  it('fasst leicht/scharf zum selben Pfeil zusammen — aber nur einmal', () => {
    // Das Pfeil-Vokabular ist absichtlich grob (siehe `arrows.tsx`), genau
    // wie `maneuverMapping.ts` im Kern. Zweimal derselbe Pfeil in einer Spur
    // wäre kein Mehr an Auskunft, sondern ein doppeltes Bild.
    expect(pfeileAusMaske(SPUR.LINKS | SPUR.LEICHT_LINKS | SPUR.SCHARF_LINKS)).toEqual([
      'turn_left',
    ]);
  });

  it('erfindet keinen Pfeil, wo es keine Richtung gibt', () => {
    // `KEINE` (0) und `UNBESTIMMT` (1) tragen keine Richtung. Eine zu
    // zeichnen hiesse, eine zu behaupten.
    expect(pfeileAusMaske(SPUR.KEINE)).toEqual([]);
    expect(pfeileAusMaske(SPUR.UNBESTIMMT)).toEqual([]);
    expect(pfeileAusMaske(-1)).toEqual([]);
    expect(pfeileAusMaske(NaN)).toEqual([]);
  });
});

describe('spurAnzeige', () => {
  const zweiSpuren = [
    { directions: SPUR.LINKS, active: SPUR.LINKS },
    { directions: SPUR.LINKS | SPUR.GERADEAUS, valid: SPUR.LINKS },
  ];

  it('hebt NUR die aktive Spur hervor, nicht die brauchbare', () => {
    // ─── DIE UNTERSCHEIDUNG, AUF DIE ES ANKOMMT ──────────────────────────
    // `valid` heisst „kann man nehmen, muss aber evtl. noch wechseln".
    // `active` heisst „hier kommt man durch". Wer `valid` hervorhöbe,
    // schickte jemanden mit sieben Metern Fahrzeug auf eine Spur, von der
    // aus er sich kurz vor der Ausfahrt noch einmal einfädeln muss.
    const raus = spurAnzeige(zweiSpuren, 200);
    expect(raus).toHaveLength(2);
    expect(raus![0].aktiv).toBe(true);
    expect(raus![1].aktiv, 'nur `valid` -- das ist NICHT die richtige Spur').toBe(false);
  });

  it('erscheint erst, wenn man nah genug dran ist', () => {
    // Eine Spurangabe drei Kilometer im Voraus ist keine Hilfe, sondern
    // etwas, das dauernd im Bild steht und beim nächsten Mal übersehen wird.
    expect(spurAnzeige(zweiSpuren, SPUREN_AB_M + 1)).toBeNull();
    expect(spurAnzeige(zweiSpuren, SPUREN_AB_M)).not.toBeNull();
    expect(spurAnzeige(zweiSpuren, 0)).not.toBeNull();
  });

  it('gibt `null`, wo es keine Spurdaten gibt', () => {
    // Der Normalfall: Spurdaten hängen in OSM an `turn:lanes`, und wo die
    // fehlen, liefert Valhalla nichts. Eine leere Leiste hiesse „hier gibt
    // es Spuren, nämlich keine".
    expect(spurAnzeige(null, 100)).toBeNull();
    expect(spurAnzeige([], 100)).toBeNull();
    expect(spurAnzeige(zweiSpuren, null)).toBeNull();
  });

  it('wirft Spuren ohne Richtung weg', () => {
    expect(
      spurAnzeige([{ directions: SPUR.UNBESTIMMT }, { directions: SPUR.RECHTS }], 100),
    ).toEqual([{ pfeile: ['turn_right'], aktiv: false }]);
  });

  it('`active: 0` ist keine aktive Spur', () => {
    // Die Aussage „für keine Richtung ist dies die beste Spur" darf nicht
    // versehentlich zur Hervorhebung werden.
    expect(spurAnzeige([{ directions: SPUR.GERADEAUS, active: 0 }], 100)![0].aktiv).toBe(false);
  });
});
