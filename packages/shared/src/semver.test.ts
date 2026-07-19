/**
 * Unit tests for the hand-rolled semver helpers (E09-T1). Covers the
 * subset of the range grammar `satisfies()` supports: exact, caret, tilde,
 * x-ranges, plus `isValidSemver`/`isValidRange`/`compareVersions`.
 */

import { describe, it, expect } from 'vitest';
import { isValidSemver, isValidRange, satisfies, compareVersions } from './semver';

describe('isValidSemver', () => {
  it('accepts valid full versions', () => {
    expect(isValidSemver('1.2.3')).toBe(true);
    expect(isValidSemver('0.0.0')).toBe(true);
    expect(isValidSemver('10.20.30')).toBe(true);
    expect(isValidSemver('1.2.3-beta.1')).toBe(true);
    expect(isValidSemver('1.2.3-rc.0')).toBe(true);
  });

  it('rejects partial, malformed, or non-semver strings', () => {
    expect(isValidSemver('1.2')).toBe(false);
    expect(isValidSemver('1')).toBe(false);
    expect(isValidSemver('v1.2.3')).toBe(false);
    expect(isValidSemver('1.2.3.4')).toBe(false);
    expect(isValidSemver('1.2.x')).toBe(false);
    expect(isValidSemver('')).toBe(false);
    expect(isValidSemver('not-a-version')).toBe(false);
    expect(isValidSemver('1.2.03')).toBe(false); // no leading zeros in numeric identifiers
    expect(isValidSemver('01.2.3')).toBe(false);
  });
});

describe('isValidRange', () => {
  it('accepts caret/tilde/exact/x-ranges', () => {
    for (const r of ['^1.0', '^1.0.0', '^0.2.3', '^0.0.3', '~1.2', '~1.2.3', '1.2.3', '1.2.x', '1.x', '*', 'x', '1']) {
      expect(isValidRange(r)).toBe(true);
    }
  });

  it('rejects garbage / unsupported comparator syntax', () => {
    for (const r of ['>=1.0.0 <2.0.0', '1.x || 2.x', 'not-a-range', '^^1.0', '1.2.3-']) {
      expect(isValidRange(r)).toBe(false);
    }
  });
});

describe('compareVersions', () => {
  it('orders by major/minor/patch', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('a release is greater than its own prerelease', () => {
    expect(compareVersions('1.0.0', '1.0.0-beta')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBeLessThan(0);
  });

  it('throws on an invalid version', () => {
    expect(() => compareVersions('nope', '1.0.0')).toThrow();
  });
});

describe('satisfies -- exact ranges', () => {
  it('matches only the exact version', () => {
    expect(satisfies('1.2.3', '1.2.3')).toBe(true);
    expect(satisfies('1.2.4', '1.2.3')).toBe(false);
    expect(satisfies('1.2.2', '1.2.3')).toBe(false);
  });
});

describe('satisfies -- caret ranges', () => {
  it('^1.0 allows any 1.x.y (docs/05 §2 core_api example)', () => {
    expect(satisfies('1.0.0', '^1.0')).toBe(true);
    expect(satisfies('1.0.5', '^1.0')).toBe(true);
    expect(satisfies('1.9.9', '^1.0')).toBe(true);
    expect(satisfies('2.0.0', '^1.0')).toBe(false);
    expect(satisfies('0.9.9', '^1.0')).toBe(false);
  });

  it('^1.2.3 := >=1.2.3 <2.0.0', () => {
    expect(satisfies('1.2.3', '^1.2.3')).toBe(true);
    expect(satisfies('1.2.4', '^1.2.3')).toBe(true);
    expect(satisfies('1.9.0', '^1.2.3')).toBe(true);
    expect(satisfies('1.2.2', '^1.2.3')).toBe(false);
    expect(satisfies('2.0.0', '^1.2.3')).toBe(false);
  });

  it('^0.2.3 := >=0.2.3 <0.3.0 (0.x minor-locked)', () => {
    expect(satisfies('0.2.3', '^0.2.3')).toBe(true);
    expect(satisfies('0.2.9', '^0.2.3')).toBe(true);
    expect(satisfies('0.3.0', '^0.2.3')).toBe(false);
    expect(satisfies('0.2.2', '^0.2.3')).toBe(false);
  });

  it('^0.0.3 := >=0.0.3 <0.0.4 (0.0.x patch-locked)', () => {
    expect(satisfies('0.0.3', '^0.0.3')).toBe(true);
    expect(satisfies('0.0.4', '^0.0.3')).toBe(false);
    expect(satisfies('0.0.2', '^0.0.3')).toBe(false);
  });

  it('a version below core_api never satisfies (incompatible-core-api rejection)', () => {
    expect(satisfies('0.9.0', '^1.0')).toBe(false);
  });
});

describe('satisfies -- tilde ranges', () => {
  it('~1.2.3 := >=1.2.3 <1.3.0', () => {
    expect(satisfies('1.2.3', '~1.2.3')).toBe(true);
    expect(satisfies('1.2.9', '~1.2.3')).toBe(true);
    expect(satisfies('1.3.0', '~1.2.3')).toBe(false);
    expect(satisfies('1.2.2', '~1.2.3')).toBe(false);
  });

  it('~1.2 (no patch) := >=1.2.0 <1.3.0', () => {
    expect(satisfies('1.2.0', '~1.2')).toBe(true);
    expect(satisfies('1.2.99', '~1.2')).toBe(true);
    expect(satisfies('1.3.0', '~1.2')).toBe(false);
  });
});

describe('satisfies -- x-ranges', () => {
  it('1.2.x := >=1.2.0 <1.3.0', () => {
    expect(satisfies('1.2.0', '1.2.x')).toBe(true);
    expect(satisfies('1.2.5', '1.2.x')).toBe(true);
    expect(satisfies('1.3.0', '1.2.x')).toBe(false);
  });

  it('1.x := >=1.0.0 <2.0.0', () => {
    expect(satisfies('1.0.0', '1.x')).toBe(true);
    expect(satisfies('1.99.0', '1.x')).toBe(true);
    expect(satisfies('2.0.0', '1.x')).toBe(false);
  });

  it('* matches anything', () => {
    expect(satisfies('0.0.1', '*')).toBe(true);
    expect(satisfies('99.99.99', '*')).toBe(true);
  });
});

describe('satisfies -- prerelease versions', () => {
  it('a prerelease version does not satisfy caret/tilde/x-ranges', () => {
    expect(satisfies('1.2.3-beta', '^1.2.3')).toBe(false);
    expect(satisfies('1.2.3-beta', '~1.2.3')).toBe(false);
    expect(satisfies('1.2.3-beta', '1.2.x')).toBe(false);
  });

  it('a prerelease version satisfies only its own exact range', () => {
    expect(satisfies('1.2.3-beta', '1.2.3-beta')).toBe(true);
    expect(satisfies('1.2.3-beta', '1.2.3-rc')).toBe(false);
    expect(satisfies('1.2.3-beta', '1.2.3')).toBe(false);
  });
});

describe('satisfies -- invalid inputs', () => {
  it('returns false rather than throwing for a bad version or range', () => {
    expect(satisfies('not-a-version', '^1.0')).toBe(false);
    expect(satisfies('1.2.3', 'not-a-range')).toBe(false);
  });
});
