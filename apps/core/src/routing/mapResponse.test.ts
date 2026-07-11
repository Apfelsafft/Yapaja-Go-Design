/**
 * Response-mapping + warning tests: realistic Valhalla `/route` JSON ->
 * schema-valid `Route`, geometry joining, maneuver re-basing, ROUTE_TOO_LONG.
 */

import { describe, it, expect } from 'vitest';
import type { LatLng } from '@yapaja/shared';
import { validateRoute } from '@yapaja/shared';
import { buildRouteWarnings, haversineMeters, mapValhallaResponse } from './mapResponse.js';
import { decodePolyline6, encodePolyline6, joinLegShapes } from './polyline.js';
import type { ValhallaRouteResponse, ValhallaTrip } from './types.js';

const ORIGIN: LatLng = { lat: 0, lon: 0 };
const DEST: LatLng = { lat: 0, lon: 0.1 }; // ~11132 m straight line

// A single-leg trip whose length/time comfortably satisfy checkRoute bounds.
function singleLegTrip(): ValhallaTrip {
  return {
    summary: { length: 12.5, time: 900 },
    legs: [
      {
        shape: encodePolyline6([
          { lat: 0, lon: 0 },
          { lat: 0, lon: 0.05 },
          { lat: 0, lon: 0.1 },
        ]),
        summary: { length: 12.5, time: 900 },
        maneuvers: [
          {
            type: 1,
            instruction: 'Drive east.',
            street_names: ['B27'],
            length: 12.0,
            begin_shape_index: 0,
          },
          {
            type: 4,
            instruction: 'You have arrived.',
            street_names: [],
            length: 0.5,
            begin_shape_index: 2,
          },
        ],
      },
    ],
  };
}

describe('mapValhallaResponse', () => {
  it('maps a single-leg trip to a schema-valid Route', () => {
    const response: ValhallaRouteResponse = { trip: singleLegTrip() };
    const [route] = mapValhallaResponse(response, ORIGIN, DEST);

    expect(validateRoute(route)).toBe(true);
    expect(route.distance_m).toBe(12500); // 12.5 km -> m
    expect(route.duration_s).toBe(900);
    expect(route.legs).toEqual([{ index: 0, distance_m: 12500, duration_s: 900 }]);
    expect(route.speed_limits).toEqual([]); // no /trace_attributes
    expect(route.warnings).toEqual([]); // within 4x
    expect(typeof route.id).toBe('string');
    expect(route.id.length).toBeGreaterThan(0);
  });

  it('maps maneuvers with type-table + km->m length + instruction/street_names', () => {
    const [route] = mapValhallaResponse({ trip: singleLegTrip() }, ORIGIN, DEST);
    expect(route.maneuvers).toEqual([
      {
        index: 0,
        type: 'straight',
        instruction: 'Drive east.',
        street_names: ['B27'],
        distance_m: 12000,
        begin_shape_index: 0,
      },
      {
        index: 1,
        type: 'straight',
        instruction: 'You have arrived.',
        street_names: [],
        distance_m: 500,
        begin_shape_index: 2,
      },
    ]);
  });

  it('returns primary route first, then alternates in order', () => {
    const response: ValhallaRouteResponse = {
      trip: singleLegTrip(),
      alternates: [{ trip: singleLegTrip() }, { trip: singleLegTrip() }],
    };
    const routes = mapValhallaResponse(response, ORIGIN, DEST);
    expect(routes).toHaveLength(3);
    // Distinct ids per route.
    expect(new Set(routes.map((r) => r.id)).size).toBe(3);
  });

  it('re-bases maneuver begin_shape_index onto the joined multi-leg geometry', () => {
    // Leg 0: 3 points (indices 0,1,2); leg 1: 3 points, its local index 0 is the
    // shared junction (== joined index 2). Leg 1 maneuver at local index 1 must
    // become joined index 3.
    const legAShapes = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.05 },
      { lat: 0, lon: 0.1 },
    ];
    const legBShapes = [
      { lat: 0, lon: 0.1 },
      { lat: 0.05, lon: 0.1 },
      { lat: 0.1, lon: 0.1 },
    ];
    const trip: ValhallaTrip = {
      summary: { length: 20, time: 1500 },
      legs: [
        {
          shape: encodePolyline6(legAShapes),
          summary: { length: 11, time: 800 },
          maneuvers: [{ type: 1, length: 11, begin_shape_index: 0 }],
        },
        {
          shape: encodePolyline6(legBShapes),
          summary: { length: 9, time: 700 },
          maneuvers: [{ type: 15, length: 9, begin_shape_index: 1 }],
        },
      ],
    };
    const [route] = mapValhallaResponse({ trip }, ORIGIN, { lat: 0.1, lon: 0.1 });
    expect(route.maneuvers[0].begin_shape_index).toBe(0);
    expect(route.maneuvers[1].begin_shape_index).toBe(3);
    // Joined geometry decodes to 5 points (3 + 3 - 1 shared).
    expect(decodePolyline6(route.geometry)).toHaveLength(5);
  });
});

describe('buildRouteWarnings', () => {
  it('emits ROUTE_TOO_LONG when distance exceeds 4x the straight line', () => {
    const straight = haversineMeters(ORIGIN, DEST);
    const warnings = buildRouteWarnings(straight * 4 + 1, ORIGIN, DEST);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('ROUTE_TOO_LONG');
  });

  it('emits nothing at or below 4x the straight line', () => {
    const straight = haversineMeters(ORIGIN, DEST);
    expect(buildRouteWarnings(straight * 4, ORIGIN, DEST)).toEqual([]);
    expect(buildRouteWarnings(straight, ORIGIN, DEST)).toEqual([]);
  });
});

describe('joinLegShapes', () => {
  it('returns a single leg shape verbatim with offset 0', () => {
    const shape = encodePolyline6([
      { lat: 1, lon: 1 },
      { lat: 1, lon: 2 },
    ]);
    expect(joinLegShapes([shape])).toEqual({ geometry: shape, offsets: [0] });
  });

  it('de-duplicates the shared junction point across legs', () => {
    const a = encodePolyline6([
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
    ]);
    const b = encodePolyline6([
      { lat: 0, lon: 1 },
      { lat: 0, lon: 2 },
    ]);
    const joined = joinLegShapes([a, b]);
    expect(joined.offsets).toEqual([0, 1]);
    expect(decodePolyline6(joined.geometry)).toHaveLength(3);
  });
});
