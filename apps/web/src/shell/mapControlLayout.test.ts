/**
 * Die rechte Knopfspalte -- rechnerisch.
 *
 * ─── WAS DIESER TEST ABDECKT, DEN DER BROWSER-TEST NICHT KANN ───────────────
 * `e2e/control-overlap.spec.ts` misst die echten Kaesten und ist damit der
 * staerkere Nachweis. Er sieht den KOMPASS aber nie: der erscheint nur bei
 * gedrehter Karte, und der Ansichtsmodus `2d-north` sperrt die Drehung auf 0.
 *
 * Hier wird deshalb die Spalte vollstaendig durchgerechnet -- mit denselben
 * Werten, die auch die Komponenten lesen. Beides zusammen: der Browser prueft,
 * dass die Werte richtig ANKOMMEN, dieser Test, dass sie in sich stimmen.
 */

import { describe, it, expect } from 'vitest';
import {
  ATTRIBUTION_RESERVE_PX,
  FAVORITES_BAR_HEIGHT_PX,
  TRIP_BAR_HEIGHT_PX,
  STACK_GAP_PX,
  bottomInsetPx,
  favoritesDrawerBottomPx,
  tripInfoBottomPx,
  rightStackBottomPx,
  rightStackRects,
  TOP_RIGHT_INSET_PX,
  TOP_BAR_HEIGHT_PX,
  MANEUVER_PANEL_TOP_PX,
  TOP_BAR_RIGHT_RESERVE_PX,
  SPEED_LIMIT_SIGN_SIZE_PX,
} from './mapControlLayout.js';

describe('die rechte Spalte stapelt ohne Ueberschneidung', () => {
  for (const { driveActive, schmal } of [
    { driveActive: false, schmal: false },
    { driveActive: true, schmal: false },
    { driveActive: false, schmal: true },
    { driveActive: true, schmal: true },
  ]) {
    it(`kein Platz ueberlappt einen anderen (Fahrt: ${driveActive}, schmal: ${schmal})`, () => {
      const rects = rightStackRects(driveActive, schmal);
      expect(rects.length).toBeGreaterThan(2);

      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i];
          const b = rects[j];
          const overlaps = a.bottom < b.top && b.bottom < a.top;
          expect(overlaps, `${a.slot} (${a.bottom}..${a.top}) <-> ${b.slot} (${b.bottom}..${b.top})`).toBe(
            false,
          );
        }
      }
    });

    it(`zwischen den Plaetzen liegt echte Luft (Fahrt: ${driveActive}, schmal: ${schmal})`, () => {
      // Buendig aneinander waere rechnerisch ueberschneidungsfrei, aber mit
      // dem Finger nicht mehr zu treffen.
      const sorted = [...rightStackRects(driveActive, schmal)].sort((a, b) => a.bottom - b.bottom);
      for (let i = 1; i < sorted.length; i += 1) {
        expect(sorted[i].bottom - sorted[i - 1].top).toBeGreaterThanOrEqual(STACK_GAP_PX);
      }
    });
  }

  it('der unterste Platz beginnt UEBER der Namensnennung', () => {
    // Frueher stand hier `toBe(EDGE_INSET_PX)` -- und genau das war der
    // Fehler: unten rechts gehoert der Streifen „© OpenStreetMap
    // contributors" (ODbL-Auflage, `docs/licenses.md` §1). Bei 16 lag die
    // Fahrt-Bedienung auf 1280 Bildpunkten vier Punkte darauf.
    //
    // `>=` statt `>`: buendig darueber ist erlaubt, die Namensnennung wird
    // nicht angetippt -- sie muss nur lesbar bleiben.
    for (const driveActive of [false, true]) {
      expect(rightStackBottomPx('viewmode', driveActive)).toBeGreaterThanOrEqual(ATTRIBUTION_RESERVE_PX);
      expect(rightStackBottomPx('viewmode', driveActive, true)).toBeGreaterThanOrEqual(
        ATTRIBUTION_RESERVE_PX,
      );
    }
  });

  it('auf schmalen Schirmen beginnt die Spalte waehrend der Fahrt ueber der Fahrtdaten-Leiste', () => {
    // Dort liegt die Leiste waehrend der Fahrt ganz unten ueber die volle
    // Breite -- die Spalte muss ueber ihr ansetzen.
    expect(rightStackBottomPx('viewmode', true, true)).toBeGreaterThanOrEqual(
      tripInfoBottomPx() + TRIP_BAR_HEIGHT_PX,
    );
  });

  it('die Karten-Knoepfe stapeln sich in fester Reihenfolge', () => {
    for (const driveActive of [false, true]) {
      expect(rightStackBottomPx('compass', driveActive)).toBeGreaterThan(
        rightStackBottomPx('viewmode', driveActive),
      );
      expect(rightStackBottomPx('recenter', driveActive)).toBeGreaterThan(
        rightStackBottomPx('compass', driveActive),
      );
    }
  });

  it('auf breiten Schirmen verschiebt die Fahrt die Spalte nicht mehr', () => {
    // Pause, Stopp und die Ansagen-Taste lagen bis 0.17.3 darunter und
    // hoben die Knoepfe waehrend der Fahrt an. Seit sie im Fahrtmenue
    // liegen, gibt es dafuer keinen Grund mehr -- ein Knopf, der beim
    // Losfahren den Platz wechselt, ist einer, den man sucht.
    expect(rightStackBottomPx('viewmode', true)).toBe(rightStackBottomPx('viewmode', false));
  });
});

