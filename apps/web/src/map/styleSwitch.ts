/**
 * Live style switching (E01-T4): swaps the map's style JSON WITHOUT
 * re-initializing the `maplibregl.Map` instance, and WITHOUT losing the
 * camera or any layers/sources added by other app code on top of a core
 * style (the position puck from E02-T2, the view-mode module's future
 * additions, add-on layers, …).
 *
 * Implementation is MapLibre's own documented pattern for this exact
 * problem: `map.setStyle(next, { transformStyle })`. `transformStyle` is
 * called with the map's *current* live style (including whatever custom
 * sources/layers are on it right now) and the new style about to be
 * applied; we merge the custom ones into the new style before MapLibre
 * commits it. Because this is a single `setStyle` call on the same `Map`
 * instance (never `new maplibregl.Map()` / `.remove()`), the GL context and
 * everything else about the instance survives untouched.
 *
 * "Custom" vs "core" is determined by `trackCoreStyle`: every time a style
 * fetched from the core is applied (initial load or a switch), we record
 * its layer/source ids as "core". Anything present on the live map that
 * ISN'T in that set at switch time must have been added afterwards by
 * other app code — so it's preserved automatically, with no separate
 * registry that every add-on would have to remember to call into.
 */

import type { Map as MapLibreMap, LayerSpecification, SourceSpecification, StyleSpecification } from 'maplibre-gl';

let knownCoreLayerIds = new Set<string>();
let knownCoreSourceIds = new Set<string>();

/** Records which layer/source ids belong to the currently-applied core
 *  style, so a future switch can tell them apart from custom additions. */
export function trackCoreStyle(style: Pick<StyleSpecification, 'layers' | 'sources'>): void {
  knownCoreLayerIds = new Set(style.layers.map((layer) => layer.id));
  knownCoreSourceIds = new Set(Object.keys(style.sources));
}

/** Test-only accessor (also occasionally useful for debugging): resets the
 *  tracked core layer/source ids, e.g. between unit tests. */
export function resetCoreStyleTracking(): void {
  knownCoreLayerIds = new Set();
  knownCoreSourceIds = new Set();
}

function mergeCustomIntoNextStyle(
  previousStyle: StyleSpecification | undefined,
  nextStyle: StyleSpecification,
): StyleSpecification {
  if (!previousStyle) {
    return nextStyle;
  }

  const customLayers: LayerSpecification[] = previousStyle.layers.filter(
    (layer) => !knownCoreLayerIds.has(layer.id),
  );

  const customSourceIds = new Set<string>();
  for (const layer of customLayers) {
    if ('source' in layer && typeof layer.source === 'string') {
      customSourceIds.add(layer.source);
    }
  }

  const customSources: Record<string, SourceSpecification> = {};
  for (const id of customSourceIds) {
    if (knownCoreSourceIds.has(id)) {
      continue;
    }
    const source = previousStyle.sources[id];
    if (source) {
      customSources[id] = source;
    }
  }

  return {
    ...nextStyle,
    sources: { ...nextStyle.sources, ...customSources },
    layers: [...nextStyle.layers, ...customLayers],
  };
}

/**
 * Switches the live map to `style`, preserving camera (center/zoom/bearing/
 * pitch) and any custom sources/layers added since the last core style was
 * applied. Updates the "known core" tracking to `style` once the swap has
 * been issued, so the *next* switch diffs against this one correctly.
 */
export function applyStyle(map: MapLibreMap, style: StyleSpecification): void {
  const camera = {
    center: map.getCenter(),
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };

  map.setStyle(style, {
    transformStyle: mergeCustomIntoNextStyle,
  });

  // Belt-and-suspenders: `setStyle` itself never moves the camera, but make
  // the "camera survives a style switch" acceptance criterion explicit and
  // independent of that MapLibre implementation detail.
  map.jumpTo(camera);

  trackCoreStyle(style);
}
