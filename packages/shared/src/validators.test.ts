/**
 * Unit tests for validators
 * Tests each schema with valid and invalid examples
 */

import { describe, it, expect } from 'vitest';
import {
  validateLatLng,
  validatePosition,
  validateVehicleProfile,
  validateRouteRequest,
  validateRoute,
  validateManeuver,
  validateNavState,
  validateApiError,
  getValidationErrorsPosition,
  getValidationErrorsVehicleProfile,
} from './validators';

describe('Validators', () => {
  describe('LatLng', () => {
    it('should accept valid LatLng', () => {
      expect(validateLatLng({ lat: 52.5, lon: 13.4 })).toBe(true);
      expect(validateLatLng({ lat: 0, lon: 0 })).toBe(true);
      expect(validateLatLng({ lat: -90, lon: -180 })).toBe(true);
    });

    it('should reject invalid LatLng - out of bounds', () => {
      expect(validateLatLng({ lat: 91, lon: 0 })).toBe(false);
      expect(validateLatLng({ lat: 0, lon: 181 })).toBe(false);
    });

    it('should reject invalid LatLng - missing fields', () => {
      expect(validateLatLng({ lat: 52.5 })).toBe(false);
      expect(validateLatLng({ lon: 13.4 })).toBe(false);
    });
  });

  describe('Position', () => {
    const validPosition = {
      lat: 52.5,
      lon: 13.4,
      alt: 100,
      speed: 10.5, // m/s
      heading: 45,
      accuracy: 5,
      source: 'gpsd' as const,
      fix: '3d' as const,
      ts: '2025-07-09T12:00:00Z',
    };

    it('should accept valid Position', () => {
      expect(validatePosition(validPosition)).toBe(true);
      expect(
        validatePosition({
          ...validPosition,
          alt: null,
          speed: null,
          heading: null,
        }),
      ).toBe(true);
    });

    it('should reject Position with invalid source', () => {
      expect(
        validatePosition({
          ...validPosition,
          source: 'invalid',
        }),
      ).toBe(false);
    });

    it('should reject Position with invalid fix', () => {
      expect(
        validatePosition({
          ...validPosition,
          fix: 'invalid',
        }),
      ).toBe(false);
    });

    it('should return validation errors for Position', () => {
      const errors = getValidationErrorsPosition({
        ...validPosition,
        ts: 'not-a-date',
      });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toMatch(/Position/);
    });
  });

  describe('VehicleProfile', () => {
    const validProfile = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Kastenwagen',
      height_m: 2.5,
      width_m: 2.0,
      length_m: 6.0,
      weight_t: 3.5,
      avg_speed_kmh: 80,
      hazmat: false,
      avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
      is_active: true,
    };

    it('should accept valid VehicleProfile', () => {
      expect(validateVehicleProfile(validProfile)).toBe(true);
    });

    it('should reject VehicleProfile with height out of range', () => {
      expect(
        validateVehicleProfile({
          ...validProfile,
          height_m: 5.0, // max is 4.5
        }),
      ).toBe(false);
    });

    it('should reject VehicleProfile with speed out of range', () => {
      expect(
        validateVehicleProfile({
          ...validProfile,
          avg_speed_kmh: 150, // max is 130
        }),
      ).toBe(false);
    });

    it('should return validation errors for VehicleProfile', () => {
      const errors = getValidationErrorsVehicleProfile({
        ...validProfile,
        weight_t: 50, // max is 40
      });
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('RouteRequest', () => {
    const validRequest = {
      origin: { lat: 52.5, lon: 13.4 },
      destination: { lat: 48.1, lon: 11.6 },
      waypoints: [{ lat: 50.0, lon: 12.5 }],
      profile_id: '550e8400-e29b-41d4-a716-446655440000',
      alternatives: 2,
    };

    it('should accept valid RouteRequest with LatLng origin', () => {
      expect(validateRouteRequest(validRequest)).toBe(true);
    });

    it('should accept valid RouteRequest with "current" origin', () => {
      expect(
        validateRouteRequest({
          ...validRequest,
          origin: 'current',
        }),
      ).toBe(true);
    });

    it('should reject RouteRequest with too many waypoints', () => {
      const tooManyWaypoints = Array(26).fill({ lat: 50.0, lon: 12.5 });
      expect(
        validateRouteRequest({
          ...validRequest,
          waypoints: tooManyWaypoints,
        }),
      ).toBe(false);
    });

    // E03-T4: exclude_locations / exclude_polygons / avoid_overrides are all
    // OPTIONAL -- a request without any of them (the exact shape used before
    // this schema version) must still validate, proving backward
    // compatibility of the MINOR schema bump.
    describe('E03-T4 temporary-avoidance fields (backward-compatible, optional)', () => {
      it('accepts a RouteRequest with none of the new fields (pre-E03-T4 shape)', () => {
        expect(validateRouteRequest(validRequest)).toBe(true);
      });

      it('accepts a RouteRequest with exclude_locations', () => {
        expect(
          validateRouteRequest({
            ...validRequest,
            exclude_locations: [{ lat: 49.5, lon: 10.5 }],
          }),
        ).toBe(true);
      });

      it('accepts a RouteRequest with an empty exclude_locations array', () => {
        expect(validateRouteRequest({ ...validRequest, exclude_locations: [] })).toBe(true);
      });

      it('accepts a RouteRequest with exclude_polygons (closed ring of >= 3 LatLng)', () => {
        expect(
          validateRouteRequest({
            ...validRequest,
            exclude_polygons: [
              [
                { lat: 49.0, lon: 10.0 },
                { lat: 49.001, lon: 10.0 },
                { lat: 49.001, lon: 10.001 },
                { lat: 49.0, lon: 10.001 },
                { lat: 49.0, lon: 10.0 },
              ],
            ],
          }),
        ).toBe(true);
      });

      it('rejects an exclude_polygons ring with fewer than 3 points', () => {
        expect(
          validateRouteRequest({
            ...validRequest,
            exclude_polygons: [[{ lat: 49.0, lon: 10.0 }, { lat: 49.001, lon: 10.0 }]],
          }),
        ).toBe(false);
      });

      it('accepts a RouteRequest with a partial avoid_overrides object', () => {
        expect(
          validateRouteRequest({
            ...validRequest,
            avoid_overrides: { toll: true },
          }),
        ).toBe(true);
      });

      it('accepts a RouteRequest with all avoid_overrides flags set', () => {
        expect(
          validateRouteRequest({
            ...validRequest,
            avoid_overrides: { motorway: true, toll: false, ferry: true, unpaved: false },
          }),
        ).toBe(true);
      });

      it('rejects avoid_overrides with an unknown flag (additionalProperties: false)', () => {
        expect(
          validateRouteRequest({
            ...validRequest,
            avoid_overrides: { motorway: true, bogus: true },
          }),
        ).toBe(false);
      });

      it('accepts a RouteRequest with all three new fields combined', () => {
        expect(
          validateRouteRequest({
            ...validRequest,
            exclude_locations: [{ lat: 49.5, lon: 10.5 }],
            exclude_polygons: [
              [
                { lat: 49.0, lon: 10.0 },
                { lat: 49.001, lon: 10.0 },
                { lat: 49.001, lon: 10.001 },
              ],
            ],
            avoid_overrides: { unpaved: true },
          }),
        ).toBe(true);
      });

      it('rejects a still-unrelated additional property (additionalProperties stays false overall)', () => {
        expect(
          validateRouteRequest({
            ...validRequest,
            bogus_field: 'nope',
          }),
        ).toBe(false);
      });
    });
  });

  describe('Route', () => {
    const validRoute = {
      id: 'route-123',
      distance_m: 10000,
      duration_s: 600,
      geometry: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
      legs: [
        {
          index: 0,
          distance_m: 10000,
          duration_s: 600,
        },
      ],
      maneuvers: [
        {
          index: 0,
          type: 'turn_left',
          instruction: 'Links abbiegen',
          street_names: ['B27'],
          distance_m: 1000,
          begin_shape_index: 0,
        },
      ],
      speed_limits: [
        {
          begin_shape_index: 0,
          end_shape_index: 10,
          kmh: 50,
        },
      ],
      warnings: [],
    };

    it('should accept valid Route', () => {
      expect(validateRoute(validRoute)).toBe(true);
    });

    it('should reject Route with invalid speed limit', () => {
      expect(
        validateRoute({
          ...validRoute,
          speed_limits: [
            {
              begin_shape_index: 0,
              end_shape_index: 10,
              kmh: 0, // 0 is not valid, must be 5-130 or null
            },
          ],
        }),
      ).toBe(false);
    });

    it('should accept Route with null speed limit', () => {
      expect(
        validateRoute({
          ...validRoute,
          speed_limits: [
            {
              begin_shape_index: 0,
              end_shape_index: 10,
              kmh: null,
            },
          ],
        }),
      ).toBe(true);
    });
  });

  describe('Maneuver', () => {
    const validManeuver = {
      index: 0,
      type: 'turn_left',
      instruction: 'Links abbiegen auf B27',
      street_names: ['B27'],
      distance_m: 250,
      begin_shape_index: 0,
    };

    it('should accept valid Maneuver', () => {
      expect(validateManeuver(validManeuver)).toBe(true);
    });

    it('should accept Maneuver with lanes', () => {
      expect(
        validateManeuver({
          ...validManeuver,
          lanes: [
            { lane_index: 0, is_usable: true, direction: 'left' },
            { lane_index: 1, is_usable: false, direction: 'straight' },
          ],
        }),
      ).toBe(true);
    });

    it('should reject Maneuver with missing required fields', () => {
      expect(
        validateManeuver({
          index: 0,
          type: 'turn_left',
          instruction: 'Links',
          // missing street_names
          distance_m: 250,
          begin_shape_index: 0,
        }),
      ).toBe(false);
    });
  });

  describe('NavState', () => {
    const validNavState = {
      status: 'navigating' as const,
      route_id: 'route-123',
      next_maneuver: {
        index: 1,
        type: 'turn_right',
        instruction: 'Rechts abbiegen',
        street_names: ['Main St'],
        distance_m: 500,
        begin_shape_index: 10,
      },
      distance_to_maneuver_m: 500,
      distance_remaining_m: 5000,
      duration_remaining_s: 300,
      eta: new Date(Date.now() + 300000).toISOString(),
      speed_kmh: 50,
      speed_limit_kmh: 50,
      altitude_m: 100,
      destination: {
        latlng: { lat: 48.1, lon: 11.6 },
        name: 'Munich',
      },
    };

    it('should accept valid NavState', () => {
      expect(validateNavState(validNavState)).toBe(true);
    });

    it('should accept NavState with null values', () => {
      expect(
        validateNavState({
          status: 'idle',
          route_id: null,
          next_maneuver: null,
          distance_to_maneuver_m: null,
          distance_remaining_m: null,
          duration_remaining_s: null,
          eta: null,
          speed_kmh: null,
          speed_limit_kmh: null,
          altitude_m: null,
          destination: null,
        }),
      ).toBe(true);
    });

    it('should reject NavState with invalid status', () => {
      expect(
        validateNavState({
          ...validNavState,
          status: 'invalid',
        }),
      ).toBe(false);
    });

    it('should reject NavState with zero speed_limit_kmh', () => {
      expect(
        validateNavState({
          ...validNavState,
          speed_limit_kmh: 0,
        }),
      ).toBe(false);
    });
  });

  describe('ApiError', () => {
    const validError = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
      },
    };

    it('should accept valid ApiError', () => {
      expect(validateApiError(validError)).toBe(true);
    });

    it('should accept ApiError with details', () => {
      expect(
        validateApiError({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input',
            details: { field: 'email', issue: 'not an email' },
          },
        }),
      ).toBe(true);
    });

    it('should reject ApiError without message', () => {
      expect(
        validateApiError({
          error: {
            code: 'VALIDATION_ERROR',
            // missing message
          },
        }),
      ).toBe(false);
    });
  });
});
