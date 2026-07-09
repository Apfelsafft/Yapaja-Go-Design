/**
 * Plausibility checks for navigation data
 * Enforces invariants from docs/03-api-spec.md Section 5
 */

import type { Position, NavState, Route, LatLng } from './types';

export interface PlausibilityResult {
  ok: boolean;
  violations: Array<{
    rule: string;
    message: string;
  }>;
}

/**
 * Calculate great-circle distance between two points using Haversine formula
 * @param from Starting LatLng
 * @param to Ending LatLng
 * @returns Distance in meters
 */
function haversineDistance(from: LatLng, to: LatLng): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Check plausibility of a single Position
 * @param pos Position to check
 * @returns Plausibility result with violations
 */
export function checkPosition(pos: Position): PlausibilityResult {
  const violations: Array<{ rule: string; message: string }> = [];

  // Check speed: 0 ≤ speed_kmh < 250
  // Position.speed is in m/s, convert to km/h
  if (pos.speed !== null) {
    const speedKmh = pos.speed * 3.6; // m/s * 3.6 = km/h
    if (speedKmh < 0 || speedKmh >= 250) {
      violations.push({
        rule: 'speed_range',
        message: `Speed ${speedKmh.toFixed(2)} km/h out of range [0, 250)`,
      });
    }
  }

  // Check altitude: -450 < altitude_m < 4900
  if (pos.alt !== null) {
    if (pos.alt <= -450 || pos.alt >= 4900) {
      violations.push({
        rule: 'altitude_range',
        message: `Altitude ${pos.alt} m out of range (-450, 4900)`,
      });
    }
  }

  // Check heading: 0–360 (if not null)
  if (pos.heading !== null) {
    if (pos.heading < 0 || pos.heading > 360) {
      violations.push({
        rule: 'heading_range',
        message: `Heading ${pos.heading} degrees out of range [0, 360]`,
      });
    }
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}

/**
 * Check plausibility of NavState
 * Optionally validates monotonicity against previous state
 * @param state Current NavState
 * @param prev Previous NavState (optional, for monotonicity checks)
 * @param now Current time for ETA checks (default: new Date())
 * @returns Plausibility result with violations
 */
export function checkNavState(
  state: NavState,
  prev?: NavState,
  now: Date = new Date(),
): PlausibilityResult {
  const violations: Array<{ rule: string; message: string }> = [];

  // Check speed_kmh: 0 ≤ speed_kmh < 250
  if (state.speed_kmh !== null) {
    if (state.speed_kmh < 0 || state.speed_kmh >= 250) {
      violations.push({
        rule: 'speed_kmh_range',
        message: `Speed ${state.speed_kmh} km/h out of range [0, 250)`,
      });
    }
  }

  // Check altitude_m: -450 < altitude_m < 4900
  if (state.altitude_m !== null) {
    if (state.altitude_m <= -450 || state.altitude_m >= 4900) {
      violations.push({
        rule: 'altitude_m_range',
        message: `Altitude ${state.altitude_m} m out of range (-450, 4900)`,
      });
    }
  }

  // Check speed_limit_kmh: must be 5..130 or null (never 0)
  if (state.speed_limit_kmh !== null) {
    if (state.speed_limit_kmh === 0) {
      violations.push({
        rule: 'speed_limit_zero',
        message: 'Speed limit must never be 0; use null for unknown',
      });
    } else if (state.speed_limit_kmh < 5 || state.speed_limit_kmh > 130) {
      violations.push({
        rule: 'speed_limit_range',
        message: `Speed limit ${state.speed_limit_kmh} km/h out of range [5, 130]`,
      });
    }
  }

  // Check ETA: never in the past (tolerance 5 seconds)
  if (state.eta !== null) {
    const etaTime = new Date(state.eta);
    const timeDiffSeconds = (etaTime.getTime() - now.getTime()) / 1000;
    if (timeDiffSeconds < -5) {
      violations.push({
        rule: 'eta_in_past',
        message: `ETA ${state.eta} is in the past (${timeDiffSeconds.toFixed(1)}s ago)`,
      });
    }
  }

  // Monotonicity checks (if previous state provided)
  if (prev) {
    // distance_to_maneuver_m should be monotonically decreasing (tolerance 15m)
    if (
      state.distance_to_maneuver_m !== null &&
      prev.distance_to_maneuver_m !== null &&
      state.distance_to_maneuver_m > prev.distance_to_maneuver_m + 15
    ) {
      violations.push({
        rule: 'distance_to_maneuver_monotonicity',
        message: `Distance to maneuver increased by ${(state.distance_to_maneuver_m - prev.distance_to_maneuver_m).toFixed(1)}m (tolerance 15m)`,
      });
    }

    // distance_remaining_m should be monotonically decreasing (tolerance 15m)
    if (
      state.distance_remaining_m !== null &&
      prev.distance_remaining_m !== null &&
      state.distance_remaining_m > prev.distance_remaining_m + 15
    ) {
      violations.push({
        rule: 'distance_remaining_monotonicity',
        message: `Distance remaining increased by ${(state.distance_remaining_m - prev.distance_remaining_m).toFixed(1)}m (tolerance 15m)`,
      });
    }

    // duration_remaining_s should be monotonically decreasing when traveling
    if (
      state.duration_remaining_s !== null &&
      prev.duration_remaining_s !== null &&
      state.status === 'navigating' &&
      prev.status === 'navigating' &&
      state.duration_remaining_s > prev.duration_remaining_s
    ) {
      violations.push({
        rule: 'duration_remaining_monotonicity',
        message: `Duration remaining increased from ${prev.duration_remaining_s}s to ${state.duration_remaining_s}s`,
      });
    }
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}

/**
 * Check plausibility of a Route
 * Validates distance, duration against great-circle distance
 * @param route Route to check
 * @param origin Starting point
 * @param destination End point
 * @returns Plausibility result with violations
 */
export function checkRoute(
  route: Route,
  origin: LatLng,
  destination: LatLng,
): PlausibilityResult {
  const violations: Array<{ rule: string; message: string }> = [];

  // Calculate great-circle distance
  const aircraftDistance = haversineDistance(origin, destination);

  // Route distance should be ≥ aircraft distance and ≤ 4 × aircraft distance
  if (route.distance_m < aircraftDistance) {
    violations.push({
      rule: 'route_distance_too_short',
      message: `Route distance ${route.distance_m}m is less than aircraft distance ${aircraftDistance.toFixed(0)}m`,
    });
  }

  if (route.distance_m > 4 * aircraftDistance) {
    violations.push({
      rule: 'route_distance_too_long',
      message: `Route distance ${route.distance_m}m is more than 4× aircraft distance (4× = ${(4 * aircraftDistance).toFixed(0)}m)`,
    });
  }

  // Check route duration makes sense given distance and typical speeds
  // duration ∈ [distance/130 km/h, distance/15 km/h]
  const minDurationS = (route.distance_m / 1000 / 130) * 3600; // max speed: 130 km/h
  const maxDurationS = (route.distance_m / 1000 / 15) * 3600; // min speed: 15 km/h

  if (route.duration_s < minDurationS) {
    violations.push({
      rule: 'route_duration_too_short',
      message: `Duration ${route.duration_s}s is less than minimum possible (${minDurationS.toFixed(0)}s at 130 km/h)`,
    });
  }

  if (route.duration_s > maxDurationS) {
    violations.push({
      rule: 'route_duration_too_long',
      message: `Duration ${route.duration_s}s is more than maximum reasonable (${maxDurationS.toFixed(0)}s at 15 km/h)`,
    });
  }

  // Check speed limit segments
  for (const segment of route.speed_limits) {
    if (segment.kmh !== null) {
      if (segment.kmh === 0) {
        violations.push({
          rule: 'speed_segment_zero',
          message: `Speed segment has limit 0; must be null for unknown`,
        });
      } else if (segment.kmh < 5 || segment.kmh > 130) {
        violations.push({
          rule: 'speed_segment_range',
          message: `Speed segment limit ${segment.kmh} km/h out of range [5, 130]`,
        });
      }
    }
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}
