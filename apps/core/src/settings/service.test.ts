/**
 * Unit tests for SettingsService (E07-T1): generic key/value round-trip +
 * the `layouts` key specifically (widget-shell persistence, docs E07-T1).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { closeDb } from '../db/index.js';
import { SettingsService } from './service.js';

describe('SettingsService', () => {
  let service: SettingsService;

  beforeEach(() => {
    process.env.DB_PATH = ':memory:';
    closeDb();
    service = new SettingsService();
  });

  afterEach(() => {
    closeDb();
  });

  describe('getAll() / get()', () => {
    it('returns an empty object initially', () => {
      expect(service.getAll()).toEqual({});
    });

    it('returns undefined for a key that was never set', () => {
      expect(service.get('units')).toBeUndefined();
    });
  });

  describe('patch()', () => {
    it('creates a new key and returns the full settings map', () => {
      const result = service.patch({ units: 'metric' });
      expect(result).toEqual({ units: 'metric' });
      expect(service.get('units')).toBe('metric');
    });

    it('round-trips a JSON object value (the layouts key)', () => {
      const layouts = {
        explore: { mode: 'explore', slots: { 'top-bar': [] }, updatedAt: 1000 },
        drive: { mode: 'drive', slots: { 'bottom-bar': [{ instanceId: 'a', widgetId: 'speed', size: 'L' }] }, updatedAt: 2000 },
      };
      service.patch({ layouts });
      expect(service.get('layouts')).toEqual(layouts);
    });

    it('merges keys additively -- an unrelated existing key survives a patch', () => {
      service.patch({ units: 'metric' });
      service.patch({ theme: 'dark' });
      expect(service.getAll()).toEqual({ units: 'metric', theme: 'dark' });
    });

    it('overwrites an existing key wholesale (last write wins for that key)', () => {
      service.patch({ units: 'metric' });
      service.patch({ units: 'imperial' });
      expect(service.get('units')).toBe('imperial');
    });

    it('patches multiple keys in one call', () => {
      const result = service.patch({ units: 'metric', theme: 'auto' });
      expect(result).toEqual({ units: 'metric', theme: 'auto' });
    });

    it('round-trips primitive and array values', () => {
      service.patch({ flag: true, count: 3, list: ['a', 'b'] });
      expect(service.get('flag')).toBe(true);
      expect(service.get('count')).toBe(3);
      expect(service.get('list')).toEqual(['a', 'b']);
    });
  });
});
