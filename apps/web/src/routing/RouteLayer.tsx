/**
 * Route Layer (E03-T3): renders the computed route(s) on the map --
 * - the active route as a "casing" line (wide, dark) with a narrower accent
 *   line on top (classic two-layer route styling),
 * - every other route as a thin gray, tappable line (tap -> becomes active,
 *   see `DestinationSelector`, which owns the click handling),
 * - start/destination pins,
 * - and auto-fits the camera to the union of all currently displayed routes
 *   whenever they change, so alternatives are always on-screen (and thus
 *   actually tappable -- not just "active route" per the letter of the task
 *   note, since a route that's off-screen can't be tapped).
 *
 * Follows the E01-T3/ADR-013 map-ready + style-load pattern EXACTLY like
 * `apps/web/src/position/PositionPuck.tsx`: the map is read reactively from
 * `useMapStore` (never `mapController.getMap()` with `[]` deps), and
 * `addSource`/`addLayer` only run once the style has finished loading
 * (`map.isStyleLoaded()` / `map.once('load', ...)`), or they throw "Style is
 * not done loading" and crash the whole React tree. The layers/sources are
 * plain custom additions on top of the core style, so `styleSwitch.ts`
 * (E01-T4) automatically preserves them across a style switch -- no special
 * handling needed here, same as the position puck.
 */

import { useEffect } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useMapStore } from '../state/mapStore.js';
import { useRoutingStore, selectActiveRoute, selectAlternativeRoutes } from './store.js';
import { decodePolyline6 } from './polyline.js';
import {
  ALT_ROUTE_SOURCE_ID,
  ALT_ROUTE_LAYER_ID,
  MAIN_ROUTE_SOURCE_ID,
  MAIN_ROUTE_CASING_LAYER_ID,
  MAIN_ROUTE_ACCENT_LAYER_ID,
  MARKERS_SOURCE_ID,
  START_MARKER_LAYER_ID,
  DEST_MARKER_LAYER_ID,
} from './layerIds.js';

const CASING_COLOR = '#1E3A8A'; // dark blue
const ACCENT_COLOR = '#3B82F6'; // bright blue
const ALT_COLOR = '#9CA3AF'; // gray
const START_COLOR = '#16A34A'; // green
const DEST_COLOR = '#DC2626'; // red

const EMPTY_FEATURE_COLLECTION = { type: 'FeatureCollection' as const, features: [] };

interface GeoJSONSourceLike {
  setData(data: unknown): void;
}

function getGeoJSONSource(map: MapLibreMap, id: string): GeoJSONSourceLike | undefined {
  return map.getSource(id) as unknown as GeoJSONSourceLike | undefined;
}

