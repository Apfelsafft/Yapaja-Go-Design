/**
 * Integration tests for profile routes via HTTP injection
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../index.js';
import { closeDb } from '../db/index.js';
import type { FastifyInstance } from 'fastify';
import type { VehicleProfile } from '@yapaja/shared';

describe('Profile Routes Integration', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    process.env.DB_PATH = ':memory:';
    closeDb();
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
    closeDb();
  });

  describe('GET /api/v1/profiles', () => {
    it('should return empty list initially', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/profiles',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1); // Default profile created
    });

    it('should return all profiles', async () => {
      // Create additional profiles
      await server.inject({
        method: 'POST',
        url: '/api/v1/profiles',
        payload: {
          name: 'Test Profile 1',
          height_m: 2.5,
          width_m: 2.0,
          length_m: 5.0,
          weight_t: 2.0,
          avg_speed_kmh: 80,
          hazmat: false,
          avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/profiles',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('POST /api/v1/profiles', () => {
    it('should create a new profile', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/profiles',
        payload: {
          name: 'New Profile',
          height_m: 2.5,
          width_m: 2.0,
          length_m: 5.0,
          weight_t: 2.0,
          avg_speed_kmh: 85,
          hazmat: false,
          avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.id).toBeDefined();
      expect(body.data.name).toBe('New Profile');
      expect(body.data.is_active).toBe(false);
    });

    it('should generate UUID for new profile', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/profiles',
        payload: {
          name: 'UUID Test',
          height_m: 2.0,
          width_m: 2.0,
          length_m: 5.0,
          weight_t: 2.0,
          avg_speed_kmh: 80,
          hazmat: false,
          avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
        },
      });

      const body = JSON.parse(response.body);
      expect(body.data.id).toMatch(/^[a-f0-9-]{36}$/);
    });

    it('should ignore is_active in request body', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/profiles',
        payload: {
          name: 'Test',
          height_m: 2.0,
          width_m: 2.0,
          length_m: 5.0,
          weight_t: 2.0,
          avg_speed_kmh: 80,
          hazmat: false,
          avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
          is_active: true, // Should be ignored
        },
      });

      const body = JSON.parse(response.body);
      expect(body.data.is_active).toBe(false);
    });

    it('should reject invalid height_m', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/profiles',
        payload: {
          name: 'Test',
          height_m: 0.9, // Below minimum
          width_m: 2.0,
          length_m: 5.0,
          weight_t: 2.0,
          avg_speed_kmh: 80,
          hazmat: false,
          avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details?.fields).toBeDefined();
    });

    it('should reject invalid width_m', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/profiles',
        payload: {
          name: 'Test',
          height_m: 2.0,
          width_m: 4.6, // Above maximum
          length_m: 5.0,
          weight_t: 2.0,
          avg_speed_kmh: 80,
          hazmat: false,
          avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid length_m', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/profiles',
        payload: {
          name: 'Test',
          height_m: 2.0,
          width_m: 2.0,
          length_m: 2.5, // Below minimum
          weight_t: 2.0,
          avg_speed_kmh: 80,
          hazmat: false,
          avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject invalid weight_t', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/profiles',
        payload: {
          name: 'Test',
          height_m: 2.0,
          width_m: 2.0,
          length_m: 5.0,
          weight_t: 50, // Above maximum
          avg_speed_kmh: 80,
          hazmat: false,
          avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject invalid avg_speed_kmh', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/profiles',
        payload: {
          name: 'Test',
          height_m: 2.0,
          width_m: 2.0,
          length_m: 5.0,
          weight_t: 2.0,
          avg_speed_kmh: 200, // Above maximum
          hazmat: false,
          avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/profiles/:id', () => {
    it('should return profile by ID', async () => {
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/profiles',
        payload: {
          name: 'Test Profile',
          height_m: 2.5,
          width_m: 2.0,
          length_m: 5.0,
          weight_t: 2.0,
          avg_speed_kmh: 80,
          hazmat: false,
          avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
        },
      });

      const created = JSON.parse(createRes.body);
      const id = created.data.id;

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/profiles/${id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.id).toBe(id);
      expect(body.data.name).toBe('Test Profile');
    });

    it('should return 404 for non-existent profile', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/profiles/non-existent-id',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('PUT /api/v1/profiles/:id', () => {
    it('should update profile fields', async () => {
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/profiles',
        payload: {
          name: 'Original Name',
          height_m: 2.5,
          width_m: 2.0,
          length_m: 5.0,
          weight_t: 2.0,
          avg_speed_kmh: 80,
          hazmat: false,
          avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
        },
      });

      const created = JSON.parse(createRes.body);
      const id = created.data.id;

      const updateRes = await server.inject({
        method: 'PUT',
        url: `/api/v1/profiles/${id}`,
        payload: {
          name: 'Updated Name',
          height_m: 3.0,
        },
      });

      expect(updateRes.statusCode).toBe(200);
      const body = JSON.parse(updateRes.body);
      expect(body.data.name).toBe('Updated Name');
      expect(body.data.height_m).toBe(3.0);
    });

    it('should ignore is_active in update', async () => {
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/profiles',
        payload: {
          name: 'Test',
          height_m: 2.0,
          width_m: 2.0,
          length_m: 5.0,
          weight_t: 2.0,
          avg_speed_kmh: 80,
          hazmat: false,
          avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
        },
      });

      const created = JSON.parse(createRes.body);
      const id = created.data.id;

      const updateRes = await server.inject({
        method: 'PUT',
        url: `/api/v1/profiles/${id}`,
        payload: {
          name: 'Updated',
          is_active: true, // Should be ignored
        },
      });

      const body = JSON.parse(updateRes.body);
      expect(body.data.is_active).toBe(false);
    });

    it('should return 404 for non-existent profile', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: '/api/v1/profiles/non-existent',
        payload: { name: 'Updated' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/v1/profiles/:id', () => {
    it('should delete a profile', async () => {
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/profiles',
        payload: {
          name: 'To Delete',
          height_m: 2.0,
          width_m: 2.0,
          length_m: 5.0,
          weight_t: 2.0,
          avg_speed_kmh: 80,
          hazmat: false,
          avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
        },
      });

      const created = JSON.parse(createRes.body);
      const id = created.data.id;

      const deleteRes = await server.inject({
        method: 'DELETE',
        url: `/api/v1/profiles/${id}`,
      });

      expect(deleteRes.statusCode).toBe(204);

      // Verify it's gone
      const getRes = await server.inject({
        method: 'GET',
        url: `/api/v1/profiles/${id}`,
      });
      expect(getRes.statusCode).toBe(404);
    });

    it('should return 409 when deleting active profile', async () => {
      const listRes = await server.inject({
        method: 'GET',
        url: '/api/v1/profiles',
      });

      const profiles = JSON.parse(listRes.body);
      const activeProfile = profiles.data.find((p: VehicleProfile) => p.is_active);

      const deleteRes = await server.inject({
        method: 'DELETE',
        url: `/api/v1/profiles/${activeProfile.id}`,
      });

      expect(deleteRes.statusCode).toBe(409);
      const body = JSON.parse(deleteRes.body);
      expect(body.error.code).toBe('ACTIVE_PROFILE_UNDELETABLE');
    });

    it('should return 404 for non-existent profile', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/profiles/non-existent',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('PUT /api/v1/profiles/:id/activate', () => {
    it('should activate a profile', async () => {
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/profiles',
        payload: {
          name: 'To Activate',
          height_m: 2.0,
          width_m: 2.0,
          length_m: 5.0,
          weight_t: 2.0,
          avg_speed_kmh: 80,
          hazmat: false,
          avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
        },
      });

      const created = JSON.parse(createRes.body);
      const id = created.data.id;

      const activateRes = await server.inject({
        method: 'PUT',
        url: `/api/v1/profiles/${id}/activate`,
      });

      expect(activateRes.statusCode).toBe(200);
      const body = JSON.parse(activateRes.body);
      expect(body.data.is_active).toBe(true);
    });

    it('should maintain single-active invariant', async () => {
      // Get all profiles
      const listRes = await server.inject({
        method: 'GET',
        url: '/api/v1/profiles',
      });

      const profiles = JSON.parse(listRes.body);
      const profileIds = profiles.data.map((p: VehicleProfile) => p.id);

      // Activate each one
      for (const id of profileIds) {
        const activateRes = await server.inject({
          method: 'PUT',
          url: `/api/v1/profiles/${id}/activate`,
        });

        expect(activateRes.statusCode).toBe(200);

        // Check only one is active
        const checkRes = await server.inject({
          method: 'GET',
          url: '/api/v1/profiles',
        });

        const allProfiles = JSON.parse(checkRes.body);
        const activeCount = allProfiles.data.filter((p: VehicleProfile) => p.is_active).length;
        expect(activeCount).toBe(1);
      }
    });

    it('should return 404 for non-existent profile', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: '/api/v1/profiles/non-existent/activate',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('Health endpoint', () => {
    it('should include db service status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.services.db).toBeDefined();
      expect(['ok', 'down']).toContain(body.services.db);
    });
  });

  describe('Complete CRUD cycle', () => {
    it('should perform complete create-read-update-delete cycle', async () => {
      // Create
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/profiles',
        payload: {
          name: 'CRUD Test',
          height_m: 2.5,
          width_m: 2.0,
          length_m: 5.0,
          weight_t: 2.0,
          avg_speed_kmh: 80,
          hazmat: false,
          avoid: { motorway: false, toll: true, ferry: false, unpaved: false },
        },
      });
      expect(createRes.statusCode).toBe(201);
      const created = JSON.parse(createRes.body).data;

      // Read
      const readRes = await server.inject({
        method: 'GET',
        url: `/api/v1/profiles/${created.id}`,
      });
      expect(readRes.statusCode).toBe(200);
      expect(JSON.parse(readRes.body).data.id).toBe(created.id);

      // Update
      const updateRes = await server.inject({
        method: 'PUT',
        url: `/api/v1/profiles/${created.id}`,
        payload: {
          name: 'CRUD Test Updated',
          height_m: 3.0,
        },
      });
      expect(updateRes.statusCode).toBe(200);
      const updated = JSON.parse(updateRes.body).data;
      expect(updated.name).toBe('CRUD Test Updated');
      expect(updated.height_m).toBe(3.0);

      // Delete
      const deleteRes = await server.inject({
        method: 'DELETE',
        url: `/api/v1/profiles/${created.id}`,
      });
      expect(deleteRes.statusCode).toBe(204);

      // Verify gone
      const verifyRes = await server.inject({
        method: 'GET',
        url: `/api/v1/profiles/${created.id}`,
      });
      expect(verifyRes.statusCode).toBe(404);
    });
  });
});
