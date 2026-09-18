/**
 * Unit tests for profile validation and assessment logic (E06-T2).
 */

import { describe, it, expect } from 'vitest';
import {
  validateProfile,
  assessSuspiciousProfile,
  shouldShowHeightDisclaimer,
  RANGES,
  nachkommastellen,
} from './validation.js';

describe('validateProfile', () => {
  it('should accept a valid profile', () => {
    const result = validateProfile({
      name: 'Test Camper',
      height_m: 2.5,
      width_m: 2.0,
      length_m: 6.0,
      weight_t: 3.0,
      avg_speed_kmh: 80,
      avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
      hazmat: false,
    });
    expect(result.isValid).toBe(true);
    expect(result.fieldErrors).toHaveLength(0);
  });

  it('should reject a profile with empty name', () => {
    const result = validateProfile({
      name: '',
      height_m: 2.5,
    });
    expect(result.isValid).toBe(false);
    expect(result.fieldErrors).toContainEqual(expect.objectContaining({ field: 'name' }));
  });

  it('should reject height_m below minimum', () => {
    const result = validateProfile({
      name: 'Test',
      height_m: 0.5,
    });
    expect(result.isValid).toBe(false);
    expect(result.fieldErrors).toContainEqual(
      expect.objectContaining({ field: 'height_m' }),
    );
  });

  it('should reject height_m above maximum', () => {
    const result = validateProfile({
      name: 'Test',
      height_m: 5.0,
    });
    expect(result.isValid).toBe(false);
    expect(result.fieldErrors).toContainEqual(
      expect.objectContaining({ field: 'height_m' }),
    );
  });

  it('should accept height_m at boundary values', () => {
    const minResult = validateProfile({
      name: 'Test Min',
      height_m: RANGES.height_m.min,
    });
    expect(minResult.fieldErrors.filter((e) => e.field === 'height_m')).toHaveLength(0);

    const maxResult = validateProfile({
      name: 'Test Max',
      height_m: RANGES.height_m.max,
    });
    expect(maxResult.fieldErrors.filter((e) => e.field === 'height_m')).toHaveLength(0);
  });

  it('should reject weight_t below minimum', () => {
    const result = validateProfile({
      name: 'Test',
      weight_t: 0.5,
    });
    expect(result.isValid).toBe(false);
    expect(result.fieldErrors).toContainEqual(
      expect.objectContaining({ field: 'weight_t' }),
    );
  });

  it('should accept weight_t at boundary values', () => {
    const minResult = validateProfile({
      name: 'Test Min',
      weight_t: RANGES.weight_t.min,
    });
    expect(minResult.fieldErrors.filter((e) => e.field === 'weight_t')).toHaveLength(0);
  });

  it('should reject length_m outside range', () => {
    const result = validateProfile({
      name: 'Test',
      length_m: 25.0,
    });
    expect(result.isValid).toBe(false);
    expect(result.fieldErrors).toContainEqual(
      expect.objectContaining({ field: 'length_m' }),
    );
  });
});

describe('assessSuspiciousProfile', () => {
  it('should warn when height < 1.8 m AND weight > 3.0 t (car-like profile)', () => {
    const assessment = assessSuspiciousProfile({
      height_m: 1.7,
      weight_t: 3.1,
    });
    expect(assessment.warnings.length).toBeGreaterThan(0);
    expect(assessment.warnings[0]).toContain('Ungewöhnliche Kombination');
  });

  it('should not warn at the exact boundary (height < 1.8)', () => {
    const assessment = assessSuspiciousProfile({
      height_m: 1.8,
      weight_t: 3.1,
    });
    expect(assessment.warnings).toHaveLength(0);
  });

  it('should not warn at the exact boundary (weight <= 3.0)', () => {
    const assessment = assessSuspiciousProfile({
      height_m: 1.7,
      weight_t: 3.0,
    });
    expect(assessment.warnings).toHaveLength(0);
  });

  it('should not warn for a normal camper profile (3.0 m height, 3.5 t weight)', () => {
    const assessment = assessSuspiciousProfile({
      height_m: 3.0,
      weight_t: 3.5,
    });
    expect(assessment.warnings).toHaveLength(0);
  });

  it('should not warn when height < 1.8 but weight <= 3.0', () => {
    const assessment = assessSuspiciousProfile({
      height_m: 1.7,
      weight_t: 2.9,
    });
    expect(assessment.warnings).toHaveLength(0);
  });

  it('should not warn when height >= 1.8 even with high weight', () => {
    const assessment = assessSuspiciousProfile({
      height_m: 1.9,
      weight_t: 5.0,
    });
    expect(assessment.warnings).toHaveLength(0);
  });

  it('should return empty warnings for missing dimensions', () => {
    const assessment = assessSuspiciousProfile({});
    expect(assessment.warnings).toHaveLength(0);
  });

  it('should handle both dimensions being specified', () => {
    const assessment1 = assessSuspiciousProfile({
      height_m: 1.79,
      weight_t: 3.01,
    });
    expect(assessment1.warnings.length).toBeGreaterThan(0);

    const assessment2 = assessSuspiciousProfile({
      height_m: 1.8,
      weight_t: 3.01,
    });
    expect(assessment2.warnings).toHaveLength(0);
  });
});

