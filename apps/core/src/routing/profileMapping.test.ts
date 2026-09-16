/**
 * 🔴 W-08 SAFETY-CORE unit tests: profile -> Valhalla truck costing.
 * Every field that gates physical edge traversal is asserted exactly.
 */

import { describe, it, expect } from 'vitest';
import type { LatLng, RouteMode, VehicleProfile } from '@yapaia/shared';
import {
  buildTruckCostingOptions,
  buildValhallaRouteBody,
  valhallaSprache,
  VALHALLA_VORGABE_USE_HIGHWAYS,
} from './profileMapping.js';

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
    expect(truck.hazmat).toBe(true);
  });

  // ─── DIE ZUSICHERUNG, DIE DEN FEHLER FESTGESCHRIEBEN HAT ─────────────────
  // Hier stand `expect(truck.top_speed).toBe(95)`. Sie war die ganze Zeit
  // gruen, waehrend „schnellste" die Autobahn mied: die EINHEIT stimmte
  // (beides km/h), also sah die Zusicherung richtig aus. Geprueft wurde
  // damit aber nur, dass eine Zahl ankommt -- nicht, ob sie dort etwas
  // bedeutet. Die Begruendung steht in `profileMapping.ts`.
  it('schickt KEIN top_speed — die Reisegeschwindigkeit ist keine Hoechstgeschwindigkeit', () => {
    const truck = buildTruckCostingOptions(camper());
    expect('top_speed' in truck).toBe(false);
  });

  it('schickt auch dann keins, wenn die Reisegeschwindigkeit hoch ist', () => {
    // Sonst liesse sich der Fehler dadurch „beheben", dass er nur bei
    // kleinen Werten auftritt. Er haengt nicht am Wert, sondern am Feld.
    const truck = buildTruckCostingOptions(camper({ avg_speed_kmh: 130 }));
    expect('top_speed' in truck).toBe(false);
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
    expect(body.directions_options).toEqual({ units: 'kilometers', language: 'de-DE' });
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

describe('die Sprache der Manoevertexte', () => {
  // ─── DER GEMELDETE FEHLER ───────────────────────────────────────────────
  // „Der Text der naechsten Anweisung ist auf Englisch." Im Dashboard stand
  // „Enter the roundabout and take the 2nd exit onto B 44." Die Anfrage
  // schickte `units`, aber keine Sprache -- und ohne Angabe antwortet Valhalla
  // in en-US.
  it('steht auch ohne Einstellung auf Deutsch, nicht auf Valhallas en-US', () => {
    expect(valhallaSprache(undefined)).toBe('de-DE');
    expect(valhallaSprache(null)).toBe('de-DE');
    expect(valhallaSprache('')).toBe('de-DE');
  });

  it('folgt der Einstellung, wenn sie auf Englisch steht', () => {
    expect(valhallaSprache('en')).toBe('en-US');
  });

  it('faellt bei einem unbekannten Wert auf Deutsch zurueck', () => {
    // Ein unerwarteter Wert darf nicht dazu fuehren, dass Valhalla wieder
    // seine eigene Vorgabe waehlt -- das waere genau der gemeldete Zustand.
    expect(valhallaSprache('kli')).toBe('de-DE');
  });

  it('landet wirklich im Anfragekoerper', () => {
    const body = buildValhallaRouteBody(
      { lat: 47, lon: 9 },
      { lat: 48, lon: 9.5 },
      [],
      camper(),
      0,
      undefined,
      undefined,
      'en',
    );
    expect(body.directions_options.language).toBe('en-US');
  });
});

describe('wonach gesucht wird (schnellste / kuerzeste / ausgewogen)', () => {
  it('schnellste ist die Vorgabe und setzt gar nichts', () => {
    // Valhallas eigene Vorgabe ist die kuerzeste Fahrzeit. Wer hier etwas
    // setzt, aendert sie -- also wird hier nichts gesetzt.
    const o = buildTruckCostingOptions(camper(), undefined, 'fastest');
    expect(o.shortest).toBeUndefined();
    expect(o.use_highways).toBeUndefined();
  });

  it('kuerzeste rechnet nach Entfernung', () => {
    expect(buildTruckCostingOptions(camper(), undefined, 'shortest').shortest).toBe(true);
  });

  // ─── DIE ZWEITE ZUSICHERUNG, DIE NICHTS GEPRUEFT HAT ────────────────────
  // Hier stand `toBe(0.5)`. Auch sie war gruen -- und wirkungslos, denn 0.5
  // ist Valhallas VORGABE (`kDefaultUseHighways` in `truckcost.cc`).
  // „Ausgewogen" und „Schnellste" lieferten dieselbe Route. Die Zusicherung
  // hat den eingetragenen Wert bestaetigt, statt eine Wirkung zu pruefen.
  it('ausgewogen nimmt Autobahnen weniger gern als „schnellste"', () => {
    const o = buildTruckCostingOptions(camper(), undefined, 'balanced');
    expect(o.use_highways).toBe(0.25);
    expect(o.shortest).toBeUndefined();
  });

  it('ausgewogen liegt UNTER Valhallas Vorgabe, sonst waere es wirkungslos', () => {
    // Die eigentliche Aussage. Sie haelt auch dann noch, wenn der Wert
    // spaeter feiner eingestellt wird -- und sie faellt sofort um, wenn
    // jemand wieder auf die Vorgabe zurueckdreht.
    const o = buildTruckCostingOptions(camper(), undefined, 'balanced');
    expect(o.use_highways).toBeLessThan(VALHALLA_VORGABE_USE_HIGHWAYS);
  });

  it('schnellste ueberlaesst Valhalla die Wahl und setzt use_highways gar nicht', () => {
    const o = buildTruckCostingOptions(camper(), undefined, 'fastest');
    expect('use_highways' in o).toBe(false);
    expect(o.shortest).toBeUndefined();
  });

  it('die drei Betriebsarten sind unterscheidbar', () => {
    // Der Fehler war NICHT, dass eine Betriebsart falsch rechnete, sondern
    // dass zwei davon dasselbe taten. Genau das prueft diese Zusicherung.
    const abdruck = (m: RouteMode): string =>
      JSON.stringify([
        buildTruckCostingOptions(camper(), undefined, m).use_highways ?? null,
        buildTruckCostingOptions(camper(), undefined, m).shortest ?? null,
      ]);
    const alle = [abdruck('fastest'), abdruck('balanced'), abdruck('shortest')];
    expect(new Set(alle).size).toBe(3);
  });

  // ─── DIE FALLE ──────────────────────────────────────────────────────────
  // „Ausgewogen" senkt `use_highways` auf 0.5. Wer Autobahnen im Profil
  // MEIDET, hat dort eine 0 stehen -- aus einem „meiden" wuerde sonst ein
  // „ein bisschen meiden", und zwar still.
  it('weicht ein „Autobahn meiden" NICHT auf', () => {
    const meidend = camper({ avoid: { motorway: true, toll: false, ferry: false, unpaved: false } });
    expect(buildTruckCostingOptions(meidend, undefined, 'balanced').use_highways).toBe(0);
  });

  it('gilt das auch fuer die Vermeidung nur fuer diese Anfrage', () => {
    const o = buildTruckCostingOptions(camper(), { motorway: true }, 'balanced');
    expect(o.use_highways).toBe(0);
  });

  it('die Masse gelten in JEDER Betriebsart unveraendert', () => {
    // Die Wahl entscheidet, welche ERLAUBTE Route genommen wird -- nie, ob
    // eine verbotene erlaubt wird. Das ist der Punkt, an dem ein Fehler hier
    // gefaehrlich waere statt nur aergerlich.
    for (const mode of ['fastest', 'shortest', 'balanced'] as const) {
      const o = buildTruckCostingOptions(camper(), undefined, mode);
      expect(o.height, mode).toBe(3.2);
      expect(o.width, mode).toBe(2.35);
      expect(o.length, mode).toBe(7.4);
      expect(o.weight, mode).toBe(7.5);
    }
  });

  it('landet im Anfragekoerper', () => {
    const body = buildValhallaRouteBody(
      { lat: 47, lon: 9 },
      { lat: 48, lon: 9.5 },
      [],
      camper(),
      0,
      undefined,
      undefined,
      undefined,
      'shortest',
    );
    expect(body.costing_options.truck.shortest).toBe(true);
  });
});
