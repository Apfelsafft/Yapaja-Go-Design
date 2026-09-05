/**
 * 🔴 W-08 SAFETY-CORE unit tests: profile -> Valhalla truck costing.
 * Every field that gates physical edge traversal is asserted exactly.
 */

import { describe, it, expect } from 'vitest';
import type { LatLng, VehicleProfile } from '@yapaja/shared';
import { buildTruckCostingOptions, buildValhallaRouteBody } from './profileMapping.js';

function camper(overrides: Partial<VehicleProfile> = {}): VehicleProfile {
  return {
    id: 'p-camper',
    name: 'Alkoven 7.5t',
    height_m: 3.2,
    width_m: 2.35,
    length_m: 7.4,
    weight_t: 7.5,
    avg_speed_kmh: 95,
    hazmat: false,
    avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
    is_active: true,
    dimensions_confirmed_at: null,
    ...overrides,
  };
}

describe('buildTruckCostingOptions (W-08 mapping)', () => {
  it('maps every dimension/weight/speed/hazmat field 1:1 with correct units', () => {
    const truck = buildTruckCostingOptions(camper({ hazmat: true }));
    expect(truck.height).toBe(3.2); // metres
    expect(truck.width).toBe(2.35); // metres
    expect(truck.length).toBe(7.4); // metres
    expect(truck.weight).toBe(7.5); // metric tonnes
    expect(truck.top_speed).toBe(95); // km/h
    expect(truck.hazmat).toBe(true);
  });

  it('sets ALL four use_* flags to 0 when every avoid flag is true', () => {
    const truck = buildTruckCostingOptions(
      camper({ avoid: { motorway: true, toll: true, ferry: true, unpaved: true } }),
    );
    expect(truck.use_highways).toBe(0); // avoid.motorway
    expect(truck.use_tolls).toBe(0); // avoid.toll
    expect(truck.use_ferry).toBe(0); // avoid.ferry
    expect(truck.use_tracks).toBe(0); // avoid.unpaved (closest equivalent)
  });

  it('OMITS every use_* key when avoid flags are false (keeps Valhalla default 1)', () => {
    const truck = buildTruckCostingOptions(camper());
    expect('use_highways' in truck).toBe(false);
    expect('use_tolls' in truck).toBe(false);
    expect('use_ferry' in truck).toBe(false);
    expect('use_tracks' in truck).toBe(false);
  });

  it('maps each avoid flag to exactly its own use_* flag (no cross-talk)', () => {
    const onlyMotorway = buildTruckCostingOptions(
      camper({ avoid: { motorway: true, toll: false, ferry: false, unpaved: false } }),
    );
    expect(onlyMotorway.use_highways).toBe(0);
    expect('use_tolls' in onlyMotorway).toBe(false);
    expect('use_ferry' in onlyMotorway).toBe(false);
    expect('use_tracks' in onlyMotorway).toBe(false);

    const onlyToll = buildTruckCostingOptions(
      camper({ avoid: { motorway: false, toll: true, ferry: false, unpaved: false } }),
    );
    expect(onlyToll.use_tolls).toBe(0);
    expect('use_highways' in onlyToll).toBe(false);

    const onlyFerry = buildTruckCostingOptions(
      camper({ avoid: { motorway: false, toll: false, ferry: true, unpaved: false } }),
    );
    expect(onlyFerry.use_ferry).toBe(0);
    expect('use_highways' in onlyFerry).toBe(false);

    const onlyUnpaved = buildTruckCostingOptions(
      camper({ avoid: { motorway: false, toll: false, ferry: false, unpaved: true } }),
    );
    expect(onlyUnpaved.use_tracks).toBe(0);
    expect('use_ferry' in onlyUnpaved).toBe(false);
  });
});

