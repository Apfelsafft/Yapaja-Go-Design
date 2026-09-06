/**
 * Automatischer Zoom -- die Regel.
 *
 * Gemeldet: „Füge bei der Navigation einen automatischen Zoom ein."
 *
 * Geprueft wird vor allem, wann er NICHT eingreift. Ein Zoom, der sich gegen
 * den Menschen stellt, ist schlimmer als gar keiner.
 */

import { describe, it, expect } from 'vitest';
import {
  autoZoomFor,
  shouldApplyZoom,
  MANEUVER_CLOSE_M,
  MANEUVER_ZOOM,
  MANEUVER_AT_M,
  MANEUVER_AT_ZOOM,
  SPEED_ZOOM_STEPS,
} from './autoZoom.js';

describe('woran sich die Stufe bemisst', () => {
  it('ein naher Abbiegepunkt gewinnt gegen die Geschwindigkeit', () => {
    // Kurz vor der Kreuzung nuetzt die Uebersicht nichts -- man muss die
    // Spur sehen. Auch bei Autobahntempo.
    expect(autoZoomFor({ speedKmh: 130, distanceToManeuverM: 200 })).toBe(MANEUVER_ZOOM);
  });

  it('genau an der Grenze zaehlt der Abbiegepunkt noch als nah', () => {
    expect(autoZoomFor({ speedKmh: 130, distanceToManeuverM: MANEUVER_CLOSE_M })).toBe(
      MANEUVER_ZOOM,
    );
    // Einen Meter weiter entscheidet wieder das Tempo.
    expect(autoZoomFor({ speedKmh: 130, distanceToManeuverM: MANEUVER_CLOSE_M + 1 })).toBe(14);
  });

  // ─── UNMITTELBAR VOR DEM ABBIEGEN NOCH EINE STUFE NAEHER ──────────────────
  // Gemeldet: „kurz vor der Abfahrt nach rechts bin ich noch recht weit
  // rausgezoomt." Stufe 17 griff dabei bereits (gemessen: 16,99 bei 222 m) --
  // sie ist nur zu weit weg.
  describe('unmittelbar vor dem Abbiegen', () => {
    it('gilt die engste Stufe', () => {
      expect(autoZoomFor({ speedKmh: 130, distanceToManeuverM: 100 })).toBe(MANEUVER_AT_ZOOM);
      expect(autoZoomFor({ speedKmh: 130, distanceToManeuverM: 0 })).toBe(MANEUVER_AT_ZOOM);
    });

    it('und sie ist wirklich naeher als die vorige', () => {
      // Sonst waere die ganze Stufe eine Verdopplung ohne Wirkung.
      expect(MANEUVER_AT_ZOOM).toBeGreaterThan(MANEUVER_ZOOM);
      expect(MANEUVER_AT_M).toBeLessThan(MANEUVER_CLOSE_M);
    });

    it('genau an ihrer Grenze noch, einen Meter weiter nicht mehr', () => {
      expect(autoZoomFor({ speedKmh: 130, distanceToManeuverM: MANEUVER_AT_M })).toBe(
        MANEUVER_AT_ZOOM,
      );
      expect(autoZoomFor({ speedKmh: 130, distanceToManeuverM: MANEUVER_AT_M + 1 })).toBe(
        MANEUVER_ZOOM,
      );
    });

    it('die Stufen folgen aufeinander, statt sich zu ueberspringen', () => {
      // Von weit nach nah darf die Zahl nur wachsen -- ein Zurueckspringen
      // waere ein Herauszoomen beim Naeherkommen.
      const stufen = [400, 250, 200, 150, 100, 20].map((m) =>
        autoZoomFor({ speedKmh: 50, distanceToManeuverM: m }),
      );
      for (let i = 1; i < stufen.length; i++) {
        expect(stufen[i]!, `bei Schritt ${i}`).toBeGreaterThanOrEqual(stufen[i - 1]!);
      }
    });
  });

  it('sonst entscheidet die Geschwindigkeit, und zwar naeher bei langsam', () => {
    const langsam = autoZoomFor({ speedKmh: 20, distanceToManeuverM: null });
    const schnell = autoZoomFor({ speedKmh: 130, distanceToManeuverM: null });
    expect(langsam).not.toBeNull();
    expect(schnell).not.toBeNull();
    // Groessere Zahl = naeher dran.
    expect(langsam!).toBeGreaterThan(schnell!);
  });

  it('jede Stufe liefert ihren Wert', () => {
    for (const step of SPEED_ZOOM_STEPS) {
      const probe = Number.isFinite(step.upToKmh) ? step.upToKmh : 200;
      expect(autoZoomFor({ speedKmh: probe, distanceToManeuverM: null })).toBe(step.zoom);
    }
  });

  it('Stillstand ist die naechste Stufe, nicht „keine Angabe"', () => {
    expect(autoZoomFor({ speedKmh: 0, distanceToManeuverM: null })).toBe(SPEED_ZOOM_STEPS[0].zoom);
  });
});

describe('wann NICHTS getan wird', () => {
  it('ohne Geschwindigkeit und ohne Abbiegepunkt', () => {
    // `null` heisst „nichts tun", nicht „Standardwert nehmen". Ein
    // Vorgabewert waere eine Kamerabewegung, die niemand angefordert hat.
    expect(autoZoomFor({ speedKmh: null, distanceToManeuverM: null })).toBeNull();
    expect(autoZoomFor({ speedKmh: undefined, distanceToManeuverM: undefined })).toBeNull();
  });

  it('bei unbrauchbaren Werten', () => {
    expect(autoZoomFor({ speedKmh: Number.NaN, distanceToManeuverM: null })).toBeNull();
    expect(autoZoomFor({ speedKmh: -5, distanceToManeuverM: null })).toBeNull();
  });

  it('eine unbrauchbare Entfernung faellt auf die Geschwindigkeit zurueck', () => {
    // Nicht auf `null`: das Tempo ist ja bekannt und eine gueltige Grundlage.
    //
    // Absichtlich mit 130 km/h geprueft und nicht mit 20: die langsamste
    // Stufe liefert zufaellig denselben Wert wie MANEUVER_ZOOM, ein Test mit
    // 20 km/h koennte also gar nicht fehlschlagen, wenn die Pruefung auf
    // negative Entfernungen wegfiele.
    const ohneAbbiegepunkt = autoZoomFor({ speedKmh: 130, distanceToManeuverM: null });
    expect(ohneAbbiegepunkt).not.toBe(MANEUVER_ZOOM);
    expect(autoZoomFor({ speedKmh: 130, distanceToManeuverM: Number.NaN })).toBe(ohneAbbiegepunkt);
    expect(autoZoomFor({ speedKmh: 130, distanceToManeuverM: -10 })).toBe(ohneAbbiegepunkt);
  });
});

describe('wann die Kamera wirklich bewegt wird', () => {
  it('nicht wegen einer winzigen Abweichung', () => {
    // Ohne diese Pruefung setzte JEDE Positionsmeldung die Kamera neu -- der
    // Unterschied zwischen „passt sich an" und „zappelt".
    expect(shouldApplyZoom(16.1, 16)).toBe(false);
    expect(shouldApplyZoom(16, 16)).toBe(false);
  });

  it('aber bei einem echten Stufenwechsel', () => {
    expect(shouldApplyZoom(14, 17)).toBe(true);
    expect(shouldApplyZoom(17, 14)).toBe(true);
  });

  it('und wenn der aktuelle Zoom unbekannt ist', () => {
    expect(shouldApplyZoom(null, 16)).toBe(true);
    expect(shouldApplyZoom(Number.NaN, 16)).toBe(true);
  });
});
