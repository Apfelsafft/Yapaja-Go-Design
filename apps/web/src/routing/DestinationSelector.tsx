/**
 * Destination Selector (E03-T3): a headless component that wires up map
 * gestures for routing:
 *  - Click OR long-press (MapLibre reports a touch long-press as a
 *    `contextmenu` event, same as a desktop right-click) on the map drops a
 *    destination pin and opens the bottom sheet (`RoutingPanel`).
 *  - Tapping/clicking an already-displayed alternative route (the gray,
 *    tappable lines from `RouteLayer`) makes it the active route instead of
 *    picking a new destination -- handled here (not in `RouteLayer`, which
 *    only renders) so there is exactly one place deciding what a map click
 *    means, with no risk of two independent listeners both firing for the
 *    same click.
 *
 * Follows the same map-ready reactive pattern as `PositionPuck`/`RouteLayer`
 * (`useMapStore((s) => s.map)`, `[map]` deps) -- attaching event listeners
 * doesn't need the style-load guard (that's only for `addSource`/`addLayer`),
 * but still must wait for the map instance to exist.
 */

import { useEffect } from 'react';
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { useMapStore } from '../state/mapStore.js';
import { useRoutingStore } from './store.js';
import { ALT_ROUTE_LAYER_ID } from './layerIds.js';

function pickRouteIdAtPoint(map: MapLibreMap, e: MapMouseEvent): string | null {
  if (!map.getLayer(ALT_ROUTE_LAYER_ID)) {
    return null;
  }
  const hits = map.queryRenderedFeatures(e.point, { layers: [ALT_ROUTE_LAYER_ID] });
  const routeId = hits[0]?.properties?.routeId;
  return typeof routeId === 'string' ? routeId : null;
}

export default function DestinationSelector(): null {
  const map = useMapStore((state) => state.map);
  const setDestination = useRoutingStore((state) => state.setDestination);
  const selectRoute = useRoutingStore((state) => state.selectRoute);

  useEffect(() => {
    if (!map) return;

    const handlePick = (e: MapMouseEvent): void => {
      // `contextmenu`'s browser default (desktop right-click menu) must
      // never appear over the map.
      e.originalEvent?.preventDefault?.();

      const tappedAltRouteId = pickRouteIdAtPoint(map, e);
      if (tappedAltRouteId) {
        selectRoute(tappedAltRouteId);
        return;
      }

      setDestination({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    };

    map.on('click', handlePick);
    map.on('contextmenu', handlePick);

    return () => {
      map.off('click', handlePick);
      map.off('contextmenu', handlePick);
    };
  }, [map, setDestination, selectRoute]);

  return null;
}
