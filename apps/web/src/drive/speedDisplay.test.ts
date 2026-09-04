/**
 * Die Tachoanzeige.
 *
 * Gewünscht: „Ich hätte gerne überhaupt eine Anzeige der Geschwindigkeit."
 * `Position.speed` ist Meter pro Sekunde über Grund — eine falsche Umrechnung
 * fiele im Fahrzeug erst auf, wenn man auf den Tacho daneben schaut.
 */
import { describe, it, expect } from 'vitest';
import { displayedSpeedKmh, speedKmhFromMetersPerSecond, STANDSTILL_KMH } from './speedDisplay';

describe('speedKmhFromMetersPerSecond', () => {
  it('rechnet m/s in km/h um', () => {
    expect(speedKmhFromMetersPerSecond(0)).toBe(0);
    // 13,89 m/s sind 50 km/h -- die Zahl, die auf jedem Ortsschild steht.
    expect(speedKmhFromMetersPerSecond(13.89)).toBe(50);
    expect(speedKmhFromMetersPerSecond(27.78)).toBe(100);
  });

  it('zeigt nichts, wenn die Quelle keine Geschwindigkeit liefert', () => {
    expect(speedKmhFromMetersPerSecond(null)).toBeNull();
    expect(speedKmhFromMetersPerSecond(undefined)).toBeNull();
    expect(speedKmhFromMetersPerSecond(Number.NaN)).toBeNull();
  });

  /** Eine negative Geschwindigkeit gibt es nicht; sie kaeme aus einer kaputten
   *  Quelle und darf nicht auf dem Tacho landen. */
  it('verwirft negative Werte', () => {
    expect(speedKmhFromMetersPerSecond(-5)).toBeNull();
  });
});

describe('displayedSpeedKmh', () => {
  /** Eine Anzeige, die beim Halten verschwindet und beim Anfahren
   *  zurueckspringt, wirkt kaputt. */
  it('zeigt beim Stillstand 0 statt zu verschwinden', () => {
    expect(displayedSpeedKmh(0)).toBe(0);
    expect(displayedSpeedKmh(0.2)).toBe(0);
    expect(STANDSTILL_KMH).toBeGreaterThan(0);
  });

  it('verschwindet nur, wenn es gar keine Geschwindigkeit gibt', () => {
    expect(displayedSpeedKmh(null)).toBeNull();
  });

  it('zeigt Fahrgeschwindigkeit unveraendert', () => {
    expect(displayedSpeedKmh(13.89)).toBe(50);
  });
});
