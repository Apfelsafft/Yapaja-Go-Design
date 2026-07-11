/**
 * MapLibre source/layer ids for the routing overlay (E03-T3), shared between
 * `RouteLayer` (which adds/updates them) and `DestinationSelector` (which
 * needs to know the alternative-route layer id to tell "tap an alternative"
 * apart from "pick a new destination").
 */
export const ALT_ROUTE_SOURCE_ID = 'route-alt-source';
export const ALT_ROUTE_LAYER_ID = 'route-alt-layer';

export const MAIN_ROUTE_SOURCE_ID = 'route-main-source';
export const MAIN_ROUTE_CASING_LAYER_ID = 'route-main-casing';
export const MAIN_ROUTE_ACCENT_LAYER_ID = 'route-main-accent';

export const MARKERS_SOURCE_ID = 'route-markers-source';
export const START_MARKER_LAYER_ID = 'route-start-marker';
export const DEST_MARKER_LAYER_ID = 'route-dest-marker';

// E03-T4: temporary-avoidance polygons ("Diesen Abschnitt meiden").
export const AVOID_POLYGONS_SOURCE_ID = 'route-avoid-polygons-source';
export const AVOID_POLYGONS_FILL_LAYER_ID = 'route-avoid-polygons-fill';
export const AVOID_POLYGONS_OUTLINE_LAYER_ID = 'route-avoid-polygons-outline';
