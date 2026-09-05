/**
 * Zwischenziele waehrend der laufenden Fahrt aendern.
 *
 * ─── WARUM ES DIESE DATEI GIBT ──────────────────────────────────────────────
 * Der Browser-Test dazu (`apps/web/e2e/waypoints.spec.ts`) ist in CI
 * zweimal rot geworden und lokal nie -- der Unterschied war reines Timing.
 * Die Ursache: `updateWaypoints` braucht einen Ausgangspunkt, und
 * `lastPosition` ist direkt nach `start()` noch `null`. Der Status steht da
 * aber schon auf `navigating`; wer darauf wartet, wartet auf das Falsche.
 *
 * Ein Timing-Fall gehoert nicht in einen Browser-Test, wo er von der Last der
 * Maschine abhaengt. Hier laeuft die Uhr kontrolliert, und die Reihenfolge
 * laesst sich genau festlegen.
 *
 * Harness und Stil wie `profileChangeReroute.test.ts` -- dieselbe Maschinerie
 * wird ja auch benutzt.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { LatLng, Position, Route, RouteRequest, VehicleProfile } from '@yapaja/shared';
import { EventBus } from '../bus/index.js';
import {
  NavigationService,
  type ActiveProfileLookup,
  type RerouteProvider,
  type RouteProvider,
} from './service.js';
import { encodePolyline6 } from '../routing/polyline.js';
import { haversineM, type LatLon } from './geo.js';

const BASE_LAT = 47.0;
const BASE_LON = 9.5;

function straightNorthPoints(startLat: number, lon: number, count: number, stepDeg = 0.001): LatLon[] {
  const pts: LatLon[] = [];
  for (let i = 0; i < count; i++) pts.push({ lat: startLat + i * stepDeg, lon });
  return pts;
}

function makeRoute(points: LatLon[], id: string): Route {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineM(points[i - 1], points[i]);
  return {
    id,
    distance_m: total,
    duration_s: total / 15,
    geometry: encodePolyline6(points),
    legs: [{ index: 0, distance_m: total, duration_s: total / 15 }],
    maneuvers: [
      {
        index: 0,
        type: 'continue',
        instruction: 'Depart',
        street_names: [],
        distance_m: total,
        begin_shape_index: 0,
      },
    ],
    speed_limits: [],
    warnings: [],
  };
}

function pos(lat: number, lon: number): Position {
  return {
    lat,
    lon,
    alt: null,
    speed: 15,
    heading: 0,
    accuracy: 5,
    source: 'simulator',
    fix: '3d',
    ts: new Date(Date.now()).toISOString(),
  };
}

const PROFILE: VehicleProfile = {
  id: 'pA',
  name: 'Camper',
  height_m: 2.5,
  width_m: 2.1,
  length_m: 6.0,
  weight_t: 3.0,
  avg_speed_kmh: 85,
  hazmat: false,
  avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
  is_active: true,
  dimensions_confirmed_at: null,
};

/** Eine Station weit vorn auf der Strecke. */
const WP_VORN: LatLng = { lat: BASE_LAT + 0.012, lon: BASE_LON };
/** Eine Station HINTER dem Fahrzeug. */
const WP_HINTEN: LatLng = { lat: BASE_LAT + 0.001, lon: BASE_LON };

