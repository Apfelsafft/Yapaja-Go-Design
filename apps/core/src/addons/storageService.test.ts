import { describe, it, expect } from 'vitest';
import { AddonStorageService, type AddonStorageSettings } from './storageService.js';

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
});
