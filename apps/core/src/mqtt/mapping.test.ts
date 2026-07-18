/**
 * Unit tests for the bus-payload -> MQTT-payload mappers (E08-T1). Includes
 * the mandatory PLAUSIBILITY check: `speeding` in `yapaja/nav/speed` agrees
 * with `speed_kmh` vs `speed_limit_kmh` (docs/03 §4/§5).
 */
import { describe, it, expect } from 'vitest';
import type { Maneuver, NavInstructionPayload, NavState, Route } from '@yapaja/shared';
import {
  buildAltitudePayload,
  buildDestinationPayload,
  buildEtaPayload,
  buildInstructionPayload,
  buildRouteSummaryPayload,
  buildSpeedPayload,
  maneuverIcon,
} from './mapping.js';

function baseState(overrides: Partial<NavState> = {}): NavState {
  return {
    status: 'navigating',
    route_id: 'r1',
    next_maneuver: null,
    distance_to_maneuver_m: null,
    distance_remaining_m: 1200,
    duration_remaining_s: 90,
    eta: '2026-01-01T00:05:00.000Z',
    speed_kmh: 80,
    speed_limit_kmh: 100,
    altitude_m: 450,
    destination: { latlng: { lat: 47.1, lon: 9.6 }, name: 'Vaduz' },
    ...overrides,
  };
}

describe('buildEtaPayload', () => {
  it('extracts eta/duration_remaining_s/distance_remaining_m verbatim', () => {
    const state = baseState();
    expect(buildEtaPayload(state)).toEqual({
      eta: state.eta,
      duration_remaining_s: state.duration_remaining_s,
      distance_remaining_m: state.distance_remaining_m,
    });
  });
});

describe('buildSpeedPayload — plausibility: speeding agrees with speed_kmh vs speed_limit_kmh', () => {
  it('speeding=true when speed exceeds a known limit', () => {
    const state = baseState({ speed_kmh: 120, speed_limit_kmh: 100 });
    const payload = buildSpeedPayload(state);
    expect(payload).toEqual({ speed_kmh: 120, speed_limit_kmh: 100, speeding: true });
  });

  it('speeding=false when speed is at or below the limit', () => {
    expect(buildSpeedPayload(baseState({ speed_kmh: 100, speed_limit_kmh: 100 })).speeding).toBe(false);
    expect(buildSpeedPayload(baseState({ speed_kmh: 80, speed_limit_kmh: 100 })).speeding).toBe(false);
  });

  it('speeding=false when the limit is unknown (null), regardless of speed', () => {
    const payload = buildSpeedPayload(baseState({ speed_kmh: 130, speed_limit_kmh: null }));
    expect(payload.speeding).toBe(false);
  });

  it('speeding=false when speed itself is unknown (null)', () => {
    const payload = buildSpeedPayload(baseState({ speed_kmh: null, speed_limit_kmh: 50 }));
    expect(payload.speeding).toBe(false);
  });
});

describe('buildAltitudePayload', () => {
  it('wraps altitude_m', () => {
    expect(buildAltitudePayload(baseState({ altitude_m: 813 }))).toEqual({ altitude_m: 813 });
  });
  it('null altitude stays null', () => {
    expect(buildAltitudePayload(baseState({ altitude_m: null }))).toEqual({ altitude_m: null });
  });
});

describe('buildDestinationPayload', () => {
  it('flattens {latlng, name} to {lat, lon, name}', () => {
    const state = baseState({ destination: { latlng: { lat: 47.5, lon: 9.9 }, name: 'Feldkirch' } });
    expect(buildDestinationPayload(state)).toEqual({ lat: 47.5, lon: 9.9, name: 'Feldkirch' });
  });

  it('null destination -> null (not an object)', () => {
    expect(buildDestinationPayload(baseState({ destination: null }))).toBeNull();
  });
});

function maneuver(overrides: Partial<Maneuver> = {}): Maneuver {
  return {
    index: 0,
    type: 'turn_left',
    instruction: 'Links abbiegen auf B27',
    street_names: ['B27'],
    distance_m: 300,
    begin_shape_index: 0,
    ...overrides,
  };
}

describe('buildInstructionPayload', () => {
  it('maps maneuver fields + distance_m + a resolved mdi icon', () => {
    const payload: NavInstructionPayload = {
      maneuver: maneuver(),
      distance_m: 250,
      say: 'In 250 Metern links abbiegen auf B27',
    };
    expect(buildInstructionPayload(payload)).toEqual({
      type: 'turn_left',
      instruction: 'Links abbiegen auf B27',
      street_names: ['B27'],
      distance_m: 250,
      icon: 'mdi:arrow-left-top',
    });
  });

  it('falls back to a generic icon for an unmapped maneuver type', () => {
    expect(maneuverIcon('some_future_valhalla_type')).toBe('mdi:navigation');
  });

  it('resolves every known coarse ManeuverType to a non-empty mdi: name', () => {
    const types = [
      'turn_left',
      'turn_right',
      'uturn_left',
      'uturn_right',
      'roundabout_enter',
      'roundabout_exit',
      'straight',
      'continue',
    ] as const;
    for (const type of types) {
      expect(maneuverIcon(type)).toMatch(/^mdi:[a-z-]+$/);
    }
  });
});

function buildRoute(overrides: Partial<Route> = {}): Route {
  return {
    id: 'route-1',
    distance_m: 5000,
    duration_s: 400,
    geometry: '',
    legs: [{ index: 0, distance_m: 5000, duration_s: 400 }],
    maneuvers: [
      maneuver({ index: 0, street_names: ['Hauptstraße'] }),
      maneuver({ index: 1, street_names: ['Hauptstraße'] }), // duplicate -- must be deduped
      maneuver({ index: 2, street_names: [] }), // empty -- must be skipped
      maneuver({ index: 3, street_names: ['B27', 'Landstraße'] }),
    ],
    speed_limits: [],
    warnings: [],
    ...overrides,
  };
}

describe('buildRouteSummaryPayload', () => {
  it('carries distance_m/duration_s and a deduped, order-preserving via list', () => {
    const route = buildRoute();
    expect(buildRouteSummaryPayload(route)).toEqual({
      distance_m: 5000,
      duration_s: 400,
      via: ['Hauptstraße', 'B27', 'Landstraße'],
    });
  });

  it('via is empty for a route with no named streets', () => {
    const route = buildRoute({ maneuvers: [maneuver({ street_names: [] })] });
    expect(buildRouteSummaryPayload(route).via).toEqual([]);
  });
});
