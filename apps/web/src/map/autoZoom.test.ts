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
  SPEED_ZOOM_STEPS,
} from './autoZoom.js';

describe('woran sich die Stufe bemisst', () => {
  it('ein naher Abbiegepunkt gewinnt gegen die Geschwindigkeit', () => {
    // Kurz vor der Kreuzung nuetzt die Uebersicht nichts -- man muss die
    // Spur sehen. Auch bei Autobahntempo.
    expect(autoZoomFor({ speedKmh: 130, distanceToManeuverM: 100 })).toBe(MANEUVER_ZOOM);
  });

  it('genau an der Grenze zaehlt der Abbiegepunkt noch als nah', () => {
    expect(autoZoomFor({ speedKmh: 130, distanceToManeuverM: MANEUVER_CLOSE_M })).toBe(
      MANEUVER_ZOOM,
    );
    // Einen Meter weiter entscheidet wieder das Tempo.
    expect(autoZoomFor({ speedKmh: 130, distanceToManeuverM: MANEUVER_CLOSE_M + 1 })).toBe(14);
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
