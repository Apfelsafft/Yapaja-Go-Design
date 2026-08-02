/**
 * Unit tests for the scoped add-on tokens (E09-T3): hashing (the raw token is
 * never stored), rotation, the live `enabled` gate (the "< 1 s invalidation"
 * guarantee at its source), and the manifest intersection.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddonManifest } from '@yapaja/shared';
import { getDb, closeDb } from '../db/index.js';
import { AddonRepository } from './repository.js';
import { AddonTokenService, hashAddonToken } from './tokens.js';

const ADDON_ID = 'com.example.service';

function manifest(overrides: Partial<AddonManifest> = {}): AddonManifest {
  return {
    id: ADDON_ID,
    name: 'Service Add-on',
    version: '1.0.0',
    core_api: '^0.0.0',
    author: 'Test',
    license: 'MIT',
    description: 'test',
    permissions: ['pos.read', 'events.publish', 'net.fetch:api.example.com'],
    ...overrides,
  };
}

let repository: AddonRepository;
let tokens: AddonTokenService;

function install(enabled: boolean, m: AddonManifest = manifest()): void {
  repository.insert({
    id: m.id,
    name: m.name,
    version: m.version,
    manifest: m,
    enabled,
    installPath: `/tmp/addons/${m.id}`,
  });
}

describe('AddonTokenService (E09-T3)', () => {
  beforeEach(() => {
    process.env.DB_PATH = ':memory:';
    closeDb();
    repository = new AddonRepository(getDb());
    tokens = new AddonTokenService({ repository });
  });

  afterEach(() => {
    closeDb();
    delete process.env.DB_PATH;
  });

  it('never stores the raw token -- only its sha256 digest', () => {
    install(true);
    const token = tokens.issue(ADDON_ID, manifest().permissions);
    const rows = getDb().prepare('SELECT * FROM addon_tokens').all() as Array<Record<string, string>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(hashAddonToken(token));
    expect(JSON.stringify(rows[0])).not.toContain(token);
  });

  it('issues a high-entropy, unique token each time', () => {
    install(true);
    const a = tokens.issue(ADDON_ID, []);
    const b = tokens.issue(ADDON_ID, []);
    expect(a).not.toBe(b);
    // 32 random bytes as base64url.
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('authenticates a live token into a principal carrying its scopes', () => {
    install(true);
    const token = tokens.issue(ADDON_ID, manifest().permissions);
    const principal = tokens.authenticate(token);
    expect(principal).not.toBeNull();
    expect(principal?.addonId).toBe(ADDON_ID);
    expect(principal?.scopes.has('pos.read')).toBe(true);
    expect(principal?.scopes.has('nav.control')).toBe(false);
    expect(principal?.netFetchDeclarations).toEqual(['api.example.com']);
  });

  it('rejects an unknown / empty / null token', () => {
    install(true);
    tokens.issue(ADDON_ID, []);
    expect(tokens.authenticate('nope')).toBeNull();
    expect(tokens.authenticate('')).toBeNull();
    expect(tokens.authenticate(null)).toBeNull();
    expect(tokens.authenticate(undefined)).toBeNull();
  });

  it('ROTATES: issuing again kills the previous token immediately', () => {
    install(true);
    const first = tokens.issue(ADDON_ID, []);
    const second = tokens.issue(ADDON_ID, []);
    expect(tokens.authenticate(first)).toBeNull();
    expect(tokens.authenticate(second)).not.toBeNull();
  });

  it('revoke() kills the token', () => {
    install(true);
    const token = tokens.issue(ADDON_ID, []);
    expect(tokens.revoke(ADDON_ID)).toBe(true);
    expect(tokens.authenticate(token)).toBeNull();
    expect(tokens.revoke(ADDON_ID)).toBe(false);
  });

  it('DISABLING the add-on kills the token even without a revoke (live enabled gate)', () => {
    install(true);
    const token = tokens.issue(ADDON_ID, []);
    expect(tokens.authenticate(token)).not.toBeNull();
    repository.setEnabled(ADDON_ID, false);
    expect(tokens.authenticate(token)).toBeNull();
    // ... and works again on re-enable (the row itself was never touched).
    repository.setEnabled(ADDON_ID, true);
    expect(tokens.authenticate(token)).not.toBeNull();
  });

  it('UNINSTALLING the add-on kills the token', () => {
    install(true);
    const token = tokens.issue(ADDON_ID, []);
    repository.delete(ADDON_ID);
    expect(tokens.authenticate(token)).toBeNull();
  });

  it('intersects the stored scopes with the CURRENT manifest permissions', () => {
    install(true);
    const token = tokens.issue(ADDON_ID, ['pos.read', 'nav.control', 'storage.own']);
    // The add-on is updated to a manifest that no longer asks for nav.control.
    repository.updateVersion({
      id: ADDON_ID,
      name: 'Service Add-on',
      version: '1.1.0',
      manifest: manifest({ version: '1.1.0', permissions: ['pos.read', 'storage.own'] }),
    });
    const principal = tokens.authenticate(token);
    expect(principal?.scopes.has('pos.read')).toBe(true);
    expect(principal?.scopes.has('storage.own')).toBe(true);
    // Narrowed live -- the token cannot outlive the permission it was granted.
    expect(principal?.scopes.has('nav.control')).toBe(false);
  });

  it('getInfo() exposes metadata but never the token', () => {
    install(true);
    const token = tokens.issue(ADDON_ID, ['pos.read']);
    const info = tokens.getInfo(ADDON_ID);
    expect(info?.scopes).toEqual(['pos.read']);
    expect(info?.createdAt).toBeTruthy();
    expect(JSON.stringify(info)).not.toContain(token);
    expect(tokens.getInfo('com.nope')).toBeNull();
  });

  it('keeps two add-ons apart', () => {
    install(true);
    const other = manifest({ id: 'com.example.other', permissions: ['nav.read'] });
    install(true, other);
    const a = tokens.issue(ADDON_ID, ['pos.read']);
    const b = tokens.issue(other.id, ['nav.read']);
    expect(tokens.authenticate(a)?.addonId).toBe(ADDON_ID);
    expect(tokens.authenticate(b)?.addonId).toBe(other.id);
    repository.setEnabled(ADDON_ID, false);
    expect(tokens.authenticate(a)).toBeNull();
    expect(tokens.authenticate(b)).not.toBeNull();
  });
});
