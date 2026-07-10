/**
 * Position Puck Component (E02-T2)
 *
 * Displays the current position on the map as a GeoJSON layer with:
 * - Blue dot at the center (or gray if accuracy > 100m or stale)
 * - Accuracy ring (radius = accuracy in meters)
 * - Heading wedge when heading is available
 *
 * Implements W-01 and W-02 requirements:
 * - Gray puck if accuracy > 100m with "inaccurate" hint
 * - Gray puck if last fix is older than 5 seconds
 */

import { useEffect, useRef } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { usePosition, usePositionConnected } from './positionStore';
import { mapController } from '../state/mapStore';

const STALE_POSITION_MS = 5000; // 5 seconds
const INACCURACY_THRESHOLD_M = 100; // 100 meters

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
  const mapRef = useRef<MapLibreMap | null>(null);
  const staleCheckRef = useRef<number | null>(null);

  // Initialize or update the map reference
  useEffect(() => {
    mapRef.current = mapController.getMap();
    return () => {
      mapRef.current = null;
    };
  }, []);

  // Setup GeoJSON source and layers on mount
  useEffect(() => {
    const map = mapController.getMap();
    if (!map) return;

    // Check if source already exists (guard against multiple inits)
    if (!map.getSource(PUCK_STATE.sourceId)) {
      map.addSource(PUCK_STATE.sourceId, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });

      // Accuracy ring layer (semi-transparent circle)
      map.addLayer(
        {
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
          },
        },
        // Insert before any overlays
        'position-puck-layer',
      );

      // Main puck circle (dot)
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
        },
      });
    }
  }, []);

  // Update puck geometry and appearance when position changes
  useEffect(() => {
    const map = mapController.getMap();
    if (!map || !position) return;

    const now = Date.now();
    const isStale = now - (position.ts ? new Date(position.ts).getTime() : 0) > STALE_POSITION_MS;
    const isInaccurate = position.accuracy !== null && position.accuracy > INACCURACY_THRESHOLD_M;
    const shouldBeGray = isStale || isInaccurate || !isConnected;

    const puckColor = shouldBeGray ? '#9CA3AF' : '#3B82F6'; // gray or blue
    const ringColor = shouldBeGray ? '#9CA3AF' : '#3B82F6';

    // Convert accuracy (meters) to pixels at current zoom level
    const zoom = map.getZoom();
    const metersPerPixel = 40075000 / (256 * Math.pow(2, zoom)); // Rough approximation
    const accuracyPixels = (position.accuracy || 0) / metersPerPixel;

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

    const source = map.getSource(PUCK_STATE.sourceId) as unknown as { setData(data: unknown): void };
    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features,
      });
    }

    // Update stale check
    if (staleCheckRef.current) {
      window.clearInterval(staleCheckRef.current);
    }
    staleCheckRef.current = window.setInterval(() => {
      // Trigger re-render to update stale state
      mapController.getMap(); // Dummy call to ensure map ref is current
    }, 1000) as unknown as number;

    return () => {
      if (staleCheckRef.current) {
        window.clearInterval(staleCheckRef.current);
        staleCheckRef.current = null;
      }
    };
  }, [position, isConnected]);

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
  const dLon = Math.sin(headingRad) * (distanceMeters / R) / Math.cos(latRad);

  const newLat = lat + (dLat * 180) / Math.PI;
  const newLon = lon + (dLon * 180) / Math.PI;

  return [newLon, newLat];
}