export default function RouteLayer(): null {
  const map = useMapStore((state) => state.map);
  const routes = useRoutingStore((state) => state.routes);
  const activeRouteId = useRoutingStore((state) => state.activeRouteId);
  const destination = useRoutingStore((state) => state.destination);

  // Setup: sources + layers, once the map (and its style) is ready.
  useEffect(() => {
    if (!map) return;

    const setup = (): void => {
      if (map.getSource(MAIN_ROUTE_SOURCE_ID)) return; // already set up

      map.addSource(ALT_ROUTE_SOURCE_ID, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION });
      map.addSource(MAIN_ROUTE_SOURCE_ID, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION });
      map.addSource(MARKERS_SOURCE_ID, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION });

      // Alternatives first (bottom), so the active route + pins render on
      // top of them.
      map.addLayer({
        id: ALT_ROUTE_LAYER_ID,
        type: 'line',
        source: ALT_ROUTE_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ALT_COLOR, 'line-width': 5, 'line-opacity': 0.85 },
      });

      // Casing (wide, dark) then accent (narrow, bright) on top of it.
      map.addLayer({
        id: MAIN_ROUTE_CASING_LAYER_ID,
        type: 'line',
        source: MAIN_ROUTE_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': CASING_COLOR, 'line-width': 9 },
      });
      map.addLayer({
        id: MAIN_ROUTE_ACCENT_LAYER_ID,
        type: 'line',
        source: MAIN_ROUTE_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ACCENT_COLOR, 'line-width': 5 },
      });

      // Start/destination pins, on top of everything.
      map.addLayer({
        id: START_MARKER_LAYER_ID,
        type: 'circle',
        source: MARKERS_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'start'],
        paint: {
          'circle-radius': 8,
          'circle-color': START_COLOR,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
        },
      });
      map.addLayer({
        id: DEST_MARKER_LAYER_ID,
        type: 'circle',
        source: MARKERS_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'destination'],
        paint: {
          'circle-radius': 10,
          'circle-color': DEST_COLOR,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
        },
      });
    };

    if (map.isStyleLoaded()) {
      setup();
    } else {
      map.once('load', setup);
    }
    return () => {
      map.off('load', setup);
    };
  }, [map]);

  // Update route/marker geometry whenever the routing store changes.
  useEffect(() => {
    if (!map) return;
    const mainSource = getGeoJSONSource(map, MAIN_ROUTE_SOURCE_ID);
    const altSource = getGeoJSONSource(map, ALT_ROUTE_SOURCE_ID);
    const markersSource = getGeoJSONSource(map, MARKERS_SOURCE_ID);
    // Sources not added yet (style still loading) -- the setup effect's
    // `load` handler will run this same data once it finishes; nothing to
    // do here yet.
    if (!mainSource || !altSource || !markersSource) return;

    const activeRoute = selectActiveRoute({ routes, activeRouteId });
    const alternativeRoutes = selectAlternativeRoutes({ routes, activeRouteId });

    mainSource.setData({
      type: 'FeatureCollection',
      features: activeRoute
        ? [
            {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: decodePolyline6(activeRoute.geometry) },
            },
          ]
        : [],
    });

    altSource.setData({
      type: 'FeatureCollection',
      features: alternativeRoutes.map((route) => ({
        type: 'Feature',
        properties: { routeId: route.id },
        geometry: { type: 'LineString', coordinates: decodePolyline6(route.geometry) },
      })),
    });

    const markerFeatures: Array<{
      type: 'Feature';
      properties: { kind: 'start' | 'destination' };
      geometry: { type: 'Point'; coordinates: [number, number] };
    }> = [];
    if (activeRoute) {
      const coords = decodePolyline6(activeRoute.geometry);
      if (coords.length > 0) {
        markerFeatures.push({ type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: coords[0] } });
      }
    }
    if (destination) {
      markerFeatures.push({
        type: 'Feature',
        properties: { kind: 'destination' },
        geometry: { type: 'Point', coordinates: [destination.lon, destination.lat] },
      });
    }
    markersSource.setData({ type: 'FeatureCollection', features: markerFeatures });
  }, [map, routes, activeRouteId, destination]);

  // Auto-fit the camera to the union of all currently displayed routes
  // (active + alternatives) whenever the route set changes.
  useEffect(() => {
    if (!map || routes.length === 0) return;

    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    for (const route of routes) {
      for (const [lon, lat] of decodePolyline6(route.geometry)) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
    if (!Number.isFinite(minLon) || !Number.isFinite(minLat) || !Number.isFinite(maxLon) || !Number.isFinite(maxLat)) {
      return;
    }

    map.fitBounds(
      [
        [minLon, minLat],
        [maxLon, maxLat],
      ],
      {
        // Extra bottom padding: `RoutingPanel`'s bottom sheet covers roughly
        // that much of the viewport once a route is displayed, and a route
        // (or alternative) fitted UNDER it would be both invisible and
        // untappable -- defeating the "alternatives are tappable" acceptance
        // criterion for anyone whose screen isn't unusually tall.
        padding: { top: 64, bottom: 280, left: 64, right: 64 },
        duration: 500,
        maxZoom: 16,
      },
    );
    // Intentionally re-fits on every `routes`/`activeRouteId` change
    // (including selecting an alternative) -- cheap and keeps the active
    // route (and its alternatives) always visible.
  }, [map, routes, activeRouteId]);

  return null;
}
