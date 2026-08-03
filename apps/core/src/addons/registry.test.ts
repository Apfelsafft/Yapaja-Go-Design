/**
 * Unit tests for the registry index validator (E09-T7, docs/05 §5). Covers
 * a valid entry, and every HOSTILE fixture the task spec calls out by name:
 * a malformed hash, missing required fields, duplicate ids, huge/implausible
 * values, and (separately, in `registryRoutes.test.ts`/`routes.test.ts`) an
 * entry whose declared `sha256` does not match the tarball it points at.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Buffer } from 'node:buffer';
import {
  validateEntry,
  validateRegistryIndex,
  RegistryService,
  RegistryError,
  DEFAULT_REGISTRY_URL,
  REGISTRY_URL_SETTINGS_KEY,
  type RegistrySettingsLookup,
} from './registry.js';
import { validRawRegistryEntry as validRawEntry } from './__fixtures__/registryFixtures.js';

describe('validateEntry (single-entry hostile fixtures)', () => {
  it('accepts a fully valid entry', () => {
    const result = validateEntry(validRawEntry());
    expect('entry' in result).toBe(true);
    if ('entry' in result) {
      expect(result.entry.id).toBe('com.example.poi-campsites');
      expect(result.entry.sha256).toBe('a'.repeat(64)); // normalized lowercase
      expect(result.entry.signature).toBeNull();
    }
  });

  it('normalizes an uppercase sha256 to lowercase', () => {
    const result = validateEntry(validRawEntry({ sha256: 'A'.repeat(64) }));
    expect('entry' in result).toBe(true);
    if ('entry' in result) expect(result.entry.sha256).toBe('a'.repeat(64));
  });

  it('HOSTILE: rejects a malformed sha256 (wrong length)', () => {
    const result = validateEntry(validRawEntry({ sha256: 'deadbeef' }));
    expect('reason' in result).toBe(true);
  });

  it('HOSTILE: rejects a malformed sha256 (non-hex characters)', () => {
    const result = validateEntry(validRawEntry({ sha256: 'g'.repeat(64) }));
    expect('reason' in result).toBe(true);
  });

  it('HOSTILE: rejects a missing sha256', () => {
    const raw = validRawEntry();
    delete raw.sha256;
    const result = validateEntry(raw);
    expect('reason' in result).toBe(true);
    if ('reason' in result) expect(result.reason).toMatch(/sha256/);
  });

  it('HOSTILE: rejects an entry missing required fields (name, version, download_url, core_api one at a time)', () => {
    for (const field of ['id', 'name', 'version', 'description', 'download_url', 'core_api', 'scopes']) {
      const raw = validRawEntry();
      delete raw[field];
      const result = validateEntry(raw);
      expect('reason' in result, `expected missing "${field}" to be rejected`).toBe(true);
    }
  });

  it('HOSTILE: rejects wrong-typed fields', () => {
    expect('reason' in validateEntry(validRawEntry({ id: 12345 }))).toBe(true);
    expect('reason' in validateEntry(validRawEntry({ name: ['not', 'a', 'string'] }))).toBe(true);
    expect('reason' in validateEntry(validRawEntry({ scopes: 'pos.read' }))).toBe(true); // must be an array
    expect('reason' in validateEntry(validRawEntry({ screenshots: 'https://x.invalid/a.png' }))).toBe(true);
  });

  it('HOSTILE: rejects an id that is not a safe reverse-DNS identifier (path-traversal-shaped)', () => {
    expect('reason' in validateEntry(validRawEntry({ id: '../../etc/passwd' }))).toBe(true);
    expect('reason' in validateEntry(validRawEntry({ id: 'Not-Lowercase' }))).toBe(true);
  });

  it('HOSTILE: rejects an invalid version (not exact semver)', () => {
    expect('reason' in validateEntry(validRawEntry({ version: 'not-a-version' }))).toBe(true);
    expect('reason' in validateEntry(validRawEntry({ version: '^1.0' }))).toBe(true); // a RANGE is not a version
  });

  it('HOSTILE: rejects an invalid core_api (not a semver range)', () => {
    expect('reason' in validateEntry(validRawEntry({ core_api: 'not a range' }))).toBe(true);
  });

  it('HOSTILE: rejects a non-http(s) download_url (file://, javascript:)', () => {
    expect('reason' in validateEntry(validRawEntry({ download_url: 'file:///etc/passwd' }))).toBe(true);
    expect('reason' in validateEntry(validRawEntry({ download_url: 'javascript:alert(1)' }))).toBe(true);
  });

  it('HOSTILE: rejects an unknown/implausible scope string', () => {
    expect('reason' in validateEntry(validRawEntry({ scopes: ['nav.control', 'system.rm-rf'] }))).toBe(true);
  });

  it('accepts a declared net.fetch:<host> scope', () => {
    const result = validateEntry(validRawEntry({ scopes: ['net.fetch:api.example.invalid'] }));
    expect('entry' in result).toBe(true);
  });

  it('HOSTILE: rejects a huge/implausible "name" (far past any plausible catalog entry)', () => {
    expect('reason' in validateEntry(validRawEntry({ name: 'x'.repeat(1_000_000) }))).toBe(true);
  });

  it('HOSTILE: rejects a huge/implausible "description"', () => {
    expect('reason' in validateEntry(validRawEntry({ description: 'x'.repeat(1_000_000) }))).toBe(true);
  });

  it('HOSTILE: rejects an implausibly long scopes array', () => {
    expect('reason' in validateEntry(validRawEntry({ scopes: Array(1000).fill('pos.read') }))).toBe(true);
  });

  it('HOSTILE: rejects an implausibly large screenshots array', () => {
    expect(
      'reason' in
        validateEntry(
          validRawEntry({ screenshots: Array(1000).fill('https://example.invalid/shot.png') }),
        ),
    ).toBe(true);
  });

  it('accepts an entry with no icon/screenshots/signature (all optional)', () => {
    const raw = validRawEntry();
    delete raw.icon;
    delete raw.screenshots;
    delete raw.signature;
    const result = validateEntry(raw);
    expect('entry' in result).toBe(true);
    if ('entry' in result) {
      expect(result.entry.icon).toBeNull();
      expect(result.entry.screenshots).toEqual([]);
      expect(result.entry.signature).toBeNull();
    }
  });

  it('the reserved "signature" field is accepted but its VALUE is never interpreted/verified', () => {
    // Any string shape is accepted -- verification is explicitly out of
    // scope until a future minisign task (docs/05 §5); a garbage signature
    // string must not be rejected as if it were checked.
    const result = validateEntry(validRawEntry({ signature: 'not-a-real-minisign-signature' }));
    expect('entry' in result).toBe(true);
    if ('entry' in result) expect(result.entry.signature).toBe('not-a-real-minisign-signature');
  });
});

describe('validateRegistryIndex (whole-catalog behaviour)', () => {
  it('a non-array root rejects the WHOLE index', () => {
    const result = validateRegistryIndex({ not: 'an array' });
    expect(result.entries).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('a single bad entry does NOT poison the rest of the catalog', () => {
    const good1 = validRawEntry({ id: 'com.example.good-one' });
    const bad = validRawEntry({ id: 'com.example.bad-one', sha256: 'not-a-hash' });
    const good2 = validRawEntry({ id: 'com.example.good-two' });
    const result = validateRegistryIndex([good1, bad, good2]);
    expect(result.entries.map((e) => e.id)).toEqual(['com.example.good-one', 'com.example.good-two']);
    expect(result.errors.some((e) => e.includes('bad-one'))).toBe(true);
  });

  it('HOSTILE: duplicate ids -- the first occurrence wins, the rest are dropped and reported', () => {
    const first = validRawEntry({ id: 'com.example.dup', version: '1.0.0' });
    const second = validRawEntry({ id: 'com.example.dup', version: '9.9.9' });
    const result = validateRegistryIndex([first, second]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].version).toBe('1.0.0');
    expect(result.errors.some((e) => e.includes('duplicate id'))).toBe(true);
  });

  it('an empty array is a valid (empty) catalog', () => {
    const result = validateRegistryIndex([]);
    expect(result.entries).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});

function makeFakeSettings(): RegistrySettingsLookup & { store: Record<string, unknown> } {
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

describe('RegistryService', () => {
  let settings: ReturnType<typeof makeFakeSettings>;

  beforeEach(() => {
    settings = makeFakeSettings();
  });

  it('resolveUrl: defaults to DEFAULT_REGISTRY_URL when nothing is configured', () => {
    const service = new RegistryService({ settings, env: {} });
    expect(service.resolveUrl()).toBe(DEFAULT_REGISTRY_URL);
  });

  it('resolveUrl: a settings override wins over the default', () => {
    settings.patch({ [REGISTRY_URL_SETTINGS_KEY]: 'https://internal.example.invalid/index.json' });
    const service = new RegistryService({ settings, env: {} });
    expect(service.resolveUrl()).toBe('https://internal.example.invalid/index.json');
  });

  it('resolveUrl: an env override wins over the settings override', () => {
    settings.patch({ [REGISTRY_URL_SETTINGS_KEY]: 'https://internal.example.invalid/index.json' });
    const service = new RegistryService({
      settings,
      env: { ADDONS_REGISTRY_URL: 'https://env-override.example.invalid/index.json' },
    });
    expect(service.resolveUrl()).toBe('https://env-override.example.invalid/index.json');
  });

  it('getCachedCatalog: empty (never synced) before any sync -- offline-safe default', () => {
    const service = new RegistryService({ settings, env: {} });
    const snapshot = service.getCachedCatalog();
    expect(snapshot.entries).toEqual([]);
    expect(snapshot.fetchedAt).toBeNull();
    expect(snapshot.ageMs).toBeNull();
  });

  it('sync(): fetches, validates, and persists -- getCachedCatalog then reflects it', async () => {
    const good = validRawEntry();
    const fetchIndexBytes = vi.fn(async () => Buffer.from(JSON.stringify([good])));
    const service = new RegistryService({ settings, env: {}, fetchIndexBytes });

    const snapshot = await service.sync();
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0].id).toBe(good.id);
    expect(snapshot.fetchedAt).not.toBeNull();

    const cached = service.getCachedCatalog();
    expect(cached.entries).toHaveLength(1);
    expect(cached.fetchedAt).toBe(snapshot.fetchedAt);
    expect(cached.ageMs).toBeGreaterThanOrEqual(0);
  });

  it('W-13: sync() failure (registry unreachable) leaves a PREVIOUSLY cached catalog untouched', async () => {
    const good = validRawEntry();
    const service = new RegistryService({
      settings,
      env: {},
      fetchIndexBytes: vi.fn(async () => Buffer.from(JSON.stringify([good]))),
    });
    await service.sync();
    const before = service.getCachedCatalog();
    expect(before.entries).toHaveLength(1);

    const failingService = new RegistryService({
      settings, // SAME settings store -- simulates "same Core, registry now unreachable"
      env: {},
      fetchIndexBytes: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    });
    await expect(failingService.sync()).rejects.toBeInstanceOf(RegistryError);
    await expect(failingService.sync()).rejects.toMatchObject({ code: 'REGISTRY_UNREACHABLE' });

    const after = failingService.getCachedCatalog();
    expect(after.entries).toHaveLength(1);
    expect(after.entries[0].id).toBe(good.id);
  });

  it('sync() failure on invalid (non-JSON) response is a REGISTRY_INVALID error, cache untouched', async () => {
    const service = new RegistryService({
      settings,
      env: {},
      fetchIndexBytes: vi.fn(async () => Buffer.from('this is not JSON {{{')),
    });
    await expect(service.sync()).rejects.toMatchObject({ code: 'REGISTRY_INVALID' });
    expect(service.getCachedCatalog().entries).toEqual([]);
  });

  it('a single bad entry from a live sync does not drop the rest of the catalog', async () => {
    const good1 = validRawEntry({ id: 'com.example.good-one' });
    const bad = { id: 'com.example.bad', sha256: 'nope' };
    const good2 = validRawEntry({ id: 'com.example.good-two' });
    const service = new RegistryService({
      settings,
      env: {},
      fetchIndexBytes: vi.fn(async () => Buffer.from(JSON.stringify([good1, bad, good2]))),
    });
    const snapshot = await service.sync();
    expect(snapshot.entries.map((e) => e.id)).toEqual(['com.example.good-one', 'com.example.good-two']);
    expect(snapshot.errors.length).toBeGreaterThan(0);
  });
});
