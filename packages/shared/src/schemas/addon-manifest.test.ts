/**
 * Contract tests for the add-on manifest schema (E09-T1, docs/05 §2).
 * Covers structural validation (AJV) AND the layered semver checks
 * (`validateAddonManifest` also calls `isValidSemver`/`isValidRange`) since
 * both must pass for a manifest to be accepted.
 */

import { describe, it, expect } from 'vitest';
import { validateAddonManifest, getValidationErrorsAddonManifest } from '../validators';
import type { AddonManifest } from '../types';

function validManifest(overrides: Partial<AddonManifest> = {}): AddonManifest {
  return {
    id: 'com.example.traffic-warner',
    name: 'Stauwarner',
    version: '1.2.0',
    core_api: '^1.0',
    author: 'Example GmbH',
    license: 'MIT',
    description: 'Live-Verkehrslage als Overlay + Umfahrungsvorschläge',
    permissions: ['pos.read', 'nav.read', 'route.read', 'route.propose', 'events.publish'],
    ...overrides,
  };
}

describe('AddonManifest schema (contract)', () => {
  it('accepts a minimal valid manifest', () => {
    expect(validateAddonManifest(validManifest())).toBe(true);
  });

  it('accepts the full docs/05 §2 example (ui + service + net.fetch scope)', () => {
    const manifest = validManifest({
      requires_online: true,
      ui: {
        entry: 'ui/index.html',
        widgets: [{ id: 'traffic-status', name: 'Verkehrslage', slots: ['top-bar', 'side-panel'] }],
        map_layers: [{ id: 'traffic-flow', name: 'Verkehrsfluss', source: 'service' }],
        settings_page: true,
      },
      service: { runtime: 'node18', entry: 'service/main.js' },
      permissions: [
        'pos.read',
        'nav.read',
        'route.read',
        'route.propose',
        'map.layer.write',
        'events.publish',
        'storage.own',
        'net.fetch:api.tomtom.com',
      ],
    });
    expect(validateAddonManifest(manifest)).toBe(true);
  });

  it('rejects a missing required field', () => {
    const { author: _unused, ...rest } = validManifest();
    expect(validateAddonManifest(rest)).toBe(false);
  });

  it('rejects additional/unexpected top-level properties', () => {
    expect(validateAddonManifest({ ...validManifest(), extra: 'nope' })).toBe(false);
  });

  describe('id (directory-name safety)', () => {
    it('accepts plain and reverse-DNS ids', () => {
      for (const id of ['poi-overlay', 'com.example.traffic-warner', 'a.b.c-d', 'x']) {
        expect(validateAddonManifest(validManifest({ id }))).toBe(true);
      }
    });

    it('rejects path-traversal / absolute / separator ids', () => {
      for (const id of [
        '../evil',
        '../../etc/passwd',
        '/etc/evil',
        'foo/bar',
        'foo\\bar',
        'com.example..dots',
        '.leading-dot',
        'trailing-dot.',
        '',
        'UPPERCASE',
        'has space',
        'has\x00null',
      ]) {
        expect(validateAddonManifest(validManifest({ id }))).toBe(false);
      }
    });
  });

  describe('version / core_api semver validity', () => {
    it('rejects a non-semver version', () => {
      expect(validateAddonManifest(validManifest({ version: 'not-a-version' }))).toBe(false);
      expect(validateAddonManifest(validManifest({ version: '1.2' }))).toBe(false);
    });

    it('rejects an invalid core_api range', () => {
      expect(validateAddonManifest(validManifest({ core_api: '>=1.0.0 <2.0.0' }))).toBe(false);
      expect(validateAddonManifest(validManifest({ core_api: 'nonsense' }))).toBe(false);
    });

    it('accepts valid core_api range forms', () => {
      for (const core_api of ['^1.0', '^1.0.0', '~1.2', '1.x', '*']) {
        expect(validateAddonManifest(validManifest({ core_api }))).toBe(true);
      }
    });
  });

  describe('permissions', () => {
    it('accepts every known scope', () => {
      const permissions = [
        'pos.read',
        'nav.read',
        'nav.control',
        'route.read',
        'route.propose',
        'map.layer.write',
        'widget.register',
        'events.publish',
        'storage.own',
        'ha.notify',
        'camera.view',
      ];
      expect(validateAddonManifest(validManifest({ permissions }))).toBe(true);
    });

    it('accepts net.fetch:<host> with a non-empty host', () => {
      expect(
        validateAddonManifest(validManifest({ permissions: ['net.fetch:api.example.com'] })),
      ).toBe(true);
    });

    it('rejects net.fetch with no host', () => {
      expect(validateAddonManifest(validManifest({ permissions: ['net.fetch:'] }))).toBe(false);
    });

    it('rejects an unknown permission scope', () => {
      expect(validateAddonManifest(validManifest({ permissions: ['sudo.everything'] }))).toBe(
        false,
      );
    });
  });

  it('surfaces human-readable validation errors', () => {
    const errors = getValidationErrorsAddonManifest({ name: 'x' });
    expect(errors.length).toBeGreaterThan(0);
  });
});
