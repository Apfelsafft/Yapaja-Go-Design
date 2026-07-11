/**
 * Unit tests for profile validation and assessment logic (E06-T2).
 */

import { describe, it, expect } from 'vitest';
import {
  validateProfile,
  assessSuspiciousProfile,
  shouldShowHeightDisclaimer,
  RANGES,
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
