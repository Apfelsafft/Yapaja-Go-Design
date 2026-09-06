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
 *
 * ─── GEFAHRENES GRAU (0.6.3) ────────────────────────────────────────────────
 * Gemeldet: „Die abgefahrene Strecke bleibt weiterhin blau." Die aktive Route
 * geht deshalb als ZWEI Linienobjekte in dieselbe Quelle -- eines mit
 * `part: 'traveled'`, eines mit `part: 'remaining'` --, und die Farbe kommt
 * aus einem Ausdruck auf dieser Eigenschaft.
 *
 * Warum keine eigenen Ebenen dafuer: `DestinationSelector` erkennt einen
 * Fingertipp auf die Route an genau diesen beiden Ebenen-Kennungen
 * (`MAIN_ROUTE_CASING_LAYER_ID`/`..._ACCENT_...`). Neue Ebenen haetten das
 * stillschweigend halbiert -- ein Tipp auf den grauen Teil waere als „neues
 * Ziel" durchgegangen. Das ist derselbe Befund wie ① aus der ersten
 * Rueckmeldung, und er soll nicht ueber eine Farbe wieder hereinkommen.
 *
 * Der Ausdruck faellt bewusst auf BLAU zurueck, wenn die Eigenschaft fehlt:
 * grau heisst „liegt hinter dir", und was noch kommt, darf nie so aussehen.
 */

