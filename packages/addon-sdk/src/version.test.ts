import { describe, expect, it } from 'vitest';
import { ADDON_SDK_VERSION, assertCoreCompatible, isCoreCompatible } from './version.js';
import { IncompatibleCoreError } from './errors.js';

/**
 * The Core-compatibility rule (docs/05 §3): SDK major === Core major.
 * Minor/patch drift on either side is fine; a major mismatch is not.
 */

describe('isCoreCompatible() / assertCoreCompatible()', () => {
  it('is compatible when majors match, regardless of minor/patch', () => {
    expect(isCoreCompatible('1.0.0', '1.0.0')).toBe(true);
    expect(isCoreCompatible('1.9.3', '1.0.0')).toBe(true);
    expect(isCoreCompatible('1.0.0', '1.9.3')).toBe(true);
    expect(isCoreCompatible('0.4.2', '0.1.0')).toBe(true);
  });

  it('is incompatible when majors differ', () => {
    expect(isCoreCompatible('2.0.0', '1.9.9')).toBe(false);
    expect(isCoreCompatible('1.9.9', '2.0.0')).toBe(false);
    expect(isCoreCompatible('0.1.0', '1.0.0')).toBe(false);
  });

  it('treats an invalid (non-semver) version string as incompatible rather than throwing', () => {
    expect(isCoreCompatible('not-a-version', '1.0.0')).toBe(false);
    expect(isCoreCompatible('1.0.0', 'also-not-a-version')).toBe(false);
  });

  it('assertCoreCompatible() is a no-op when compatible', () => {
    expect(() => assertCoreCompatible('1.4.0', '1.0.0')).not.toThrow();
  });

  it('assertCoreCompatible() throws IncompatibleCoreError carrying both versions when majors differ', () => {
    try {
      assertCoreCompatible('2.0.0', '1.0.0');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(IncompatibleCoreError);
      const e = err as IncompatibleCoreError;
      expect(e.code).toBe('INCOMPATIBLE_CORE');
      expect(e.sdkVersion).toBe('1.0.0');
      expect(e.coreVersion).toBe('2.0.0');
      expect(e.message).toContain('1.0.0');
      expect(e.message).toContain('2.0.0');
    }
  });

  it('defaults sdkVersion to this build\'s own ADDON_SDK_VERSION', () => {
    const [major] = ADDON_SDK_VERSION.split('.');
    expect(isCoreCompatible(`${major}.99.0`)).toBe(true);
    expect(isCoreCompatible(`${Number(major) + 1}.0.0`)).toBe(false);
  });
});
