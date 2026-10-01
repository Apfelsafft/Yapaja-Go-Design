import { describe, it, expect } from 'vitest';
import { labelGroesse } from './labelGroesse';

describe('labelGroesse', () => {
  it('lässt die beiden alten Stufen unverändert', () => {
    // Gespeicherte Einstellungen und der Zwischenspeicher hängen daran.
    expect(labelGroesse('1.0')).toBe('1.0');
    expect(labelGroesse('1.2')).toBe('1.2');
  });

  it('nimmt den ganzen Bereich von 80 % bis 200 %', () => {
    expect(labelGroesse('0.8')).toBe('0.8');
    expect(labelGroesse(1.5)).toBe('1.5');
    expect(labelGroesse('2.0')).toBe('2.0');
  });

  it('setzt Werte außerhalb an den Rand', () => {
    expect(labelGroesse('0.5')).toBe('0.8');
    expect(labelGroesse('2.5')).toBe('2.0');
  });

  it('rastet auf 10-Prozent-Schritte ein', () => {
    // Sonst ergäbe jede Fingerbewegung eine eigene Stil-Adresse.
    expect(labelGroesse('1.23')).toBe('1.2');
    expect(labelGroesse('1.27')).toBe('1.3');
  });

  it('verwirft, was keine Zahl ist', () => {
    expect(labelGroesse('gross')).toBeNull();
    expect(labelGroesse('')).toBeNull();
    expect(labelGroesse(undefined)).toBeNull();
  });
});
