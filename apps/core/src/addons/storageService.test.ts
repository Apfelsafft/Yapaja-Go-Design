import { describe, it, expect } from 'vitest';
import { AddonStorageService, isSafeStorageKey, type AddonStorageSettings } from './storageService.js';

/** In-memory settings fake -- exercises the namespace enforcement without a DB. */
function makeSettings(): AddonStorageSettings & { store: Record<string, unknown> } {
  const store: Record<string, unknown> = {};
  return {
    store,
    get: (key) => store[key],
    patch: (values) => {
      Object.assign(store, values);
      return { ...store };
    },
  };
}

describe('AddonStorageService (namespace-enforced storage.own)', () => {
  it('reads back its own keys', () => {
    const svc = new AddonStorageService(makeSettings());
    svc.set('com.example.a', 'lastSync', 123);
    expect(svc.get('com.example.a', 'lastSync')).toBe(123);
    expect(svc.get('com.example.a', 'missing')).toBeUndefined();
  });

  it('isolates one add-on from another (server-side namespacing)', () => {
    const settings = makeSettings();
    const svc = new AddonStorageService(settings);
    svc.set('com.example.a', 'secret', 'A-only');
    svc.set('com.example.b', 'secret', 'B-only');
    // Same key name, different namespaces -> never collide.
    expect(svc.get('com.example.a', 'secret')).toBe('A-only');
    expect(svc.get('com.example.b', 'secret')).toBe('B-only');
    // Stored under per-add-on reserved keys, not a shared flat map.
    expect(settings.store['addon.storage.com.example.a']).toEqual({ secret: 'A-only' });
    expect(settings.store['addon.storage.com.example.b']).toEqual({ secret: 'B-only' });
  });

  it('delete + clear only affect the target namespace', () => {
    const svc = new AddonStorageService(makeSettings());
    svc.set('com.example.a', 'k1', 1);
    svc.set('com.example.a', 'k2', 2);
    svc.delete('com.example.a', 'k1');
    expect(svc.get('com.example.a', 'k1')).toBeUndefined();
    expect(svc.get('com.example.a', 'k2')).toBe(2);
    svc.clear('com.example.a');
    expect(svc.get('com.example.a', 'k2')).toBeUndefined();
  });

  it('rejects an invalid add-on id', () => {
    const svc = new AddonStorageService(makeSettings());
    expect(() => svc.set('../etc', 'k', 1)).toThrow(/valid add-on id/);
    expect(() => svc.get('..', 'k')).toThrow(/valid add-on id/);
  });

  // --- E09-T6 (W-10): path-shaped keys are REFUSED, not silently stored ----

  it.each([
    ['traversal', '../other/secret'],
    ['percent-decoded traversal', '../../etc/passwd'],
    ['absolute', '/etc/passwd'],
    ['windows separator', '..\\other'],
    ['bare dot-dot', '..'],
    ['empty', ''],
    ['whitespace only', '   '],
  ])('refuses a %s storage key (%s)', (_label, key) => {
    const settings = makeSettings();
    const svc = new AddonStorageService(settings);
    expect(() => svc.set('com.example.a', key, 'x')).toThrow(/storage key/);
    expect(() => svc.get('com.example.a', key)).toThrow(/storage key/);
    expect(() => svc.delete('com.example.a', key)).toThrow(/storage key/);
    // Nothing was written anywhere.
    expect(settings.store).toEqual({});
  });

  it('still accepts the key shapes the reference add-ons use', () => {
    const svc = new AddonStorageService(makeSettings());
    for (const key of ['state', 'index', 'command', 'track:2026-01-01T00:00:00Z', 'a.b-c_d']) {
      expect(() => svc.set('com.example.a', key, 1)).not.toThrow();
      expect(svc.get('com.example.a', key)).toBe(1);
    }
  });

  it('refuses an over-long key', () => {
    const svc = new AddonStorageService(makeSettings());
    expect(() => svc.set('com.example.a', 'k'.repeat(257), 1)).toThrow(/storage key/);
    expect(() => svc.set('com.example.a', 'k'.repeat(256), 1)).not.toThrow();
  });
});

describe('isSafeStorageKey', () => {
  it.each([
    ['plain', 'state', true],
    ['colon', 'track:1', true],
    ['dot', 'a.b', true],
    ['single dot segment-ish', '.hidden', true],
    ['traversal', '../x', false],
    ['slash', 'a/b', false],
    ['backslash', 'a\\b', false],
    ['dot-dot inside', 'a..b', false],
    ['empty', '', false],
    ['non-string', 42, false],
  ])('%s -> %s', (_label, key, expected) => {
    expect(isSafeStorageKey(key)).toBe(expected);
  });

  it('rejects control characters', () => {
    expect(isSafeStorageKey('a\u0000b')).toBe(false);
    expect(isSafeStorageKey('a\nb')).toBe(false);
    expect(isSafeStorageKey('a\u007fb')).toBe(false);
  });
});
