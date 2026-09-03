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
 * `addSource`/`addLayer` only run once the style will accept them (E10-T1:
 * via `map/styleReady.ts#runWhenStyleReady` -- the previous
 * `isStyleLoaded()` / `once('load', ...)` guard lost the race whenever this
 * passive effect first ran after `load` had already fired, which left the
 * route line permanently unrendered; see that module for the full
 * root-cause write-up), or they throw "Style is
 * not done loading" and crash the whole React tree. The layers/sources are
 * plain custom additions on top of the core style, so `styleSwitch.ts`
 * (E01-T4) automatically preserves them across a style switch -- no special
 * handling needed here, same as the position puck.
 *
 * E03-T4: also renders the session's temporary "Diesen Abschnitt meiden"
 * avoidance polygons (semi-transparent red fill + outline) so the user can
 * see what's currently excluded. Added in the SAME `setup()` (same
 * style-load guard) as the route/marker sources -- a second, independent
 * `addSource`/`addLayer` call site would reintroduce exactly the "Style is
 * not done loading" trap this file's pattern exists to avoid.
 */

import { useEffect, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { LatLng } from '@yapaja/shared';
import { useMapStore } from '../state/mapStore.js';
import { runWhenStyleReady } from '../map/styleReady.js';
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
  AVOID_POLYGONS_SOURCE_ID,
  AVOID_POLYGONS_FILL_LAYER_ID,
  AVOID_POLYGONS_OUTLINE_LAYER_ID,
} from './layerIds.js';

const CASING_COLOR = '#1E3A8A'; // dark blue
const ACCENT_COLOR = '#3B82F6'; // bright blue
const ALT_COLOR = '#9CA3AF'; // gray
const START_COLOR = '#16A34A'; // green
const DEST_COLOR = '#DC2626'; // red
const AVOID_COLOR = '#DC2626'; // red, matches the destination pin for "danger/excluded"

/** App-internal `{lat, lon}` ring -> GeoJSON `[lon, lat]` ring, closed. */
function ringToGeoJson(ring: readonly LatLng[]): [number, number][] {
  return ring.map((p): [number, number] => [p.lon, p.lat]);
}

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
  const startPoint = useRoutingStore((state) => state.startPoint);
  const tempAvoidances = useRoutingStore((state) => state.tempAvoidances);
  // Incremented whenever the route sources/layers are (re)created, so the
  // geometry effect below immediately paints the CURRENT route into the
  // freshly-added (empty) sources instead of waiting for the next store change.
  const [styleEpoch, setStyleEpoch] = useState(0);

  // Setup: sources + layers, once the map (and its style) is ready.
  useEffect(() => {
    if (!map) return;

    const setup = (): void => {
      if (map.getSource(MAIN_ROUTE_SOURCE_ID)) return; // already set up

      map.addSource(ALT_ROUTE_SOURCE_ID, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION });
      map.addSource(MAIN_ROUTE_SOURCE_ID, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION });
      map.addSource(MARKERS_SOURCE_ID, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION });
      map.addSource(AVOID_POLYGONS_SOURCE_ID, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION });

      // Avoidance polygons at the very bottom, so routes/markers always
      // render on top of them.
      map.addLayer({
        id: AVOID_POLYGONS_FILL_LAYER_ID,
        type: 'fill',
        source: AVOID_POLYGONS_SOURCE_ID,
        paint: { 'fill-color': AVOID_COLOR, 'fill-opacity': 0.2 },
      });
      map.addLayer({
        id: AVOID_POLYGONS_OUTLINE_LAYER_ID,
        type: 'line',
        source: AVOID_POLYGONS_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': AVOID_COLOR, 'line-width': 2, 'line-dasharray': [2, 1] },
      });

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

      // Sources were just created empty -- trigger the geometry effect below
      // so the current route is painted right away (E10-T1).
      setStyleEpoch((epoch) => epoch + 1);
    };

    return runWhenStyleReady(map, setup);
  }, [map]);

  // Update route/marker geometry whenever the routing store changes.
  useEffect(() => {
    if (!map) return;
    // Dependency-only trigger: re-run right after the sources are (re)created.
    void styleEpoch;
    const mainSource = getGeoJSONSource(map, MAIN_ROUTE_SOURCE_ID);
    const altSource = getGeoJSONSource(map, ALT_ROUTE_SOURCE_ID);
    const markersSource = getGeoJSONSource(map, MARKERS_SOURCE_ID);
    const avoidSource = getGeoJSONSource(map, AVOID_POLYGONS_SOURCE_ID);
    // Sources not added yet (style still loading) -- the setup effect's
    // `load` handler will run this same data once it finishes; nothing to
    // do here yet.
    if (!mainSource || !altSource || !markersSource || !avoidSource) return;

    avoidSource.setData({
      type: 'FeatureCollection',
      features: tempAvoidances.map((avoidance) => ({
        type: 'Feature',
        properties: { avoidanceId: avoidance.id },
        geometry: { type: 'Polygon', coordinates: [ringToGeoJson(avoidance.polygon)] },
      })),
    });

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
    } else if (startPoint) {
      // Ein AUSDRUECKLICH gewaehlter Startpunkt muss schon sichtbar sein,
      // BEVOR eine Route existiert -- sonst waehlt man auf der Karte einen
      // Punkt und sieht nicht, welchen. Sobald eine Route da ist, zeigt deren
      // erster Stuetzpunkt ohnehin denselben Ort, und der ist genauer (er
      // liegt auf der Strasse, nicht dort, wo der Finger hingetippt hat).
      markerFeatures.push({
        type: 'Feature',
        properties: { kind: 'start' },
        geometry: { type: 'Point', coordinates: [startPoint.lon, startPoint.lat] },
      });
    }
    if (destination) {
      markerFeatures.push({
        type: 'Feature',
        properties: { kind: 'destination' },
        geometry: { type: 'Point', coordinates: [destination.lon, destination.lat] },
      });
    }
    markersSource.setData({ type: 'FeatureCollection', features: markerFeatures });
  }, [map, routes, activeRouteId, destination, startPoint, tempAvoidances, styleEpoch]);

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
