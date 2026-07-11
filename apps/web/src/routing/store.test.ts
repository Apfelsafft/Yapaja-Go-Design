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
  });
});