describe('Zwischenziele waehrend der Fahrt', () => {
  let bus: EventBus;
  let originalRoute: Route;
  let events: Record<string, unknown[]>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T10:00:00.000Z'));
    bus = new EventBus({ isProduction: false });
    events = {};
    for (const topic of ['route/updated', 'event/reroute_failed']) {
      bus.subscribe(topic, (p) => {
        (events[topic] ??= []).push(p);
      });
    }
    originalRoute = makeRoute(straightNorthPoints(BASE_LAT, BASE_LON, 19), 'orig');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeNav(provider: RerouteProvider): NavigationService {
    const routeProvider: RouteProvider = {
      getCachedRoute: (id) => (id === originalRoute.id ? originalRoute : null),
    };
    const profileProvider: ActiveProfileLookup = {
      getActive: () => PROFILE,
      getById: () => PROFILE,
    };
    return new NavigationService({
      bus,
      routeProvider,
      rerouteProvider: provider,
      profileProvider,
      clientPresence: { hasConnectedClients: () => true },
    });
  }

  /**
   * Ein typisierter Mock fuer `RerouteProvider.createRoutes`.
   *
   * Ohne die Signatur waeren `mock.calls[0][0]` fuer TypeScript ein leeres
   * Tupel -- die Zusicherungen ueber die ANGEFRAGTEN Zwischenziele liessen
   * sich dann nur mit einem Cast schreiben, und ein Cast haelt nichts fest.
   */
  function rerouteMock(newRoute: Route): ReturnType<typeof vi.fn<[RouteRequest], Promise<Route[]>>> {
    return vi.fn<[RouteRequest], Promise<Route[]>>(() => Promise.resolve([newRoute]));
  }

  async function feed(nav: NavigationService, p: Position): Promise<void> {
    void nav;
    bus.publish('pos/update', p);
    await vi.advanceTimersByTimeAsync(1000);
  }

  it('berechnet die Strecke neu und meldet den Grund', async () => {
    const newRoute = makeRoute(straightNorthPoints(47.005, BASE_LON, 10), 'mit-station');
    const createRoutes = rerouteMock(newRoute);
    const nav = makeNav({ createRoutes });

    nav.start({ route: originalRoute, reroute: { profile_id: 'pA' } });
    await feed(nav, pos(BASE_LAT + 0.001, BASE_LON));
    expect(nav.getStatus()).toBe('navigating');

    nav.updateWaypoints([WP_VORN]);
    await vi.advanceTimersByTimeAsync(10);

    expect(createRoutes).toHaveBeenCalledTimes(1);
    expect(createRoutes.mock.calls[0][0].waypoints).toEqual([WP_VORN]);
    // Eigener Grund: das ist keine Abweichung und kein Profilwechsel, sondern
    // ein ausdruecklicher Wunsch. Wer die Ereignisse liest, soll das sehen.
    expect(events['route/updated']).toEqual([{ reason: 'waypoints', route_id: 'mit-station' }]);
  });

  it('die Fahrt laeuft weiter -- sie wird nicht beendet und neu begonnen', async () => {
    // `start()` waere aus `navigating` gar nicht erlaubt (409) und wuerde
    // Kalibrierung und Ansagestand wegwerfen. Ein sichtbarer Aussetzer mitten
    // auf der Strecke.
    const newRoute = makeRoute(straightNorthPoints(47.005, BASE_LON, 10), 'r2');
    const nav = makeNav({ createRoutes: rerouteMock(newRoute) });

    nav.start({ route: originalRoute, reroute: { profile_id: 'pA' } });
    await feed(nav, pos(BASE_LAT + 0.001, BASE_LON));

    nav.updateWaypoints([WP_VORN]);
    await vi.advanceTimersByTimeAsync(10);

    expect(nav.getStatus()).toBe('navigating');
  });

  describe('wenn noch keine Position eingetroffen ist', () => {
    it('geht der Wunsch nicht verloren, sondern wird beim ersten Fix nachgeholt', async () => {
      // ─── GENAU DER FALL, AN DEM DER BROWSER-TEST IN CI SCHEITERTE ────────
      // Nach `start()` steht der Status schon auf `navigating`, es gibt aber
      // noch keinen Positionsfix -- und ohne Ausgangspunkt laesst sich nicht
      // rechnen. Vorher passierte hier stillschweigend gar nichts: die Liste
      // stand in der Oberflaeche, gefahren wurde die alte Strecke.
      const newRoute = makeRoute(straightNorthPoints(47.005, BASE_LON, 10), 'nachgeholt');
      const createRoutes = rerouteMock(newRoute);
      const nav = makeNav({ createRoutes });

      nav.start({ route: originalRoute, reroute: { profile_id: 'pA' } });
      expect(nav.getStatus()).toBe('navigating'); // schon jetzt -- das ist die Falle

      nav.updateWaypoints([WP_VORN]);
      await vi.advanceTimersByTimeAsync(10);
      expect(createRoutes, 'ohne Position darf noch nicht gerechnet werden').not.toHaveBeenCalled();

      // Erster Fix -- jetzt gibt es einen Ausgangspunkt.
      await feed(nav, pos(BASE_LAT + 0.001, BASE_LON));
      await vi.advanceTimersByTimeAsync(10);

      expect(createRoutes).toHaveBeenCalledTimes(1);
      expect(createRoutes.mock.calls[0][0].waypoints).toEqual([WP_VORN]);
    });

    it('eine vertagte Absicht leckt nicht in die naechste Fahrt', async () => {
      const createRoutes = rerouteMock(makeRoute(straightNorthPoints(47.005, BASE_LON, 10), 'r2'));
      const nav = makeNav({ createRoutes });

      nav.start({ route: originalRoute, reroute: { profile_id: 'pA' } });
      nav.updateWaypoints([WP_VORN]); // vertagt, nie ausgefuehrt
      nav.stop();

      nav.start({ route: originalRoute, reroute: { profile_id: 'pA' } });
      await feed(nav, pos(BASE_LAT + 0.001, BASE_LON));
      await vi.advanceTimersByTimeAsync(10);

      // Die neue Fahrt hat mit der alten Absicht nichts zu tun.
      expect(createRoutes).not.toHaveBeenCalled();
    });
  });

  describe('eine Station HINTER dem Fahrzeug', () => {
    it('bleibt erhalten -- wer zurueck zur Tankstelle will, meint das', async () => {
      // Die Bereinigung „schon passiert" misst den Fortschritt auf der ALTEN
      // Strecke. Ohne Ausnahme fuer die ausdrueckliche Aenderung waere ein
      // solcher Punkt sofort wieder verschwunden.
      const newRoute = makeRoute(straightNorthPoints(47.005, BASE_LON, 10), 'zurueck');
      const createRoutes = rerouteMock(newRoute);
      const nav = makeNav({ createRoutes });

      nav.start({ route: originalRoute, reroute: { profile_id: 'pA' } });
      // Deutlich HINTER WP_HINTEN vorbeigefahren.
      await feed(nav, pos(BASE_LAT + 0.008, BASE_LON));

      nav.updateWaypoints([WP_HINTEN]);
      await vi.advanceTimersByTimeAsync(10);

      expect(createRoutes).toHaveBeenCalledTimes(1);
      expect(createRoutes.mock.calls[0][0].waypoints).toEqual([WP_HINTEN]);
    });
  });

  describe('bei einer AUTOMATISCHEN Neuberechnung', () => {
    it('faellt weg, was schon passiert ist', async () => {
      // Der Fehler, der das alles ausgeloest hat: der Vermerk „E04-T5 prunes
      // visited ones" stand da, die Bereinigung gab es nicht. Wer an einer
      // Station vorbei war und falsch abbog, wurde zurueckgeschickt.
      const newRoute = makeRoute(straightNorthPoints(47.02, BASE_LON, 10), 'abweichung');
      const createRoutes = rerouteMock(newRoute);
      const nav = makeNav({ createRoutes });

      nav.start({
        route: originalRoute,
        reroute: { profile_id: 'pA', waypoints: [WP_HINTEN, WP_VORN] },
      });
      // Weit an WP_HINTEN vorbei, WP_VORN liegt noch voraus.
      await feed(nav, pos(BASE_LAT + 0.008, BASE_LON));

      // Kraeftig neben die Route -- das loest die Abweichungs-Neuberechnung
      // aus. Die Breite bleibt dabei bewusst DEUTLICH unter WP_VORN
      // (0.012): faehrt man beim Abweichen daran vorbei, ist es zu Recht
      // abgehakt, und der Test pruefte etwas anderes als er behauptet. Genau
      // dieser Fehler steckte in der ersten Fassung.
      for (let i = 0; i < 6; i++) {
        await feed(nav, pos(BASE_LAT + 0.0085 + i * 0.0001, BASE_LON + 0.01));
      }
      await vi.advanceTimersByTimeAsync(50);

      expect(createRoutes, 'die Abweichung haette eine Neuberechnung ausloesen muessen').toHaveBeenCalled();
      const angefragt = createRoutes.mock.calls[createRoutes.mock.calls.length - 1][0].waypoints;
      expect(angefragt).toEqual([WP_VORN]); // WP_HINTEN ist abgehakt
    });
  });
});
