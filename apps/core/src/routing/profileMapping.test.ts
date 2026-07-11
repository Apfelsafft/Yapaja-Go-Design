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
});
