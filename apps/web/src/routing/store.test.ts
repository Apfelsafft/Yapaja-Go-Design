import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Route } from '@yapaja/shared';

vi.mock('./client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client.js')>();
  return {
    ...actual,
    requestRoutes: vi.fn(),
  };
});

import { useRoutingStore, selectActiveRoute, selectAlternativeRoutes } from './store.js';
import * as client from './client.js';
import { RoutingApiError } from './client.js';

const requestRoutesMock = client.requestRoutes as unknown as ReturnType<typeof vi.fn>;

function makeRoute(id: string, overrides: Partial<Route> = {}): Route {
  return {
    id,
    distance_m: 1000,
    duration_s: 60,
    geometry: '??',
    legs: [],
    maneuvers: [],
    speed_limits: [],
    warnings: [],
    ...overrides,
  };
}

const INITIAL_STATE = {
  destination: null,
  routes: [],
  activeRouteId: null,
  status: 'idle' as const,
  error: null,
  avoidOverrides: {},
  tempAvoidances: [],
};

describe('routing store', () => {
  beforeEach(() => {
    useRoutingStore.setState(INITIAL_STATE);
    requestRoutesMock.mockReset();
  });

  describe('selectRoute: alternative selection swaps active/gray', () => {
    it('makes the tapped alternative active and moves the previous active route to the alternatives', () => {
      const routeA = makeRoute('a');
      const routeB = makeRoute('b');
      useRoutingStore.setState({ routes: [routeA, routeB], activeRouteId: 'a', status: 'success' });

      expect(selectActiveRoute(useRoutingStore.getState())?.id).toBe('a');
      expect(selectAlternativeRoutes(useRoutingStore.getState()).map((r) => r.id)).toEqual(['b']);

      useRoutingStore.getState().selectRoute('b');

      expect(useRoutingStore.getState().activeRouteId).toBe('b');
      expect(selectActiveRoute(useRoutingStore.getState())?.id).toBe('b');
      expect(selectAlternativeRoutes(useRoutingStore.getState()).map((r) => r.id)).toEqual(['a']);
    });

    it('ignores a routeId that is not among the current routes', () => {
      const routeA = makeRoute('a');
      useRoutingStore.setState({ routes: [routeA], activeRouteId: 'a', status: 'success' });

      useRoutingStore.getState().selectRoute('does-not-exist');

      expect(useRoutingStore.getState().activeRouteId).toBe('a');
    });
  });

  describe('setDestination', () => {
    it('resets any previous route result when a new destination is picked', () => {
      useRoutingStore.setState({
        destination: { lat: 1, lon: 1 },
        routes: [makeRoute('a')],
        activeRouteId: 'a',
        status: 'success',
      });

      useRoutingStore.getState().setDestination({ lat: 2, lon: 2 });

      const state = useRoutingStore.getState();
      expect(state.destination).toEqual({ lat: 2, lon: 2 });
      expect(state.routes).toEqual([]);
      expect(state.activeRouteId).toBeNull();
      expect(state.status).toBe('idle');
    });

    it('resets avoidOverrides (per-route) but keeps tempAvoidances (per-session) on a new destination', () => {
      const avoidance = { id: 'avoid-1', polygon: [{ lat: 1, lon: 1 }] };
      useRoutingStore.setState({
        avoidOverrides: { toll: true },
        tempAvoidances: [avoidance],
      });

      useRoutingStore.getState().setDestination({ lat: 3, lon: 3 });

      const state = useRoutingStore.getState();
      expect(state.avoidOverrides).toEqual({});
      expect(state.tempAvoidances).toEqual([avoidance]);
    });
  });

  describe('requestRoute', () => {
    it('sends no request and stays idle when there is no destination', async () => {
      await useRoutingStore.getState().requestRoute({ origin: 'current', profileId: 'profile-1' });

      expect(requestRoutesMock).not.toHaveBeenCalled();
      expect(useRoutingStore.getState().status).toBe('idle');
    });

    it('sends no request and surfaces a clear error when there is no active profile', async () => {
      useRoutingStore.setState({ destination: { lat: 49.0, lon: 8.4 } });

      await useRoutingStore.getState().requestRoute({ origin: 'current', profileId: undefined });

      expect(requestRoutesMock).not.toHaveBeenCalled();
      const state = useRoutingStore.getState();
      expect(state.status).toBe('error');
      expect(state.error?.code).toBe('NO_ACTIVE_PROFILE');
    });

    it('requests with origin/destination/profile_id/alternatives=2 and stores the result, active = first route', async () => {
      const destination = { lat: 49.0, lon: 8.4 };
      const routeA = makeRoute('a');
      const routeB = makeRoute('b');
      requestRoutesMock.mockResolvedValue([routeA, routeB]);
      useRoutingStore.setState({ destination });

      await useRoutingStore.getState().requestRoute({ origin: 'current', profileId: 'profile-1' });

      expect(requestRoutesMock).toHaveBeenCalledWith({
        origin: 'current',
        destination,
        waypoints: [],
        profile_id: 'profile-1',
        alternatives: 2,
      });
      const state = useRoutingStore.getState();
      expect(state.status).toBe('success');
      expect(state.routes).toEqual([routeA, routeB]);
      expect(state.activeRouteId).toBe('a');
      expect(state.error).toBeNull();
    });

    it('surfaces a RoutingApiError (e.g. 409 NO_POSITION) as a typed error, clearing any stale routes', async () => {
      useRoutingStore.setState({ destination: { lat: 49.0, lon: 8.4 } });
      requestRoutesMock.mockRejectedValue(new RoutingApiError('NO_POSITION', 'No current position available'));

      await useRoutingStore.getState().requestRoute({ origin: 'current', profileId: 'profile-1' });

      const state = useRoutingStore.getState();
      expect(state.status).toBe('error');
      expect(state.error).toEqual({ code: 'NO_POSITION', message: 'No current position available' });
      expect(state.routes).toEqual([]);
      expect(state.activeRouteId).toBeNull();
    });

    it('surfaces an empty result array as an error (no routes found)', async () => {
      useRoutingStore.setState({ destination: { lat: 49.0, lon: 8.4 } });
      requestRoutesMock.mockResolvedValue([]);

      await useRoutingStore.getState().requestRoute({ origin: 'current', profileId: 'profile-1' });

      const state = useRoutingStore.getState();
      expect(state.status).toBe('error');
      expect(state.error?.code).toBe('NO_ROUTES');
    });

    // E03-T4: the request payload picks up whatever avoidOverrides/
    // tempAvoidances are currently on the store, but ONLY attaches the keys
    // when non-empty -- proving the schema's backward compatibility isn't
    // just theoretical, the client actually omits the new fields by default.
    it('attaches avoid_overrides to the request payload when set', async () => {
      const destination = { lat: 49.0, lon: 8.4 };
      requestRoutesMock.mockResolvedValue([makeRoute('a')]);
      useRoutingStore.setState({ destination, avoidOverrides: { toll: true, motorway: false } });

      await useRoutingStore.getState().requestRoute({ origin: 'current', profileId: 'profile-1' });

      expect(requestRoutesMock).toHaveBeenCalledWith({
        origin: 'current',
        destination,
        waypoints: [],
        profile_id: 'profile-1',
        alternatives: 2,
        avoid_overrides: { toll: true, motorway: false },
      });
    });

    it('attaches exclude_polygons to the request payload from tempAvoidances when set', async () => {
      const destination = { lat: 49.0, lon: 8.4 };
      const polygon = [
        { lat: 49.001, lon: 8.401 },
        { lat: 49.002, lon: 8.401 },
        { lat: 49.002, lon: 8.402 },
      ];
      requestRoutesMock.mockResolvedValue([makeRoute('a')]);
      useRoutingStore.setState({ destination, tempAvoidances: [{ id: 'avoid-1', polygon }] });

      await useRoutingStore.getState().requestRoute({ origin: 'current', profileId: 'profile-1' });

      expect(requestRoutesMock).toHaveBeenCalledWith({
        origin: 'current',
        destination,
        waypoints: [],
        profile_id: 'profile-1',
        alternatives: 2,
        exclude_polygons: [polygon],
      });
    });
  });

  describe('toggleAvoidOverride (E03-T4 avoid chips)', () => {
    it('flips the effective flag (profile default -> override) and triggers a reroute with avoid_overrides', async () => {
      const destination = { lat: 49.0, lon: 8.4 };
      requestRoutesMock.mockResolvedValue([makeRoute('a')]);
      useRoutingStore.setState({ destination });

      useRoutingStore.getState().toggleAvoidOverride('toll', false, { origin: 'current', profileId: 'profile-1' });
      // The action's reroute is async (fire-and-forget); flush microtasks.
      await Promise.resolve();
      await Promise.resolve();

      expect(useRoutingStore.getState().avoidOverrides).toEqual({ toll: true });
      expect(requestRoutesMock).toHaveBeenCalledWith(
        expect.objectContaining({ avoid_overrides: { toll: true } }),
      );
    });

    it('toggling again flips back to the (explicit) opposite value', async () => {
      const destination = { lat: 49.0, lon: 8.4 };
      requestRoutesMock.mockResolvedValue([makeRoute('a')]);
      useRoutingStore.setState({ destination, avoidOverrides: { toll: true } });

      useRoutingStore.getState().toggleAvoidOverride('toll', false, { origin: 'current', profileId: 'profile-1' });
      await Promise.resolve();
      await Promise.resolve();

      expect(useRoutingStore.getState().avoidOverrides).toEqual({ toll: false });
    });

    it('does not reroute (no-op reroute call) when there is no destination', async () => {
      useRoutingStore.getState().toggleAvoidOverride('motorway', false, {
        origin: 'current',
        profileId: 'profile-1',
      });
      await Promise.resolve();

      expect(useRoutingStore.getState().avoidOverrides).toEqual({ motorway: true });
      expect(requestRoutesMock).not.toHaveBeenCalled();
    });
  });

  describe('addSectionAvoidance / removeAvoidance ("Diesen Abschnitt meiden", E03-T4)', () => {
    const polygon = [
      { lat: 49.001, lon: 8.401 },
      { lat: 49.002, lon: 8.401 },
      { lat: 49.002, lon: 8.402 },
      { lat: 49.001, lon: 8.401 },
    ];

    it('adds a temporary avoidance and triggers a reroute including it as exclude_polygons', async () => {
      const destination = { lat: 49.0, lon: 8.4 };
      requestRoutesMock.mockResolvedValue([makeRoute('a')]);
      useRoutingStore.setState({ destination });

      useRoutingStore.getState().addSectionAvoidance(polygon, { origin: 'current', profileId: 'profile-1' });
      await Promise.resolve();
      await Promise.resolve();

      const state = useRoutingStore.getState();
      expect(state.tempAvoidances).toHaveLength(1);
      expect(state.tempAvoidances[0].polygon).toEqual(polygon);
      expect(requestRoutesMock).toHaveBeenCalledWith(
        expect.objectContaining({ exclude_polygons: [polygon] }),
      );
    });

    it('removing the last avoidance triggers a reroute WITHOUT exclude_polygons in the payload', async () => {
      const destination = { lat: 49.0, lon: 8.4 };
      requestRoutesMock.mockResolvedValue([makeRoute('a')]);
      useRoutingStore.setState({ destination, tempAvoidances: [{ id: 'avoid-1', polygon }] });

      useRoutingStore.getState().removeAvoidance('avoid-1', { origin: 'current', profileId: 'profile-1' });
      await Promise.resolve();
      await Promise.resolve();

      expect(useRoutingStore.getState().tempAvoidances).toEqual([]);
      const lastCall = requestRoutesMock.mock.calls.at(-1)?.[0];
      expect(lastCall).not.toHaveProperty('exclude_polygons');
    });

    it('removing one of several avoidances keeps the rest and reroutes with the remainder', async () => {
      const destination = { lat: 49.0, lon: 8.4 };
      const otherPolygon = [
        { lat: 50, lon: 10 },
        { lat: 50.001, lon: 10 },
        { lat: 50.001, lon: 10.001 },
      ];
      requestRoutesMock.mockResolvedValue([makeRoute('a')]);
      useRoutingStore.setState({
        destination,
        tempAvoidances: [
          { id: 'avoid-1', polygon },
          { id: 'avoid-2', polygon: otherPolygon },
        ],
      });

      useRoutingStore.getState().removeAvoidance('avoid-1', { origin: 'current', profileId: 'profile-1' });
      await Promise.resolve();
      await Promise.resolve();

      const state = useRoutingStore.getState();
      expect(state.tempAvoidances.map((a) => a.id)).toEqual(['avoid-2']);
      expect(requestRoutesMock).toHaveBeenCalledWith(
        expect.objectContaining({ exclude_polygons: [otherPolygon] }),
      );
    });

    it('ignores removal of an unknown id (no-op, still reroutes with the unchanged list)', async () => {
      const destination = { lat: 49.0, lon: 8.4 };
      requestRoutesMock.mockResolvedValue([makeRoute('a')]);
      useRoutingStore.setState({ destination, tempAvoidances: [{ id: 'avoid-1', polygon }] });

      useRoutingStore.getState().removeAvoidance('does-not-exist', {
        origin: 'current',
        profileId: 'profile-1',
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(useRoutingStore.getState().tempAvoidances).toHaveLength(1);
    });
  });

  // Documented invariant (not enforced by store logic -- Valhalla decides
  // actual route costs): a route computed WITH an avoidance must never have
  // a shorter duration than the same route WITHOUT it. This test exercises
  // the store/UI plumbing with two mocked responses standing in for
  // "before" and "after" a section is avoided, and asserts the mocked data
  // satisfies the invariant end-to-end through the store.
  describe('plausibility: avoidance duration is never shorter (documented invariant)', () => {
    it('the route duration after adding an avoidance is >= the duration before', async () => {
      const destination = { lat: 49.0, lon: 8.4 };
      const baseline = makeRoute('base', { duration_s: 600 });
      const rerouted = makeRoute('rerouted', { duration_s: 720 });
      requestRoutesMock.mockResolvedValueOnce([baseline]).mockResolvedValueOnce([rerouted]);
      useRoutingStore.setState({ destination });

      await useRoutingStore.getState().requestRoute({ origin: 'current', profileId: 'profile-1' });
      const baselineDuration = useRoutingStore.getState().routes[0].duration_s;

      useRoutingStore.getState().addSectionAvoidance(
        [
          { lat: 49.001, lon: 8.401 },
          { lat: 49.002, lon: 8.401 },
          { lat: 49.002, lon: 8.402 },
        ],
        { origin: 'current', profileId: 'profile-1' },
      );
      await Promise.resolve();
      await Promise.resolve();
      const reroutedDuration = useRoutingStore.getState().routes[0].duration_s;

      expect(reroutedDuration).toBeGreaterThanOrEqual(baselineDuration);
    });
  });

  describe('clear', () => {
    it('resets destination, routes, and status', () => {
      useRoutingStore.setState({
        destination: { lat: 1, lon: 1 },
        routes: [makeRoute('a')],
        activeRouteId: 'a',
        status: 'success',
        error: null,
      });

      useRoutingStore.getState().clear();

      expect(useRoutingStore.getState()).toMatchObject(INITIAL_STATE);
    });

    it('keeps tempAvoidances across clear (session-scoped)', () => {
      const avoidance = { id: 'avoid-1', polygon: [{ lat: 1, lon: 1 }] };
      useRoutingStore.setState({
        destination: { lat: 1, lon: 1 },
        tempAvoidances: [avoidance],
      });

      useRoutingStore.getState().clear();

      expect(useRoutingStore.getState().tempAvoidances).toEqual([avoidance]);
    });
  });

  describe('ausdruecklich gewaehlter Startpunkt (Start/Ziel-Eingabe)', () => {
    // Bis 2026-09-03 konnte die Oberflaeche NUR ein Ziel setzen; der Start war
    // zwangsweise die Live-GPS-Position. Wer keine Position hatte -- etwa weil
    // der Browser den Sensor ohne HTTPS nicht freigibt -- konnte damit keine
    // einzige Route berechnen, obwohl Karte und Routinggraph fertig waren.
    // Der Core konnte einen expliziten Startpunkt seit jeher; es fehlte allein
    // die Bedienung.

    it('ohne gesetzten Startpunkt geht weiterhin "current" an den Core', async () => {
      useRoutingStore.getState().setDestination({ lat: 47.1, lon: 9.5 });
      await useRoutingStore.getState().requestRoute({ origin: 'current', profileId: 'profile-1' });
      expect(requestRoutesMock).toHaveBeenCalledWith(
        expect.objectContaining({ origin: 'current' }),
      );
    });

    it('ein gesetzter Startpunkt wird statt "current" gesendet', async () => {
      useRoutingStore.getState().setDestination({ lat: 47.1, lon: 9.5 });
      useRoutingStore.getState().setStartPoint({ lat: 47.14, lon: 9.52 });
      await useRoutingStore.getState().requestRoute({ origin: 'current', profileId: 'profile-1' });
      expect(requestRoutesMock).toHaveBeenCalledWith(
        expect.objectContaining({ origin: { lat: 47.14, lon: 9.52 } }),
      );
    });

    it('der Startpunkt gilt auch fuer Aufrufer, die "current" uebergeben', async () => {
      // Das ist der Punkt, an dem es leicht auseinanderlaeuft: „zu diesem
      // Favoriten navigieren" uebergibt fest `'current'`. Ohne Vorrang haette
      // die Wahl des Betreibers je nach Einstiegspunkt gegolten oder nicht.
      useRoutingStore.getState().setDestination({ lat: 47.2, lon: 9.6 });
      useRoutingStore.getState().setStartPoint({ lat: 47.05, lon: 9.47 });
      await useRoutingStore.getState().requestRoute({ origin: 'current', profileId: 'profile-1' });
      expect(requestRoutesMock).toHaveBeenCalledWith(
        expect.objectContaining({ origin: { lat: 47.05, lon: 9.47 } }),
      );
    });

    it('Zuruecksetzen auf null fuehrt wieder zur GPS-Position', async () => {
      useRoutingStore.getState().setDestination({ lat: 47.1, lon: 9.5 });
      useRoutingStore.getState().setStartPoint({ lat: 47.14, lon: 9.52 });
      useRoutingStore.getState().setStartPoint(null);
      await useRoutingStore.getState().requestRoute({ origin: 'current', profileId: 'profile-1' });
      expect(requestRoutesMock).toHaveBeenCalledWith(
        expect.objectContaining({ origin: 'current' }),
      );
    });

    it('ein neuer Startpunkt verwirft das alte Ergebnis', () => {
      // Sonst zeigt die Karte eine Route, die von woanders losfaehrt als das,
      // was in der Oberflaeche als Start steht.
      useRoutingStore.setState({
        routes: [{ id: 'r1' } as never],
        activeRouteId: 'r1',
        status: 'success',
      });
      useRoutingStore.getState().setStartPoint({ lat: 47.14, lon: 9.52 });
      expect(useRoutingStore.getState().routes).toEqual([]);
      expect(useRoutingStore.getState().activeRouteId).toBeNull();
    });
  });
});
