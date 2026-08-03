/**
 * Position Puck Component (E02-T2, extended E02-T5 for W-01 GPS-loss UX)
 *
 * Displays the current position on the map as a GeoJSON layer with:
 * - Blue dot at the center (or gray if accuracy > 100m, stale, extrapolated,
 *   or the GPS signal is lost)
 * - Accuracy ring (radius = accuracy in meters), which grows over time while
 *   the signal is lost to visualize increasing positional uncertainty
 * - Heading wedge when heading is available
 *
 * Implements W-01 and W-02 requirements:
 * - Gray puck if accuracy > 100m with "inaccurate" hint
 * - Gray puck if last fix is older than 5 seconds
 * - Gray puck + growing accuracy ring while the GPS signal is lost (W-01)
 * - Smooth (not hard-snapping) color/ring transitions on recovery, via
 *   MapLibre paint-property transitions -- never a "teleport flicker"
 */

import { useEffect, useState } from 'react';
import { usePosition, usePositionConnected, usePositionExtrapolated, usePositionStore } from './positionStore';
import { useGpsSignalState } from './gpsSignal';
import { useMapStore } from '../state/mapStore';
import { runWhenStyleReady } from '../map/styleReady';

const STALE_POSITION_MS = 5000; // 5 seconds
const INACCURACY_THRESHOLD_M = 100; // 100 meters

const LIVE_COLOR = '#3B82F6'; // blue
const LOST_COLOR = '#9CA3AF'; // gray

// MapLibre paint-property transitions (`<property>-transition`): color/ring
// changes (e.g. gray -> blue on GPS recovery) animate instead of snapping,
// so returning fixes never read as a hard "teleport flicker" (W-01 AC2).
const PAINT_TRANSITION = { duration: 600, delay: 0 };

// While the signal is lost, the accuracy ring grows over (wall-clock) time
// to visualize increasing positional uncertainty (W-01: "wachsender
// Genauigkeitsring"). This is a purely visual growth, independent of
// DeadReckoningController's provider -- with the noop provider (default
// until E04-T6 ships route-based extrapolation) the puck's *position* stays
// frozen; only the ring grows.
const RING_GROWTH_M_PER_S = 5;
const MAX_DISPLAY_ACCURACY_M = 500;

// Re-render tick so time-based state (staleness, ring growth) updates even
// without a new position arriving.
const RERENDER_TICK_MS = 1000;

interface PuckState {
  sourceId: 'position-puck-source';
  layerId: 'position-puck-layer';
}

const PUCK_STATE: PuckState = {
  sourceId: 'position-puck-source',
  layerId: 'position-puck-layer',
};

