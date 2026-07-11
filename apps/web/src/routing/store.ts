/**
 * Zustand store for routing (E03-T3): the selected destination, the
 * computed route(s), and which one is currently "active" (the highlighted
 * main route vs. the tappable gray alternatives).
 *
 * E03-T4 additions (avoidances & temporary lockouts):
 *  - `avoidOverrides`: the 4 avoid-chip flags, overriding the active
 *    profile's `avoid.*` for the CURRENT route only (never written back to
 *    the profile). Scoped "per route": reset whenever a new destination is
 *    picked (`setDestination`) or the flow is cancelled (`clear`) -- see the
 *    task's "PRO ROUTE" wording for the chips, vs. "PRO SESSION" below.
 *  - `tempAvoidances`: "Diesen Abschnitt meiden" polygons, collected over
 *    the whole app session (survive `setDestination`/`clear`, per the task's
 *    explicit "PRO SESSION" wording), shown as a manageable list and
 *    individually removable.
 * Both `toggleAvoidOverride` and `addSectionAvoidance`/`removeAvoidance`
 * immediately trigger a reroute (by delegating to `requestRoute`, which
 * already reads `avoidOverrides`/`tempAvoidances` off this same store), so
 * every mutation is a single source of truth for what the NEXT request
 * looks like.
 */

import { create } from 'zustand';
import type { LatLng, Route, RouteAvoidOverrides } from '@yapaja/shared';
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

/** A single "Diesen Abschnitt meiden" temporary avoidance (E03-T4). */
export interface TempAvoidance {
  /** Client-generated, stable for the lifetime of the session -- used as the React key and for individual removal. */
  id: string;
  /** Closed ring of LatLng points (app-internal `{lat, lon}` order; the Core swaps to Valhalla's `[lon, lat]`). */
  polygon: LatLng[];
}

export interface RoutingState {
  destination: LatLng | null;
  routes: Route[];
  activeRouteId: string | null;
  status: RoutingStatus;
  error: RoutingError | null;
  /** Per-request avoid-flag overrides (E03-T4), see the file-level doc comment. */
  avoidOverrides: RouteAvoidOverrides;
  /** Session-scoped "meide diesen Abschnitt" polygons (E03-T4). */
  tempAvoidances: TempAvoidance[];

  /** Sets (or clears, with `null`) the selected destination. Always resets any previous route result and the per-route avoid overrides. */
  setDestination: (destination: LatLng | null) => void;
  /** Requests routes for the current `destination`, including any active `avoidOverrides`/`tempAvoidances`. No-ops (no request sent) if there is no destination or no `profileId`. */
  requestRoute: (params: RequestRouteParams) => Promise<void>;
  /** Makes `routeId` the active (highlighted) route; the previously-active one becomes a gray alternative. No-ops if `routeId` isn't among the current `routes`. */
  selectRoute: (routeId: string) => void;
  /** Clears the destination and any route result (e.g. "Abbrechen"/"Neues Ziel wählen"). Does NOT clear `tempAvoidances` (session-scoped). */
  clear: () => void;
  /** Toggles one avoid flag against its current EFFECTIVE value (`avoidOverrides[flag] ?? profileDefault`) and immediately reroutes with `params`. */
  toggleAvoidOverride: (
    flag: keyof RouteAvoidOverrides,
    profileDefault: boolean,
    params: RequestRouteParams,
  ) => void;
  /** Adds a temporary avoidance polygon and immediately reroutes with `params`. */
  addSectionAvoidance: (polygon: LatLng[], params: RequestRouteParams) => void;
  /** Removes a temporary avoidance by id and immediately reroutes with `params`. */
  removeAvoidance: (id: string, params: RequestRouteParams) => void;
}

function nextAvoidanceId(): string {
  return `avoid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useRoutingStore = create<RoutingState>((set, get) => ({
  destination: null,
  routes: [],
  activeRouteId: null,
  status: 'idle',
  error: null,
  avoidOverrides: {},
  tempAvoidances: [],

  setDestination: (destination) => {
    set({ destination, routes: [], activeRouteId: null, status: 'idle', error: null, avoidOverrides: {} });
  },

  requestRoute: async ({ origin, profileId }) => {
    const { destination, avoidOverrides, tempAvoidances } = get();
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
      const excludePolygons = tempAvoidances.map((a) => a.polygon);
      const routes = await client.requestRoutes({
        origin,
        destination,
        waypoints: [],
        profile_id: profileId,
        alternatives: 2,
        // Only attach these when non-empty, so a request with no
        // avoidances is byte-for-byte identical to the pre-E03-T4 shape.
        ...(Object.keys(avoidOverrides).length > 0 ? { avoid_overrides: avoidOverrides } : {}),
        ...(excludePolygons.length > 0 ? { exclude_polygons: excludePolygons } : {}),
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
    set({ destination: null, routes: [], activeRouteId: null, status: 'idle', error: null, avoidOverrides: {} });
  },

  toggleAvoidOverride: (flag, profileDefault, params) => {
    const { avoidOverrides } = get();
    const effective = avoidOverrides[flag] ?? profileDefault;
    set({ avoidOverrides: { ...avoidOverrides, [flag]: !effective } });
    void get().requestRoute(params);
  },

  addSectionAvoidance: (polygon, params) => {
    const { tempAvoidances } = get();
    set({ tempAvoidances: [...tempAvoidances, { id: nextAvoidanceId(), polygon }] });
    void get().requestRoute(params);
  },

  removeAvoidance: (id, params) => {
    const { tempAvoidances } = get();
    set({ tempAvoidances: tempAvoidances.filter((a) => a.id !== id) });
    void get().requestRoute(params);
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
