/**
 * Unit tests for `AddonRepository` (E09-T1, migration `002_addons`).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb } from '../db/index.js';
import { AddonRepository } from './repository.js';
import type { AddonManifest } from '@yapaja/shared';

function testManifest(overrides: Partial<AddonManifest> = {}): AddonManifest {
  return {
    id: 'com.example.repo-test',
    name: 'Repo Test Add-on',
    version: '1.0.0',
    core_api: '^1.0',
    author: 'Test',
    license: 'MIT',
    description: 'test',
    permissions: ['pos.read'],
    ...overrides,
  };
}

let db: ReturnType<typeof createDb>;
let repo: AddonRepository;

beforeEach(() => {
  db = createDb(':memory:');
  repo = new AddonRepository(db);
});

afterEach(() => {
  db.close();
});

describe('AddonRepository', () => {
  it('returns null for an unknown id', () => {
    expect(repo.getById('nope')).toBeNull();
  });

  it('inserts and reads back a row, round-tripping the manifest', () => {
    const manifest = testManifest();
    const created = repo.insert({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      manifest,
      enabled: false,
      installPath: '/data/addons/com.example.repo-test',
    });
    expect(created.id).toBe(manifest.id);
    expect(created.enabled).toBe(false);
    expect(created.manifest).toEqual(manifest);

    const fetched = repo.getById(manifest.id);
    expect(fetched).toEqual(created);
  });

  it('listAll returns every row, ordered by id', () => {
    repo.insert({
      id: 'b.addon',
      name: 'B',
      version: '1.0.0',
      manifest: testManifest({ id: 'b.addon' }),
      enabled: false,
      installPath: '/x',
    });
    repo.insert({
      id: 'a.addon',
      name: 'A',
      version: '1.0.0',
      manifest: testManifest({ id: 'a.addon' }),
      enabled: false,
      installPath: '/x',
    });
    const all = repo.listAll();
    expect(all.map((r) => r.id)).toEqual(['a.addon', 'b.addon']);
  });

  it('setEnabled toggles the flag and returns null for an unknown id', () => {
    const manifest = testManifest();
    repo.insert({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      manifest,
      enabled: false,
      installPath: '/x',
    });
    const enabled = repo.setEnabled(manifest.id, true);
    expect(enabled?.enabled).toBe(true);
    const disabled = repo.setEnabled(manifest.id, false);
    expect(disabled?.enabled).toBe(false);
    expect(repo.setEnabled('nope', true)).toBeNull();
  });

  it('updateVersion bumps version/manifest but leaves `enabled` untouched', () => {
    const manifest = testManifest();
    repo.insert({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      manifest,
      enabled: true,
      installPath: '/x',
    });
    const v2 = testManifest({ version: '2.0.0' });
    const updated = repo.updateVersion({ id: manifest.id, name: v2.name, version: v2.version, manifest: v2 });
    expect(updated.version).toBe('2.0.0');
    expect(updated.enabled).toBe(true); // preserved
  });

  it('delete removes the row and reports whether anything was deleted', () => {
    const manifest = testManifest();
    repo.insert({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      manifest,
      enabled: false,
      installPath: '/x',
    });
    expect(repo.delete(manifest.id)).toBe(true);
    expect(repo.getById(manifest.id)).toBeNull();
    expect(repo.delete(manifest.id)).toBe(false);
  });

  // E09-T8: "In Home Assistant verfügbar" toggle (migration `004_addon_mqtt_enabled`).
  describe('mqtt_enabled (E09-T8)', () => {
    it('defaults to true (enabled) on a fresh insert -- "opt out", not "opt in"', () => {
      const manifest = testManifest();
      const created = repo.insert({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        manifest,
        enabled: false,
        installPath: '/x',
      });
      expect(created.mqtt_enabled).toBe(true);
      expect(repo.isMqttEnabled(manifest.id)).toBe(true);
    });

    it('setMqttEnabled toggles the flag and returns null for an unknown id', () => {
      const manifest = testManifest();
      repo.insert({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        manifest,
        enabled: true,
        installPath: '/x',
      });
      const disabled = repo.setMqttEnabled(manifest.id, false);
      expect(disabled?.mqtt_enabled).toBe(false);
      expect(repo.isMqttEnabled(manifest.id)).toBe(false);

      const reEnabled = repo.setMqttEnabled(manifest.id, true);
      expect(reEnabled?.mqtt_enabled).toBe(true);
      expect(repo.isMqttEnabled(manifest.id)).toBe(true);

      expect(repo.setMqttEnabled('nope', true)).toBeNull();
    });

    it('setMqttEnabled never touches `enabled` (independent flags)', () => {
      const manifest = testManifest();
      repo.insert({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        manifest,
        enabled: true,
        installPath: '/x',
      });
      repo.setMqttEnabled(manifest.id, false);
      expect(repo.getById(manifest.id)?.enabled).toBe(true);
    });

    it('isMqttEnabled fails closed (false) for an unknown/uninstalled id', () => {
      expect(repo.isMqttEnabled('nope')).toBe(false);
    });
  });
});
