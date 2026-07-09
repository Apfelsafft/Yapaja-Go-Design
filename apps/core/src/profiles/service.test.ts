/**
 * Unit tests for ProfileService
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { closeDb } from '../db/index.js';
import type { VehicleProfile } from '@yapaja/shared';
import { ProfileService } from './service.js';

describe('ProfileService', () => {
  let service: ProfileService;

  beforeEach(() => {
    // Use in-memory database for tests
    process.env.DB_PATH = ':memory:';
    closeDb();

    service = new ProfileService();
    // Don't call init yet - tests will control when it's called
  });

  afterEach(() => {
    closeDb();
  });

  describe('init() - Default profile creation', () => {
    it('should create default Camper profile on first init', async () => {
      await service.init();
      const all = service.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe('Camper');
      expect(all[0].is_active).toBe(true);
      expect(all[0].height_m).toBe(3.0);
      expect(all[0].width_m).toBe(2.2);
      expect(all[0].length_m).toBe(6.5);
      expect(all[0].weight_t).toBe(3.5);
      expect(all[0].avg_speed_kmh).toBe(85);
      expect(all[0].hazmat).toBe(false);
    });

    it('should be idempotent (multiple init calls)', async () => {
      await service.init();
      await service.init();
      await service.init();
      const all = service.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe('Camper');
    });

    it('should not add default profile if profiles already exist', async () => {
      await service.init();
      service.create({
        name: 'Test',
        height_m: 2.0,
        width_m: 2.0,
        length_m: 5.0,
        weight_t: 2.0,
        avg_speed_kmh: 80,
        hazmat: false,
        avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
      });
      await service.init();
      const all = service.getAll();
      expect(all).toHaveLength(2);
    });
  });

  describe('getAll()', () => {
    it('should return empty list initially', async () => {
      const all = service.getAll();
      expect(all).toHaveLength(0);
    });

    it('should return all profiles', async () => {
      await service.init();
      service.create({
        name: 'Test1',
        height_m: 2.0,
        width_m: 2.0,
        length_m: 5.0,
        weight_t: 2.0,
        avg_speed_kmh: 80,
        hazmat: false,
        avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
      });
      service.create({
        name: 'Test2',
        height_m: 2.5,
        width_m: 2.5,
        length_m: 6.0,
        weight_t: 3.0,
        avg_speed_kmh: 90,
        hazmat: true,
        avoid: { motorway: true, toll: false, ferry: false, unpaved: false },
      });
      const all = service.getAll();
      expect(all).toHaveLength(3); // 1 default + 2 created
    });
  });

  describe('getById()', () => {
    it('should return null for non-existent ID', async () => {
      const profile = service.getById('non-existent');
      expect(profile).toBeNull();
    });

    it('should return profile by ID', async () => {
      await service.init();
      const all = service.getAll();
      const profile = service.getById(all[0].id);
      expect(profile).not.toBeNull();
      expect(profile?.name).toBe('Camper');
    });
  });

  describe('create()', () => {
    it('should create a new profile with generated ID', async () => {
      const profile = service.create({
        name: 'Kastenwagen',
        height_m: 2.5,
        width_m: 2.3,
        length_m: 5.5,
        weight_t: 2.5,
        avg_speed_kmh: 85,
        hazmat: false,
        avoid: { motorway: false, toll: true, ferry: false, unpaved: false },
      });

      expect(profile.id).toBeDefined();
      expect(profile.id).toMatch(/^[a-f0-9-]{36}$/); // UUID format
      expect(profile.name).toBe('Kastenwagen');
      expect(profile.is_active).toBe(false);
      expect(profile.avoid.toll).toBe(true);
    });

    it('should persist created profile', async () => {
      const profile = service.create({
        name: 'TestProfile',
        height_m: 2.0,
        width_m: 2.0,
        length_m: 5.0,
        weight_t: 2.0,
        avg_speed_kmh: 80,
        hazmat: false,
        avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
      });

      const retrieved = service.getById(profile.id);
      expect(retrieved).toEqual(profile);
    });

    it('should always create inactive profiles', async () => {
      const profile = service.create({
        name: 'Inactive',
        height_m: 2.0,
        width_m: 2.0,
        length_m: 5.0,
        weight_t: 2.0,
        avg_speed_kmh: 80,
        hazmat: false,
        avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
      });

      expect(profile.is_active).toBe(false);
    });
  });

  describe('update()', () => {
    it('should update profile fields', async () => {
      await service.init();
      const all = service.getAll();
      const id = all[0].id;

      const updated = service.update(id, {
        name: 'Updated Name',
        height_m: 4.0,
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.height_m).toBe(4.0);
      expect(updated.width_m).toBe(2.2); // unchanged
    });

    it('should not allow changing is_active via update', async () => {
      await service.init();
      const all = service.getAll();
      const id = all[0].id;

      const updated = service.update(id, {
        name: 'Changed',
      });

      expect(updated.is_active).toBe(true); // Should remain active
    });

    it('should throw for non-existent profile', async () => {
      expect(() => {
        service.update('non-existent', { name: 'Test' });
      }).toThrow('not found');
    });
  });

  describe('delete()', () => {
    it('should delete a profile', async () => {
      const created = service.create({
        name: 'ToDelete',
        height_m: 2.0,
        width_m: 2.0,
        length_m: 5.0,
        weight_t: 2.0,
        avg_speed_kmh: 80,
        hazmat: false,
        avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
      });

      service.delete(created.id);
      const retrieved = service.getById(created.id);
      expect(retrieved).toBeNull();
    });

    it('should throw when deleting active profile', async () => {
      await service.init();
      const all = service.getAll();
      const activeProfile = all.find((p) => p.is_active);

      expect(() => {
        service.delete(activeProfile!.id);
      }).toThrow();

      const error = (() => {
        try {
          service.delete(activeProfile!.id);
          return null;
        } catch (e) {
          return e as Error & { code?: string };
        }
      })();
      expect(error).not.toBeNull();
      expect((error as Error & { code?: string }).code).toBe('ACTIVE_PROFILE_UNDELETABLE');
    });

    it('should throw for non-existent profile', async () => {
      expect(() => {
        service.delete('non-existent');
      }).toThrow('not found');
    });
  });

  describe('activate()', () => {
    it('should activate a profile', async () => {
      await service.init();
      const profile = service.create({
        name: 'ToActivate',
        height_m: 2.0,
        width_m: 2.0,
        length_m: 5.0,
        weight_t: 2.0,
        avg_speed_kmh: 80,
        hazmat: false,
        avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
      });

      const activated = service.activate(profile.id);
      expect(activated.is_active).toBe(true);
    });

    it('should deactivate all other profiles', async () => {
      await service.init();
      const p1 = service.create({
        name: 'Profile1',
        height_m: 2.0,
        width_m: 2.0,
        length_m: 5.0,
        weight_t: 2.0,
        avg_speed_kmh: 80,
        hazmat: false,
        avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
      });

      service.activate(p1.id);
      const all = service.getAll();
      const activeCount = all.filter((p) => p.is_active).length;
      expect(activeCount).toBe(1);
      expect(all.find((p) => p.id === p1.id)?.is_active).toBe(true);
    });

    it('should maintain single-active invariant', async () => {
      await service.init();
      const all = service.getAll();
      for (const p of all) {
        service.activate(p.id);
        const profiles = service.getAll();
        const activeCount = profiles.filter((pr) => pr.is_active).length;
        expect(activeCount).toBe(1);
      }
    });

    it('should call onProfileChanged hook', async () => {
      let hookCalled = false;
      let hookedProfile: VehicleProfile | null = null;
      const serviceWithHook = new ProfileService({
        onProfileChanged: (p) => {
          hookCalled = true;
          hookedProfile = p;
        },
      });

      const profile = serviceWithHook.create({
        name: 'Test',
        height_m: 2.0,
        width_m: 2.0,
        length_m: 5.0,
        weight_t: 2.0,
        avg_speed_kmh: 80,
        hazmat: false,
        avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
      });

      serviceWithHook.activate(profile.id);
      expect(hookCalled).toBe(true);
      expect(hookedProfile).not.toBeNull();
      expect(hookedProfile!.id).toBe(profile.id);
      expect(hookedProfile!.is_active).toBe(true);
    });

    it('should throw for non-existent profile', async () => {
      expect(() => {
        service.activate('non-existent');
      }).toThrow('not found');
    });

    it('should handle parallel activates correctly', async () => {
      await service.init();
      const profiles = Array.from({ length: 10 }, () =>
        service.create({
          name: `Profile-${Math.random()}`,
          height_m: 2.0,
          width_m: 2.0,
          length_m: 5.0,
          weight_t: 2.0,
          avg_speed_kmh: 80,
          hazmat: false,
          avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
        }),
      );

      // Attempt parallel activates
      const profileIds = profiles.map((p) => p.id);
      await Promise.all(profileIds.map((id) => Promise.resolve(service.activate(id))));

      const all = service.getAll();
      const activeCount = all.filter((p) => p.is_active).length;
      expect(activeCount).toBe(1);
    });
  });

  describe('Validation - Boundary checks', () => {
    const createTestProfile = (overrides: Partial<VehicleProfile> = {}) => ({
      name: 'Test',
      height_m: 2.5,
      width_m: 2.0,
      length_m: 5.0,
      weight_t: 2.0,
      avg_speed_kmh: 80,
      hazmat: false,
      avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
      ...overrides,
    });

    it('should accept height_m at boundaries', () => {
      expect(() => service.create(createTestProfile({ height_m: 1.0 }))).not.toThrow();
      expect(() => service.create(createTestProfile({ height_m: 4.5 }))).not.toThrow();
      expect(() => service.create(createTestProfile({ height_m: 2.5 }))).not.toThrow();
    });

    it('should accept width_m at boundaries', () => {
      expect(() => service.create(createTestProfile({ width_m: 1.5 }))).not.toThrow();
      expect(() => service.create(createTestProfile({ width_m: 3.0 }))).not.toThrow();
      expect(() => service.create(createTestProfile({ width_m: 2.2 }))).not.toThrow();
    });

    it('should accept length_m at boundaries', () => {
      expect(() => service.create(createTestProfile({ length_m: 3.0 }))).not.toThrow();
      expect(() => service.create(createTestProfile({ length_m: 20.0 }))).not.toThrow();
      expect(() => service.create(createTestProfile({ length_m: 6.5 }))).not.toThrow();
    });

    it('should accept weight_t at boundaries', () => {
      expect(() => service.create(createTestProfile({ weight_t: 1.0 }))).not.toThrow();
      expect(() => service.create(createTestProfile({ weight_t: 40.0 }))).not.toThrow();
      expect(() => service.create(createTestProfile({ weight_t: 3.5 }))).not.toThrow();
    });

    it('should accept avg_speed_kmh at boundaries', () => {
      expect(() => service.create(createTestProfile({ avg_speed_kmh: 40 }))).not.toThrow();
      expect(() => service.create(createTestProfile({ avg_speed_kmh: 130 }))).not.toThrow();
      expect(() => service.create(createTestProfile({ avg_speed_kmh: 85 }))).not.toThrow();
    });
  });

  describe('checkHealth()', () => {
    it('should return true when database is accessible', async () => {
      const health = await service.checkHealth();
      expect(health).toBe(true);
    });
  });
});