export default function PositionPuck(): null {
  const position = usePosition();
  const isConnected = usePositionConnected();
  const extrapolated = usePositionExtrapolated();
  const signalState = useGpsSignalState();
  const lastRealUpdateTime = usePositionStore((state) => state.lastRealUpdateTime);
  // Reactive to the live Map instance (not `mapController.getMap()` with `[]`
  // deps) -- the map may not be registered yet at mount time, see the
  // E01-T3 map-ready trap called out in E02-T5's task notes.
  const map = useMapStore((state) => state.map);
  const [tick, setTick] = useState(0);
  // Incremented whenever the puck source/layers are (re)created, so the
  // geometry effect below repaints the current position right away.
  const [styleEpoch, setStyleEpoch] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => setTick((t) => t + 1), RERENDER_TICK_MS);
    return () => window.clearInterval(interval);
  }, []);

  // Setup GeoJSON source and layers once the map is ready.
  useEffect(() => {
    if (!map) return;

    // `MapView` registers the Map in the store right after `new
    // maplibregl.Map(...)` -- i.e. BEFORE the style has finished loading. So
    // this reactive `[map]` effect can fire while the style is still loading,
    // and calling `addSource`/`addLayer` then throws "Style is not done
    // loading" (which, uncaught in render-effect scope, crashes the whole
    // React tree -> blank page).
    //
    // E10-T1: readiness is delegated to `runWhenStyleReady` -- the previous
    // `isStyleLoaded() ? setup() : map.once('load', setup)` guard silently
    // lost the race when this passive effect first ran AFTER `load` had
    // already fired, leaving the puck permanently absent. See
    // `map/styleReady.ts` for the full root-cause write-up. `setup` is
    // idempotent (the `getSource` early-return below), as that helper requires.
    const setup = (): void => {
      if (map.getSource(PUCK_STATE.sourceId)) return;

      map.addSource(PUCK_STATE.sourceId, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });

      // Accuracy ring layer (semi-transparent circle). Added FIRST (no
      // beforeId) so it sits *below* the puck dot added next -- appending it
      // with `beforeId: 'position-puck-layer'` (as before) silently failed
      // with "Cannot add layer ... before non-existing layer" because the dot
      // layer doesn't exist yet at this point, so the ring never rendered.
      map.addLayer({
        id: `${PUCK_STATE.layerId}-ring`,
        type: 'circle',
        source: PUCK_STATE.sourceId,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': ['get', 'accuracy-pixels'],
          'circle-color': ['get', 'ring-color'],
          'circle-opacity': 0.2,
          'circle-stroke-width': 1,
          'circle-stroke-color': ['get', 'ring-color'],
          'circle-stroke-opacity': 0.4,
          'circle-radius-transition': PAINT_TRANSITION,
          'circle-color-transition': PAINT_TRANSITION,
          'circle-stroke-color-transition': PAINT_TRANSITION,
        },
      });

      // Main puck circle (dot), on top of the ring.
      map.addLayer({
        id: PUCK_STATE.layerId,
        type: 'circle',
        source: PUCK_STATE.sourceId,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 8,
          'circle-color': ['get', 'puck-color'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
          'circle-stroke-opacity': 1,
          'circle-color-transition': PAINT_TRANSITION,
        },
      });

      // Heading wedge (line from center in heading direction)
      map.addLayer({
        id: `${PUCK_STATE.layerId}-heading`,
        type: 'line',
        source: PUCK_STATE.sourceId,
        filter: ['!=', ['get', 'heading'], null],
        paint: {
          'line-color': ['get', 'puck-color'],
          'line-width': 2,
          'line-opacity': 0.7,
          'line-color-transition': PAINT_TRANSITION,
        },
      });

      // The layers were just (re)created empty. Bump the epoch so the
      // geometry effect below re-runs and paints the CURRENT position
      // immediately, instead of waiting for the next incoming fix.
      setStyleEpoch((epoch) => epoch + 1);
    };

    return runWhenStyleReady(map, setup);
  }, [map]);

  // Update puck geometry and appearance when position or signal state changes.
  useEffect(() => {
    if (!map || !position) return;
    // `tick`/`styleEpoch` are intentionally unused in the body -- they're
    // dependency-only triggers so this effect recomputes staleness/ring-growth
    // on the periodic tick above (not just when `position` changes), and
    // repaints immediately after the layers are (re)created.
    void tick;
    void styleEpoch;

    const now = Date.now();
    const isStale = now - (position.ts ? new Date(position.ts).getTime() : 0) > STALE_POSITION_MS;
    const isInaccurate = position.accuracy !== null && position.accuracy > INACCURACY_THRESHOLD_M;
    const isLost = signalState === 'lost' || extrapolated;
    const shouldBeGray = isLost || isStale || isInaccurate || !isConnected;

    const puckColor = shouldBeGray ? LOST_COLOR : LIVE_COLOR;
    const ringColor = shouldBeGray ? LOST_COLOR : LIVE_COLOR;

    const elapsedLostS =
      isLost && lastRealUpdateTime !== null ? Math.max(0, now - lastRealUpdateTime) / 1000 : 0;
    const ringGrowthM = Math.min(MAX_DISPLAY_ACCURACY_M, elapsedLostS * RING_GROWTH_M_PER_S);
    const displayAccuracyM = (position.accuracy ?? 0) + (isLost ? ringGrowthM : 0);

    // Convert accuracy (meters) to pixels at current zoom level
    const zoom = map.getZoom();
    const metersPerPixel = 40075000 / (256 * Math.pow(2, zoom)); // Rough approximation
    const accuracyPixels = displayAccuracyM / metersPerPixel;

    // Build heading line (from center, 20px in heading direction)
    const headingGeometry = position.heading !== null
      ? {
          type: 'LineString' as const,
          coordinates: [
            [position.lon, position.lat],
            getHeadingEndpoint(position.lon, position.lat, position.heading, 20 / metersPerPixel),
          ],
        }
      : null;

    interface GeoJSONFeature {
      type: 'Feature';
      geometry: {
        type: 'Point' | 'LineString';
        coordinates: Array<number | number[]>;
      };
      properties: Record<string, unknown>;
    }

    const features: GeoJSONFeature[] = [
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [position.lon, position.lat],
        },
        properties: {
          'puck-color': puckColor,
          'ring-color': ringColor,
          'accuracy-pixels': accuracyPixels,
          heading: position.heading,
        },
      },
    ];

    if (headingGeometry) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: headingGeometry.coordinates as Array<number[]>,
        },
        properties: {
          'puck-color': puckColor,
          heading: position.heading,
        },
      });
    }

    const source = map.getSource(PUCK_STATE.sourceId) as unknown as { setData(data: unknown): void } | undefined;
    source?.setData({
      type: 'FeatureCollection',
      features,
    });
  }, [map, position, isConnected, extrapolated, signalState, lastRealUpdateTime, tick, styleEpoch]);

  return null;
}

/**
 * Calculate endpoint of heading line given a distance in meters
 */
function getHeadingEndpoint(
  lon: number,
  lat: number,
  headingDegrees: number,
  distanceMeters: number,
): [number, number] {
  // Convert to radians
  const headingRad = (headingDegrees * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;

  // Earth radius in meters
  const R = 6371000;

  // Calculate new position
  const dLat = Math.cos(headingRad) * (distanceMeters / R);
  const dLon = (Math.sin(headingRad) * (distanceMeters / R)) / Math.cos(latRad);

  const newLat = lat + (dLat * 180) / Math.PI;
  const newLon = lon + (dLon * 180) / Math.PI;

  return [newLon, newLat];
}
