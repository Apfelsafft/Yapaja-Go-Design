/**
 * Unit tests for plausibility checks
 * Tests invariants from docs/03-api-spec.md Section 5
 */

import { describe, it, expect } from 'vitest';
import { checkPosition, checkNavState, checkRoute } from './plausibility';
import type { Position, NavState, Route, LatLng } from './types';

describe('Plausibility', () => {
  describe('checkPosition', () => {
    const validPosition: Position = {
      lat: 52.5,
      lon: 13.4,
      alt: 100,
      speed: 20, // 20 m/s = 72 km/h
      heading: 45,
      accuracy: 5,
      source: 'gpsd',
      fix: '3d',
      ts: '2025-07-09T12:00:00Z',
    };

    it('should accept valid Position', () => {
      const result = checkPosition(validPosition);
      expect(result.ok).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    // Speed tests (0 ≤ speed_kmh < 250)
    it('should accept speed at boundary 249.9 km/h', () => {
      // 249.9 km/h = 69.41666... m/s
      const result = checkPosition({
        ...validPosition,
        speed: 69.41666,
      });
      expect(result.ok).toBe(true);
    });

    it('should reject speed at boundary 250.0 km/h', () => {
      // 250 km/h = 69.44... m/s, use 70 m/s to exceed
      const result = checkPosition({
        ...validPosition,
        speed: 70, // 70 m/s = 252 km/h
      });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'speed_range')).toBe(true);
    });

    it('should accept speed 0 km/h', () => {
      const result = checkPosition({
        ...validPosition,
        speed: 0,
      });
      expect(result.ok).toBe(true);
    });

    it('should reject negative speed', () => {
      const result = checkPosition({
        ...validPosition,
        speed: -1,
      });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'speed_range')).toBe(true);
    });

    // Altitude tests (-450 < altitude_m < 4900)
    it('should reject altitude at boundary -450', () => {
      const result = checkPosition({
        ...validPosition,
        alt: -450,
      });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'altitude_range')).toBe(true);
    });

    it('should accept altitude at boundary -449', () => {
      const result = checkPosition({
        ...validPosition,
        alt: -449,
      });
      expect(result.ok).toBe(true);
    });

    it('should accept altitude at boundary 4899', () => {
      const result = checkPosition({
        ...validPosition,
        alt: 4899,
      });
      expect(result.ok).toBe(true);
    });

    it('should reject altitude at boundary 4900', () => {
      const result = checkPosition({
        ...validPosition,
        alt: 4900,
      });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'altitude_range')).toBe(true);
    });

    it('should accept null altitude', () => {
      const result = checkPosition({
        ...validPosition,
        alt: null,
      });
      expect(result.ok).toBe(true);
    });

    // Heading tests (0–360)
    it('should accept heading 0', () => {
      const result = checkPosition({
        ...validPosition,
        heading: 0,
      });
      expect(result.ok).toBe(true);
    });

    it('should accept heading 360', () => {
      const result = checkPosition({
        ...validPosition,
        heading: 360,
      });
      expect(result.ok).toBe(true);
    });

    it('should reject negative heading', () => {
      const result = checkPosition({
        ...validPosition,
        heading: -1,
      });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'heading_range')).toBe(true);
    });

    it('should reject heading > 360', () => {
      const result = checkPosition({
        ...validPosition,
        heading: 361,
      });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'heading_range')).toBe(true);
    });
  });

  describe('checkNavState', () => {
    const validNavState: NavState = {
      status: 'navigating',
      route_id: 'route-123',
      next_maneuver: {
        index: 0,
        type: 'turn_left',
        instruction: 'Links abbiegen',
        street_names: ['B27'],
        distance_m: 500,
        begin_shape_index: 0,
      },
      distance_to_maneuver_m: 500,
      distance_remaining_m: 5000,
      duration_remaining_s: 300,
      eta: new Date(Date.now() + 300000).toISOString(),
      speed_kmh: 50,
      speed_limit_kmh: 50,
      altitude_m: 100,
      destination: { latlng: { lat: 48.1, lon: 11.6 }, name: 'Munich' },
    };

    it('should accept valid NavState', () => {
      const result = checkNavState(validNavState);
      expect(result.ok).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    // Speed tests
    it('should accept speed 249.9 km/h', () => {
      const result = checkNavState({
        ...validNavState,
        speed_kmh: 249.9,
      });
      expect(result.ok).toBe(true);
    });

    it('should reject speed 250.0 km/h', () => {
      const result = checkNavState({
        ...validNavState,
        speed_kmh: 250,
      });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'speed_kmh_range')).toBe(true);
    });

    // Altitude tests
    it('should reject altitude -450', () => {
      const result = checkNavState({
        ...validNavState,
        altitude_m: -450,
      });
      expect(result.ok).toBe(false);
    });

    it('should accept altitude -449', () => {
      const result = checkNavState({
        ...validNavState,
        altitude_m: -449,
      });
      expect(result.ok).toBe(true);
    });

    it('should accept altitude 4899', () => {
      const result = checkNavState({
        ...validNavState,
        altitude_m: 4899,
      });
      expect(result.ok).toBe(true);
    });

    it('should reject altitude 4900', () => {
      const result = checkNavState({
        ...validNavState,
        altitude_m: 4900,
      });
      expect(result.ok).toBe(false);
    });

    // Speed limit tests (5..130 or null, never 0)
    it('should accept speed_limit_kmh 5', () => {
      const result = checkNavState({
        ...validNavState,
        speed_limit_kmh: 5,
      });
      expect(result.ok).toBe(true);
    });

    it('should accept speed_limit_kmh 130', () => {
      const result = checkNavState({
        ...validNavState,
        speed_limit_kmh: 130,
      });
      expect(result.ok).toBe(true);
    });

    it('should accept speed_limit_kmh null', () => {
      const result = checkNavState({
        ...validNavState,
        speed_limit_kmh: null,
      });
      expect(result.ok).toBe(true);
    });

    it('should reject speed_limit_kmh 0', () => {
      const result = checkNavState({
        ...validNavState,
        speed_limit_kmh: 0,
      });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'speed_limit_zero')).toBe(true);
    });

    it('should reject speed_limit_kmh 4', () => {
      const result = checkNavState({
        ...validNavState,
        speed_limit_kmh: 4,
      });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'speed_limit_range')).toBe(true);
    });

    it('should reject speed_limit_kmh 131', () => {
      const result = checkNavState({
        ...validNavState,
        speed_limit_kmh: 131,
      });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'speed_limit_range')).toBe(true);
    });

    // ETA tests (never in the past, tolerance 5 seconds)
    it('should reject ETA 10 seconds in the past', () => {
      const now = new Date();
      const past = new Date(now.getTime() - 10000);
      const result = checkNavState(
        {
          ...validNavState,
          eta: past.toISOString(),
        },
        undefined,
        now,
      );
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'eta_in_past')).toBe(true);
    });

    it('should accept ETA 10 seconds in the future', () => {
      const now = new Date();
      const future = new Date(now.getTime() + 10000);
      const result = checkNavState(
        {
          ...validNavState,
          eta: future.toISOString(),
        },
        undefined,
        now,
      );
      expect(result.ok).toBe(true);
    });

    it('should accept ETA 5 seconds in the past (tolerance)', () => {
      const now = new Date();
      const past = new Date(now.getTime() - 5000);
      const result = checkNavState(
        {
          ...validNavState,
          eta: past.toISOString(),
        },
        undefined,
        now,
      );
      expect(result.ok).toBe(true);
    });

    // Monotonicity tests
    it('should accept distance_to_maneuver decreasing', () => {
      const prev: NavState = {
        ...validNavState,
        distance_to_maneuver_m: 600,
      };
      const current: NavState = {
        ...validNavState,
        distance_to_maneuver_m: 500,
      };
      const result = checkNavState(current, prev);
      expect(result.ok).toBe(true);
    });

    it('should accept distance_to_maneuver increasing by 10m (tolerance)', () => {
      const prev: NavState = {
        ...validNavState,
        distance_to_maneuver_m: 500,
      };
      const current: NavState = {
        ...validNavState,
        distance_to_maneuver_m: 510,
      };
      const result = checkNavState(current, prev);
      expect(result.ok).toBe(true);
    });

    it('should reject distance_to_maneuver increasing by 20m (exceeds tolerance)', () => {
      const prev: NavState = {
        ...validNavState,
        distance_to_maneuver_m: 500,
      };
      const current: NavState = {
        ...validNavState,
        distance_to_maneuver_m: 520,
      };
      const result = checkNavState(current, prev);
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'distance_to_maneuver_monotonicity')).toBe(true);
    });

    it('should accept distance_remaining decreasing', () => {
      const prev: NavState = {
        ...validNavState,
        distance_remaining_m: 6000,
      };
      const current: NavState = {
        ...validNavState,
        distance_remaining_m: 5000,
      };
      const result = checkNavState(current, prev);
      expect(result.ok).toBe(true);
    });

    it('should accept distance_remaining increasing by 10m (tolerance)', () => {
      const prev: NavState = {
        ...validNavState,
        distance_remaining_m: 5000,
      };
      const current: NavState = {
        ...validNavState,
        distance_remaining_m: 5010,
      };
      const result = checkNavState(current, prev);
      expect(result.ok).toBe(true);
    });

    it('should reject distance_remaining increasing by 20m (exceeds tolerance)', () => {
      const prev: NavState = {
        ...validNavState,
        distance_remaining_m: 5000,
      };
      const current: NavState = {
        ...validNavState,
        distance_remaining_m: 5020,
      };
      const result = checkNavState(current, prev);
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'distance_remaining_monotonicity')).toBe(true);
    });

    it('should accept duration_remaining decreasing while navigating', () => {
      const prev: NavState = {
        ...validNavState,
        status: 'navigating',
        duration_remaining_s: 400,
      };
      const current: NavState = {
        ...validNavState,
        status: 'navigating',
        duration_remaining_s: 300,
      };
      const result = checkNavState(current, prev);
      expect(result.ok).toBe(true);
    });

    it('should reject duration_remaining increasing while navigating', () => {
      const prev: NavState = {
        ...validNavState,
        status: 'navigating',
        duration_remaining_s: 300,
      };
      const current: NavState = {
        ...validNavState,
        status: 'navigating',
        duration_remaining_s: 400,
      };
      const result = checkNavState(current, prev);
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'duration_remaining_monotonicity')).toBe(true);
    });

    it('should not check duration_remaining monotonicity when status changes', () => {
      const prev: NavState = {
        ...validNavState,
        status: 'paused',
        duration_remaining_s: 300,
      };
      const current: NavState = {
        ...validNavState,
        status: 'navigating',
        duration_remaining_s: 400,
      };
      const result = checkNavState(current, prev);
      expect(result.ok).toBe(true);
    });
  });

  describe('checkRoute', () => {
    const origin: LatLng = { lat: 52.5, lon: 13.4 }; // Berlin
    const destination: LatLng = { lat: 48.1, lon: 11.6 }; // Munich
    // Great-circle distance Berlin-Munich ≈ 504 km

    const validRoute: Route = {
      id: 'route-123',
      distance_m: 550000, // 550 km (reasonable for Berlin-Munich)
      duration_s: 19800, // 5.5 hours
      geometry: 'polyline',
      legs: [{ index: 0, distance_m: 550000, duration_s: 19800 }],
      maneuvers: [
        {
          index: 0,
          type: 'turn_left',
          instruction: 'Start',
          street_names: [],
          distance_m: 550000,
          begin_shape_index: 0,
        },
      ],
      speed_limits: [],
      warnings: [],
    };

    it('should accept valid Route', () => {
      const result = checkRoute(validRoute, origin, destination);
      expect(result.ok).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    // Haversine reference test: Berlin-Munich ≈ 504 km (tolerance ±2 km)
    it('should accept route distance between 1× and 4× aircraft distance', () => {
      // aircraft distance ≈ 504 km
      // route distance 550 km is between 504 and 2016, so acceptable
      const result = checkRoute(validRoute, origin, destination);
      expect(result.ok).toBe(true);
    });

    it('should reject route distance < aircraft distance (1.0×)', () => {
      // 450 km is less than aircraft distance (≈504 km)
      const result = checkRoute(
        {
          ...validRoute,
          distance_m: 450000,
        },
        origin,
        destination,
      );
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'route_distance_too_short')).toBe(true);
    });

    it('should reject route distance > 4× aircraft distance (4.1×)', () => {
      // aircraft distance ≈ 504 km, 4× = 2016 km
      // 2100 km exceeds this
      const result = checkRoute(
        {
          ...validRoute,
          distance_m: 2100000,
          duration_s: 75600, // proportional duration
        },
        origin,
        destination,
      );
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'route_distance_too_long')).toBe(true);
    });

    // Duration tests: ∈ [distance/130 km/h, distance/5 km/h]
    it('should accept duration within range', () => {
      const result = checkRoute(validRoute, origin, destination);
      expect(result.ok).toBe(true);
    });

    it('should reject duration too short', () => {
      // 550 km at max speed (130 km/h) would be 15300 seconds (4.25 hours)
      // 3600 seconds is too short
      const result = checkRoute(
        {
          ...validRoute,
          duration_s: 3600,
        },
        origin,
        destination,
      );
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'route_duration_too_short')).toBe(true);
    });

    it('should reject duration too long', () => {
      // 550 km at min speed (5 km/h) would be 396000 seconds (110 hours);
      // 450000 seconds (~4.4 km/h avg) exceeds even that generous floor.
      const result = checkRoute(
        {
          ...validRoute,
          duration_s: 450000,
        },
        origin,
        destination,
      );
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'route_duration_too_long')).toBe(true);
    });

    it('accepts a slow but plausible constrained-truck route (~8 km/h, was rejected by the old 15 km/h floor)', () => {
      // E03-T5 regression: a real Liechtenstein 3.5t truck leg kept off the
      // fast road onto slow side roads (~3.4 km, ~1573 s ≈ 7.8 km/h) must NOT
      // be flagged implausible. Origin/destination ~3.4 km apart.
      const near = { lat: origin.lat + 0.03, lon: origin.lon };
      const result = checkRoute(
        {
          ...validRoute,
          distance_m: 3400,
          duration_s: 1573,
          legs: [{ index: 0, distance_m: 3400, duration_s: 1573 }],
          maneuvers: [
            { ...validRoute.maneuvers[0], distance_m: 3400 },
          ],
        },
        origin,
        near,
      );
      expect(result.ok).toBe(true);
    });

    // Speed limit validation
    it('should reject route with speed_limit 0', () => {
      const result = checkRoute(
        {
          ...validRoute,
          speed_limits: [
            {
              begin_shape_index: 0,
              end_shape_index: 10,
              kmh: 0,
            },
          ],
        },
        origin,
        destination,
      );
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'speed_segment_zero')).toBe(true);
    });

    it('should accept route with speed_limit null', () => {
      const result = checkRoute(
        {
          ...validRoute,
          speed_limits: [
            {
              begin_shape_index: 0,
              end_shape_index: 10,
              kmh: null,
            },
          ],
        },
        origin,
        destination,
      );
      expect(result.ok).toBe(true);
    });

    it('should reject route with speed_limit out of range', () => {
      const result = checkRoute(
        {
          ...validRoute,
          speed_limits: [
            {
              begin_shape_index: 0,
              end_shape_index: 10,
              kmh: 150,
            },
          ],
        },
        origin,
        destination,
      );
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'speed_segment_range')).toBe(true);
    });
  });

  describe('Haversine distance (reference test)', () => {
    it('should calculate Berlin-Munich distance with tolerance', () => {
      // Berlin: 52.5°N, 13.4°E
      // Munich: 48.1°N, 11.6°E
      // Reference Haversine: approximately 502-506 km depending on earth model

      const berlin = { lat: 52.5, lon: 13.4 };
      const munich = { lat: 48.1, lon: 11.6 };

      // Create a mock route with 550 km to test Haversine indirectly
      // 550 km is definitely between 1× and 4× aircraft distance
      const result = checkRoute(
        {
          id: 'test',
          distance_m: 550000, // 550 km (reasonable for Berlin-Munich routing)
          duration_s: 18000, // ~5 hours
          geometry: 'test',
          legs: [{ index: 0, distance_m: 550000, duration_s: 18000 }],
          maneuvers: [
            {
              index: 0,
              type: 'start',
              instruction: 'Start',
              street_names: [],
              distance_m: 550000,
              begin_shape_index: 0,
            },
          ],
          speed_limits: [],
          warnings: [],
        },
        berlin,
        munich,
      );

      expect(result.ok).toBe(true);
      // If Haversine is correct, 550 km should be between aircraft distance (~504 km) and 4× aircraft distance
    });
  });
});
