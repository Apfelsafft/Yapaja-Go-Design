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
  EDGE_INSET_PX,
  STACK_GAP_PX,
  rightStackBottomPx,
  rightStackRects,
  TOP_RIGHT_INSET_PX,
  TOP_BAR_HEIGHT_PX,
  MANEUVER_PANEL_TOP_PX,
  TOP_BAR_RIGHT_RESERVE_PX,
  SPEED_LIMIT_SIGN_SIZE_PX,
} from './mapControlLayout.js';

describe('die rechte Spalte stapelt ohne Ueberschneidung', () => {
  for (const driveActive of [false, true]) {
    it(`kein Platz ueberlappt einen anderen (Fahrt: ${driveActive})`, () => {
      const rects = rightStackRects(driveActive);
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

    it(`zwischen den Plaetzen liegt echte Luft (Fahrt: ${driveActive})`, () => {
      // Buendig aneinander waere rechnerisch ueberschneidungsfrei, aber mit
      // dem Finger nicht mehr zu treffen.
      const sorted = [...rightStackRects(driveActive)].sort((a, b) => a.bottom - b.bottom);
      for (let i = 1; i < sorted.length; i += 1) {
        expect(sorted[i].bottom - sorted[i - 1].top).toBeGreaterThanOrEqual(STACK_GAP_PX);
      }
    });
  }

  it('der unterste Platz haelt Abstand zum Bildschirmrand', () => {
    expect(rightStackBottomPx('viewmode', false)).toBe(EDGE_INSET_PX);
    expect(rightStackBottomPx('drive-controls', true)).toBe(EDGE_INSET_PX);
  });

  it('waehrend der Fahrt liegen die Karten-Knoepfe UEBER der Fahrt-Bedienung', () => {
    // Der gemeldete Fehler: „wenn die Navigation aktiv ist, liegen die neuen
    // Buttons über der Zentrierung." Die Ansagen-Taste stand auf `bottom-24`
    // und schnitt damit Zentrierung und Ansichtsmodus.
    const tts = rightStackBottomPx('tts', true);
    expect(rightStackBottomPx('viewmode', true)).toBeGreaterThan(tts);
    expect(rightStackBottomPx('compass', true)).toBeGreaterThan(
      rightStackBottomPx('viewmode', true),
    );
    expect(rightStackBottomPx('recenter', true)).toBeGreaterThan(
      rightStackBottomPx('compass', true),
    );
  });

  it('ohne Fahrt ruecken die Knoepfe nach unten', () => {
    // Sonst klaffte dort eine Luecke, wo waehrend der Fahrt die Bedienung ist.
    expect(rightStackBottomPx('viewmode', false)).toBeLessThan(
      rightStackBottomPx('viewmode', true),
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
