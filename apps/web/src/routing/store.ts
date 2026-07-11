/**
 * Zustand store for routing (E03-T3): the selected destination, the
 * computed route(s), and which one is currently "active" (the highlighted
 * main route vs. the tappable gray alternatives).
 */

import { create } from 'zustand';
import type { LatLng, Route } from '@yapaja/shared';
import * as client from './client.js';
import { RoutingApiError } from './client.js';

export type RoutingStatus = 'idle' | 'loading' | 'success' | 'error';

export interface RoutingError {
  code: string;
  message: string;
}

export interface RequestRouteParams {
  /** Always `'current'` in this app -- the Core resolves it via the live GPS position. */
  origin: LatLng | 'current';
  /** `activeProfile.id`, or `undefined`/empty if no profile is active. */
  profileId: string | undefined;
}

export interface RoutingState {
  destination: LatLng | null;
  routes: Route[];
  activeRouteId: string | null;
  status: RoutingStatus;
  error: RoutingError | null;

  /** Sets (or clears, with `null`) the selected destination. Always resets any previous route result. */
  setDestination: (destination: LatLng | null) => void;
  /** Requests routes for the current `destination`. No-ops (no request sent) if there is no destination or no `profileId`. */
  requestRoute: (params: RequestRouteParams) => Promise<void>;
  /** Makes `routeId` the active (highlighted) route; the previously-active one becomes a gray alternative. No-ops if `routeId` isn't among the current `routes`. */
  selectRoute: (routeId: string) => void;
  /** Clears the destination and any route result (e.g. "Abbrechen"/"Neues Ziel wählen"). */
  clear: () => void;
}

export const useRoutingStore = create<RoutingState>((set, get) => ({
  destination: null,
  routes: [],
  activeRouteId: null,
  status: 'idle',
  error: null,

  setDestination: (destination) => {
    set({ destination, routes: [], activeRouteId: null, status: 'idle', error: null });
  },

  requestRoute: async ({ origin, profileId }) => {
    const { destination } = get();
    if (!destination) {
      return;
    }
    if (!profileId) {
      set({
        status: 'error',
        error: { code: 'NO_ACTIVE_PROFILE', message: 'Kein aktives Fahrzeugprofil ausgewählt.' },
        routes: [],
        activeRouteId: null,
      });
      return;
    }

    set({ status: 'loading', error: null });
    try {
      const routes = await client.requestRoutes({
        origin,
        destination,
        waypoints: [],
        profile_id: profileId,
        alternatives: 2,
      });
      if (routes.length === 0) {
        set({
          routes: [],
          activeRouteId: null,
          status: 'error',
          error: { code: 'NO_ROUTES', message: 'Keine Route gefunden.' },
        });
        return;
      }
      set({ routes, activeRouteId: routes[0].id, status: 'success', error: null });
    } catch (err) {
      if (err instanceof RoutingApiError) {
        set({ status: 'error', error: { code: err.code, message: err.message }, routes: [], activeRouteId: null });
      } else {
        set({
          status: 'error',
          error: { code: 'UNKNOWN', message: 'Route konnte nicht berechnet werden.' },
          routes: [],
          activeRouteId: null,
        });
      }
    }
  },

  selectRoute: (routeId) => {
    const { routes } = get();
    if (!routes.some((r) => r.id === routeId)) {
      return;
    }
    set({ activeRouteId: routeId });
  },

  clear: () => {
    set({ destination: null, routes: [], activeRouteId: null, status: 'idle', error: null });
  },
}));

export type RouteSelectionState = Pick<RoutingState, 'routes' | 'activeRouteId'>;

/** The currently active (highlighted) route, or `null` if none. */
export function selectActiveRoute(state: RouteSelectionState): Route | null {
  return state.routes.find((r) => r.id === state.activeRouteId) ?? null;
}

/** All routes other than the active one (rendered gray, tappable). */
export function selectAlternativeRoutes(state: RouteSelectionState): Route[] {
  return state.routes.filter((r) => r.id !== state.activeRouteId);
}

declare global {
  interface Window {
    /**
     * Debug/E2E hook, mirrors `window.__yapajaMapController` /
     * `window.__yapajaPositionStore`: exposes the routing store so
     * Playwright can assert on `activeRouteId`/`status` directly.
     * Production code must still go through `useRoutingStore`.
     */
    __yapajaRoutingStore?: typeof useRoutingStore;
  }
}

if (typeof window !== 'undefined') {
  window.__yapajaRoutingStore = useRoutingStore;
}