describe('shouldShowHeightDisclaimer', () => {
  it('should show disclaimer when height_m > 2.7', () => {
    expect(shouldShowHeightDisclaimer({ height_m: 2.71 })).toBe(true);
    expect(shouldShowHeightDisclaimer({ height_m: 3.0 })).toBe(true);
    expect(shouldShowHeightDisclaimer({ height_m: 4.5 })).toBe(true);
  });

  it('should not show disclaimer when height_m <= 2.7', () => {
    expect(shouldShowHeightDisclaimer({ height_m: 2.7 })).toBe(false);
    expect(shouldShowHeightDisclaimer({ height_m: 2.69 })).toBe(false);
    expect(shouldShowHeightDisclaimer({ height_m: 1.5 })).toBe(false);
  });

  it('should not show disclaimer when height_m is missing', () => {
    expect(shouldShowHeightDisclaimer({})).toBe(false);
  });
});

/**
 * ─── DIE FEINHEIT DES GEWICHTS ──────────────────────────────────────────────
 * Gemeldet: „Mein Womo wiegt 3,49to. Was man nur durch die schieberegler nicht
 * einstellen kann. […] die Regler gehen in 10er Schritten."
 *
 * Das ist nicht nur unbequem. Bei 3,5 t liegt die Grenze, an der sich die
 * zulässigen Höchstgeschwindigkeiten ändern. Mit 0,1er-Schritten wählt jemand
 * mit 3,55 t naheliegend 3,5 — und bekommt die Grenzen der LEICHTEREN Klasse.
 */
describe('das Gewicht lässt sich fein genug einstellen', () => {
  it('geht in Schritten von zehn Kilogramm', () => {
    // 0,01 t ist die Feinheit, in der ein Fahrzeugschein die zulässige
    // Gesamtmasse ausweist.
    expect(RANGES.weight_t.step).toBe(0.01);
  });

  it('ein Wert wie 3,49 t liegt auf einem Schritt', () => {
    // Die eigentliche Beschwerde: mit 0,1 lag er zwischen zwei Rasten, und
    // der Browser wies ihn auch im Zahlenfeld ab.
    const schritte = (3.49 - RANGES.weight_t.min) / RANGES.weight_t.step;
    expect(Math.abs(schritte - Math.round(schritte))).toBeLessThan(1e-6);
  });

  it('auch 3,55 t liegt auf einem Schritt — der gefährliche Fall', () => {
    // Mit 0,1er-Schritten gab es hier nur 3,5 (zu leicht eingestuft) oder
    // 3,6 (zu schwer). Die erste Wahl ist die naheliegende und die
    // gefährliche: sie erlaubt zu viel.
    const schritte = (3.55 - RANGES.weight_t.min) / RANGES.weight_t.step;
    expect(Math.abs(schritte - Math.round(schritte))).toBeLessThan(1e-6);
  });

  it('so fein wie Höhe, Breite und Länge', () => {
    // Die drei waren immer schon auf 0,01. Dass ausgerechnet das Gewicht
    // gröber war, war keine Entscheidung, sondern ein Versehen.
    expect(RANGES.weight_t.step).toBe(RANGES.height_m.step);
  });
});

/**
 * ─── WIE VIELE STELLEN ANGEZEIGT WERDEN ─────────────────────────────────────
 * Das Zahlenfeld rundete fest auf zwei Stellen. Bei der
 * Durchschnittsgeschwindigkeit (Schritt 1) stand damit „80.00" da — eine
 * Genauigkeit, die die Zahl nicht hat.
 */
describe('nachkommastellen', () => {
  it('folgt der Schrittweite', () => {
    expect(nachkommastellen(0.01)).toBe(2);
    expect(nachkommastellen(0.1)).toBe(1);
    expect(nachkommastellen(1)).toBe(0);
  });

  it('jedes Feld zeigt so viele Stellen, wie es einstellen kann', () => {
    // Die Gegenprobe zur festen Zwei: ein Feld, das nur ganze km/h kann,
    // darf keine Hundertstel behaupten.
    expect(nachkommastellen(RANGES.avg_speed_kmh.step)).toBe(0);
    expect(nachkommastellen(RANGES.weight_t.step)).toBe(2);
  });

  it('kommt mit unsinnigen Schrittweiten aus, statt zu werfen', () => {
    expect(nachkommastellen(0)).toBe(0);
    expect(nachkommastellen(Number.NaN)).toBe(0);
    expect(nachkommastellen(-1)).toBe(0);
    // ─── DIESER FALL IST DER EINZIGE, DER DIE ABSICHERUNG PRÜFT ────────────
    // Die drei oben kommen auch OHNE sie auf 0 heraus: „0", „NaN" und „-1"
    // haben schlicht keinen Punkt. Eine Mutation, die `if (!Number.isFinite
    // …) return 0;` streicht, überlebte sie deshalb alle drei.
    //
    // Erst ein negativer BRUCH unterscheidet: ohne die Absicherung zählt die
    // Funktion die Stellen von „-0.5" und meldet 1.
    expect(nachkommastellen(-0.5)).toBe(0);
  });
});
