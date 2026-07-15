/**
 * Unit tests for FavoriteService (E05-T3): CRUD, reordering, and the
 * home-uniqueness invariant.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { closeDb } from '../db/index.js';
import { FavoriteService, FavoriteError } from './service.js';

describe('FavoriteService', () => {
  let service: FavoriteService;

  beforeEach(() => {
    process.env.DB_PATH = ':memory:';
    closeDb();
    service = new FavoriteService();
  });

  afterEach(() => {
    closeDb();
  });

  const campsite = () => ({
    name: 'Stellplatz Bodensee',
    latlng: { lat: 47.6, lon: 9.3 },
    icon: 'campsite',
    category: 'campsite' as const,
  });

  const home = () => ({
    name: 'Zuhause',
    latlng: { lat: 48.1, lon: 11.5 },
    icon: 'home',
    category: 'home' as const,
  });

  describe('create()', () => {
    it('creates a favorite with a generated id and default sort_order', () => {
      const fav = service.create(campsite());
      expect(fav.id).toBeDefined();
      expect(fav.name).toBe('Stellplatz Bodensee');
      expect(fav.sort_order).toBe(0);
    });

    it('auto-increments sort_order for successive creates', () => {
      const a = service.create(campsite());
      const b = service.create({ ...campsite(), name: 'Second' });
      const c = service.create({ ...campsite(), name: 'Third' });
      expect([a.sort_order, b.sort_order, c.sort_order]).toEqual([0, 1, 2]);
    });

    it('honors an explicit sort_order when provided', () => {
      const fav = service.create({ ...campsite(), sort_order: 42 });
      expect(fav.sort_order).toBe(42);
    });

    it('persists the created favorite', () => {
      const fav = service.create(campsite());
      const retrieved = service.getById(fav.id);
      expect(retrieved).toEqual(fav);
    });
  });

  describe('home uniqueness invariant', () => {
    it('allows creating the first home favorite', () => {
      const fav = service.create(home());
      expect(fav.category).toBe('home');
    });

    it('rejects a second home favorite without replace', () => {
      service.create(home());
      expect(() => service.create({ ...home(), name: 'Zweites Zuhause' })).toThrow(FavoriteError);
      try {
        service.create({ ...home(), name: 'Zweites Zuhause' });
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as FavoriteError).code).toBe('HOME_ALREADY_EXISTS');
      }
      // Only the original home favorite exists.
      const homes = service.getAll().filter((f) => f.category === 'home');
      expect(homes).toHaveLength(1);
      expect(homes[0].name).toBe('Zuhause');
    });

    it('replaces the existing home favorite when replace=true', () => {
      const original = service.create(home());
      const replacement = service.create(
        { ...home(), name: 'Neues Zuhause' },
        { replace: true },
      );

      const homes = service.getAll().filter((f) => f.category === 'home');
      expect(homes).toHaveLength(1);
      expect(homes[0].id).toBe(replacement.id);
      expect(homes[0].name).toBe('Neues Zuhause');
      expect(service.getById(original.id)).toBeNull();
    });

    it('rejects updating a non-home favorite into home when one already exists', () => {
      service.create(home());
      const other = service.create(campsite());
      expect(() => service.update(other.id, { category: 'home' })).toThrow(FavoriteError);
    });

    it('allows updating into home with replace=true', () => {
      const original = service.create(home());
      const other = service.create(campsite());
      const updated = service.update(other.id, { category: 'home' }, { replace: true });

      expect(updated.category).toBe('home');
      const homes = service.getAll().filter((f) => f.category === 'home');
      expect(homes).toHaveLength(1);
      expect(homes[0].id).toBe(other.id);
      expect(service.getById(original.id)).toBeNull();
    });

    it('allows a no-op update of the existing home favorite itself', () => {
      const fav = service.create(home());
      const updated = service.update(fav.id, { name: 'Umbenannt' });
      expect(updated.name).toBe('Umbenannt');
      expect(updated.category).toBe('home');
    });

    it('non-home categories can coexist freely', () => {
      service.create(campsite());
      service.create(campsite());
      service.create({ ...campsite(), category: 'poi' });
      expect(service.getAll()).toHaveLength(3);
    });
  });

  describe('update()', () => {
    it('updates fields and preserves the rest', () => {
      const fav = service.create(campsite());
      const updated = service.update(fav.id, { name: 'Neuer Name' });
      expect(updated.name).toBe('Neuer Name');
      expect(updated.latlng).toEqual(campsite().latlng);
    });

    it('throws NOT_FOUND for a non-existent id', () => {
      expect(() => service.update('nope', { name: 'x' })).toThrow(FavoriteError);
    });
  });

  describe('delete()', () => {
    it('deletes a favorite', () => {
      const fav = service.create(campsite());
      service.delete(fav.id);
      expect(service.getById(fav.id)).toBeNull();
    });

    it('throws NOT_FOUND for a non-existent id', () => {
      expect(() => service.delete('nope')).toThrow(FavoriteError);
    });
  });

  describe('reorder()', () => {
    it('persists a new sort order', () => {
      const a = service.create({ ...campsite(), name: 'A' });
      const b = service.create({ ...campsite(), name: 'B' });
      const c = service.create({ ...campsite(), name: 'C' });

      const reordered = service.reorder([c.id, a.id, b.id]);
      expect(reordered.map((f) => f.name)).toEqual(['C', 'A', 'B']);
      expect(reordered.map((f) => f.sort_order)).toEqual([0, 1, 2]);

      // Survives a fresh getAll() (i.e. actually persisted, not just returned).
      expect(service.getAll().map((f) => f.name)).toEqual(['C', 'A', 'B']);
    });
  });

  describe('getAll()', () => {
    it('returns favorites ordered by sort_order ascending', () => {
      service.create({ ...campsite(), name: 'First', sort_order: 5 });
      service.create({ ...campsite(), name: 'Second', sort_order: 1 });
      service.create({ ...campsite(), name: 'Third', sort_order: 3 });

      expect(service.getAll().map((f) => f.name)).toEqual(['Second', 'Third', 'First']);
    });
  });
});