describe('buildValhallaRouteBody', () => {
  const origin: LatLng = { lat: 48.0, lon: 9.0 };
  const destination: LatLng = { lat: 48.5, lon: 9.5 };

  it('assembles locations origin -> waypoints -> destination, all type "break"', () => {
    const wp: LatLng[] = [{ lat: 48.2, lon: 9.2 }];
    const body = buildValhallaRouteBody(origin, destination, wp, camper(), 2);

    expect(body.locations).toEqual([
      { lat: 48.0, lon: 9.0, type: 'break' },
      { lat: 48.2, lon: 9.2, type: 'break' },
      { lat: 48.5, lon: 9.5, type: 'break' },
    ]);
    expect(body.costing).toBe('truck');
    expect(body.directions_options).toEqual({ units: 'kilometers' });
    expect(body.alternates).toBe(2);
  });

  it('passes alternatives straight through as alternates', () => {
    const body = buildValhallaRouteBody(origin, destination, [], camper(), 0);
    expect(body.alternates).toBe(0);
    expect(body.locations).toHaveLength(2);
  });

  // E03-T4: temporary avoidances (exclude_locations / exclude_polygons /
  // avoid_overrides). ⚠️ exclude_polygons is the one field that flips to
  // [lon, lat] tuples -- every assertion below checks that ordering
  // explicitly, not just "the numbers are present somewhere".
  describe('E03-T4 exclude_locations / exclude_polygons / avoid_overrides', () => {
    it('omits exclude_locations and exclude_polygons entirely when no exclude options are passed', () => {
      const body = buildValhallaRouteBody(origin, destination, [], camper(), 0);
      expect('exclude_locations' in body).toBe(false);
      expect('exclude_polygons' in body).toBe(false);
    });

    it('omits exclude_locations and exclude_polygons when the arrays are present but empty', () => {
      const body = buildValhallaRouteBody(origin, destination, [], camper(), 0, {
        excludeLocations: [],
        excludePolygons: [],
      });
      expect('exclude_locations' in body).toBe(false);
      expect('exclude_polygons' in body).toBe(false);
    });

    it('maps exclude_locations 1:1 in {lat, lon} order (NOT swapped)', () => {
      const body = buildValhallaRouteBody(origin, destination, [], camper(), 0, {
        excludeLocations: [
          { lat: 48.2, lon: 9.3 },
          { lat: 48.25, lon: 9.35 },
        ],
      });
      expect(body.exclude_locations).toEqual([
        { lat: 48.2, lon: 9.3 },
        { lat: 48.25, lon: 9.35 },
      ]);
    });

    it('maps exclude_polygons rings to [lon, lat] tuples (⚠️ swapped from the app-internal {lat, lon})', () => {
      const body = buildValhallaRouteBody(origin, destination, [], camper(), 0, {
        excludePolygons: [
          [
            { lat: 48.2, lon: 9.3 },
            { lat: 48.201, lon: 9.3 },
            { lat: 48.201, lon: 9.301 },
            { lat: 48.2, lon: 9.301 },
            { lat: 48.2, lon: 9.3 },
          ],
        ],
      });
      expect(body.exclude_polygons).toEqual([
        [
          [9.3, 48.2],
          [9.3, 48.201],
          [9.301, 48.201],
          [9.301, 48.2],
          [9.3, 48.2],
        ],
      ]);
    });

    it('maps multiple exclude_polygons rings independently', () => {
      const body = buildValhallaRouteBody(origin, destination, [], camper(), 0, {
        excludePolygons: [
          [
            { lat: 1, lon: 2 },
            { lat: 3, lon: 4 },
            { lat: 5, lon: 6 },
          ],
          [
            { lat: 10, lon: 20 },
            { lat: 30, lon: 40 },
            { lat: 50, lon: 60 },
          ],
        ],
      });
      expect(body.exclude_polygons).toEqual([
        [
          [2, 1],
          [4, 3],
          [6, 5],
        ],
        [
          [20, 10],
          [40, 30],
          [60, 50],
        ],
      ]);
    });

    it('avoid_overrides overrides the profile avoid flags for use_* mapping, without mutating the profile', () => {
      const profile = camper({ avoid: { motorway: false, toll: false, ferry: false, unpaved: false } });
      const body = buildValhallaRouteBody(origin, destination, [], profile, 0, {
        avoidOverrides: { toll: true, ferry: true },
      });
      const truck = body.costing_options.truck;
      expect(truck.use_tolls).toBe(0);
      expect(truck.use_ferry).toBe(0);
      expect('use_highways' in truck).toBe(false);
      expect('use_tracks' in truck).toBe(false);
      // Profile object itself is untouched.
      expect(profile.avoid).toEqual({ motorway: false, toll: false, ferry: false, unpaved: false });
    });

    it('avoid_overrides can also RE-ENABLE a class the profile avoids (override wins in both directions)', () => {
      const profile = camper({ avoid: { motorway: true, toll: false, ferry: false, unpaved: false } });
      const body = buildValhallaRouteBody(origin, destination, [], profile, 0, {
        avoidOverrides: { motorway: false },
      });
      expect('use_highways' in body.costing_options.truck).toBe(false);
    });

    it('combines exclude_locations, exclude_polygons, and avoid_overrides in one request', () => {
      const body = buildValhallaRouteBody(origin, destination, [], camper(), 1, {
        excludeLocations: [{ lat: 48.0, lon: 9.0 }],
        excludePolygons: [
          [
            { lat: 48.1, lon: 9.1 },
            { lat: 48.2, lon: 9.1 },
            { lat: 48.2, lon: 9.2 },
          ],
        ],
        avoidOverrides: { unpaved: true },
      });
      expect(body.exclude_locations).toEqual([{ lat: 48.0, lon: 9.0 }]);
      expect(body.exclude_polygons).toEqual([
        [
          [9.1, 48.1],
          [9.1, 48.2],
          [9.2, 48.2],
        ],
      ]);
      expect(body.costing_options.truck.use_tracks).toBe(0);
    });
  });
});

describe('buildTruckCostingOptions with avoidOverrides (E03-T4)', () => {
  function camper(overrides: Partial<VehicleProfile> = {}): VehicleProfile {
    return {
      id: 'p-camper',
      name: 'Alkoven 7.5t',
      height_m: 3.2,
      width_m: 2.35,
      length_m: 7.4,
      weight_t: 7.5,
      avg_speed_kmh: 95,
      hazmat: false,
      avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
      is_active: true,
      dimensions_confirmed_at: null,
      ...overrides,
    };
  }

  it('with no avoidOverrides, behaves exactly like the profile-only mapping', () => {
    const profile = camper({ avoid: { motorway: true, toll: false, ferry: false, unpaved: false } });
    const truck = buildTruckCostingOptions(profile);
    expect(truck.use_highways).toBe(0);
    expect('use_tolls' in truck).toBe(false);
  });

  it('an empty avoidOverrides object also falls back to the profile flags for every key', () => {
    const profile = camper({ avoid: { motorway: false, toll: true, ferry: false, unpaved: false } });
    const truck = buildTruckCostingOptions(profile, {});
    expect(truck.use_tolls).toBe(0);
    expect('use_highways' in truck).toBe(false);
  });
});