describe('die Mitte unten', () => {
  it('die Fahrtdaten liegen ueber der Namensnennung', () => {
    expect(tripInfoBottomPx()).toBeGreaterThanOrEqual(ATTRIBUTION_RESERVE_PX);
  });

  it('die Schublade steht auf derselben Hoehe -- beide gibt es nie gleichzeitig', () => {
    // Waehrend der Fahrt ist die Schublade weg (Favoriten im Fahrtmenue),
    // ohne Fahrt gibt es keine Fahrtdaten.
    expect(favoritesDrawerBottomPx()).toBe(tripInfoBottomPx());
  });

  it('auf schmalen Schirmen beginnen die Seiten ueber dem, was unten in der Mitte liegt', () => {
    expect(bottomInsetPx(true, true)).toBeGreaterThanOrEqual(tripInfoBottomPx() + TRIP_BAR_HEIGHT_PX);
    expect(bottomInsetPx(true, false)).toBeGreaterThanOrEqual(
      favoritesDrawerBottomPx() + FAVORITES_BAR_HEIGHT_PX,
    );
  });
});

describe('der obere Rand', () => {
  it('laesst MapLibres Zoom-Gruppe frei', () => {
    // Gemessen: die Gruppe ist 29 breit und sitzt 10 vom Rand, belegt also
    // 10..39. Unsere Knoepfe standen auf 16 und lagen mitten darin.
    const MAPLIBRE_GROUP_RIGHT_EDGE_PX = 39;
    expect(TOP_RIGHT_INSET_PX).toBeGreaterThan(MAPLIBRE_GROUP_RIGHT_EDGE_PX);
  });

  it('die Abbiege-Anzeige beginnt UNTER der Suchzeile', () => {
    // Der gemeldete Fehler: „die nächste Abbiegung über der Suchzeile."
    // Sie stand auf 12, die TopBar ist 62 hoch.
    expect(MANEUVER_PANEL_TOP_PX).toBeGreaterThan(TOP_BAR_HEIGHT_PX);
  });

  it('die Suchzeile laesst Platz fuer das Tempolimit-Schild', () => {
    // Sonst laeuft sie darunter durch -- das war die letzte Ueberlappung,
    // die nach dem Verschieben des Schildes uebrig blieb.
    expect(TOP_BAR_RIGHT_RESERVE_PX).toBeGreaterThanOrEqual(
      TOP_RIGHT_INSET_PX + SPEED_LIMIT_SIGN_SIZE_PX,
    );
  });
});