import { useEffect, useMemo, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { LatLng } from '@yapaja/shared';
import { useMapStore } from '../state/mapStore.js';
import { runWhenStyleReady } from '../map/styleReady.js';
import { useNavStore } from '../drive/navStore.js';
import { isDriveActive } from '../drive/driveActive.js';
import { useRoutingStore, selectActiveRoute, selectAlternativeRoutes } from './store.js';
import { decodePolyline6 } from './polyline.js';
import {
  cumulativeMeters,
  progressFromRemaining,
  splitRouteAtProgress,
  type Coord,
} from './traveledSplit.js';
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

// Bereits gefahren: gedecktes Blaugrau statt des Grau der Alternativen
// (`ALT_COLOR`) -- die beiden bedeuten Verschiedenes und sollen nicht
// dieselbe Farbe tragen. Dazu halbe Deckkraft, damit der Teil hinter dem
// Fahrzeug zurueckweicht, statt mit der Fuehrung um Aufmerksamkeit zu ringen.
const TRAVELED_CASING_COLOR = '#334155'; // slate-700
const TRAVELED_ACCENT_COLOR = '#94A3B8'; // slate-400
const TRAVELED_OPACITY = 0.55;

/** Eigenschaftswert des bereits gefahrenen Linienstuecks. */
const TRAVELED = 'traveled';

/**
 * Farbe/Deckkraft nach `part`. Bewusst `case` mit `==` statt `match`: fehlt
 * die Eigenschaft, ist das Ergebnis der zweite Zweig -- also BLAU. Siehe
 * Kopfkommentar, „im Zweifel blau".
 */
function byPart<T>(traveledValue: T, remainingValue: T): unknown {
  return ['case', ['==', ['get', 'part'], TRAVELED], traveledValue, remainingValue];
}

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
  const navState = useNavStore((state) => state.navState);
  // Incremented whenever the route sources/layers are (re)created, so the
  // geometry effect below immediately paints the CURRENT route into the
  // freshly-added (empty) sources instead of waiting for the next store change.
  const [styleEpoch, setStyleEpoch] = useState(0);

  const activeRoute = useMemo(
    () => selectActiveRoute({ routes, activeRouteId }),
    [routes, activeRouteId],
  );

  // Entschluesseln und Aufsummieren einmal pro Route, nicht einmal pro
  // Positionsmeldung: waehrend der Fahrt laeuft der Fortschritt im
  // Sekundentakt durch, die Geometrie aendert sich dabei nicht.
  const activeGeom = useMemo((): { coords: Coord[]; cumulative: number[] } => {
    if (!activeRoute) return { coords: [], cumulative: [] };
    const coords = decodePolyline6(activeRoute.geometry) as Coord[];
    return { coords, cumulative: cumulativeMeters(coords) };
  }, [activeRoute]);

  // ─── WIE WEIT IST DIE ROUTE GEFAHREN? ──────────────────────────────────────
  // Aus der Restentfernung des Cores, nicht aus einer eigenen Rechnung --
  // die Begruendung steht in `traveledSplit.ts`. `null` (= alles blau) in
  // jedem Fall, in dem die Zahl nicht sicher zu DIESER Linie gehoert:
  //  - es faehrt gerade niemand,
  //  - der Core fuehrt eine ANDERE Route (etwa direkt nach einer
  //    Neuberechnung, bevor die neue Geometrie im Browser angekommen ist) --
  //    ohne diese Abfrage wuerde der Fortschritt der neuen Route auf die
  //    alte Linie angewendet und faerbte dort irgendetwas grau.
  const progressM = useMemo(() => {
    if (!activeRoute || !isDriveActive(navState?.status)) return null;
    if (navState?.route_id !== activeRoute.id) return null;
    const totalM = activeGeom.cumulative[activeGeom.cumulative.length - 1];
    if (totalM === undefined) return null;
    return progressFromRemaining(totalM, navState.distance_remaining_m);
  }, [activeRoute, activeGeom, navState]);

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
      // Beide Ebenen tragen dieselbe Quelle und faerben nach `part` --
      // gefahrenes Stueck grau, kommendes blau (siehe Kopfkommentar).
      map.addLayer({
        id: MAIN_ROUTE_CASING_LAYER_ID,
        type: 'line',
        source: MAIN_ROUTE_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': byPart(TRAVELED_CASING_COLOR, CASING_COLOR) as string,
          'line-opacity': byPart(TRAVELED_OPACITY, 1) as number,
          'line-width': 9,
        },
      });
      map.addLayer({
        id: MAIN_ROUTE_ACCENT_LAYER_ID,
        type: 'line',
        source: MAIN_ROUTE_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': byPart(TRAVELED_ACCENT_COLOR, ACCENT_COLOR) as string,
          'line-opacity': byPart(TRAVELED_OPACITY, 1) as number,
          'line-width': 5,
        },
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

  // ─── DIE AKTIVE ROUTE, IN ZWEI STUECKEN ────────────────────────────────────
  // Eigener Effekt, weil dieser als einziger im Sekundentakt laeuft: der
  // Fortschritt aendert sich mit jeder Positionsmeldung. Alles andere
  // (Alternativen, Nadeln, Meide-Flaechen) haengt nur am Routen-Speicher und
  // soll deshalb nicht bei jeder Meldung neu geschrieben werden.
  useEffect(() => {
    if (!map) return;
    void styleEpoch; // Dependency-only trigger, siehe unten.
    const mainSource = getGeoJSONSource(map, MAIN_ROUTE_SOURCE_ID);
    if (!mainSource) return;

    const { traveled, remaining } = splitRouteAtProgress(
      activeGeom.coords,
      activeGeom.cumulative,
      progressM,
    );

    const stueck = (
      part: 'traveled' | 'remaining',
      coordinates: Coord[],
    ): Record<string, unknown> | null =>
      // Unter zwei Punkten gibt es keine Linie zu zeichnen.
      coordinates.length < 2
        ? null
        : {
            type: 'Feature',
            properties: { part },
            geometry: { type: 'LineString', coordinates },
          };

    // Reihenfolge: gefahren zuerst, damit die Fuehrung an der Trennstelle
    // oben liegt.
    const features = [stueck(TRAVELED, traveled), stueck('remaining', remaining)].filter(
      (feature): feature is Record<string, unknown> => feature !== null,
    );

    mainSource.setData({ type: 'FeatureCollection', features });
  }, [map, activeGeom, progressM, styleEpoch]);

  // Update route/marker geometry whenever the routing store changes.
  useEffect(() => {
    if (!map) return;
    // Dependency-only trigger: re-run right after the sources are (re)created.
    void styleEpoch;
    const altSource = getGeoJSONSource(map, ALT_ROUTE_SOURCE_ID);
    const markersSource = getGeoJSONSource(map, MARKERS_SOURCE_ID);
    const avoidSource = getGeoJSONSource(map, AVOID_POLYGONS_SOURCE_ID);
    // Sources not added yet (style still loading) -- the setup effect's
    // `load` handler will run this same data once it finishes; nothing to
    // do here yet.
    if (!altSource || !markersSource || !avoidSource) return;

    avoidSource.setData({
      type: 'FeatureCollection',
      features: tempAvoidances.map((avoidance) => ({
        type: 'Feature',
        properties: { avoidanceId: avoidance.id },
        geometry: { type: 'Polygon', coordinates: [ringToGeoJson(avoidance.polygon)] },
      })),
    });

    const alternativeRoutes = selectAlternativeRoutes({ routes, activeRouteId });

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
      if (activeGeom.coords.length > 0) {
        markerFeatures.push({ type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: activeGeom.coords[0] } });
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
  }, [map, routes, activeRouteId, activeRoute, activeGeom, destination, startPoint, tempAvoidances, styleEpoch]);

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
