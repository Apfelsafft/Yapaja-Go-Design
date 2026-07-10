/**
 * Style-option transforms (`?lang=`, `?labelScale=`, `?poi=`): pure
 * functions over a style document's `layers` array, composed by
 * `applyStyleOptions`. Each transform is independent and only touches the
 * layers it's responsible for (classified by the naming convention
 * documented in `constants.ts` / `yapaja-light.ts`), so adding a new
 * transform later is just "write a pure `(layers) => layers` function and
 * wire it into `applyStyleOptions`" — no other module needs to change.
 *
 * Query params are treated as *optional overrides*: a param that's absent
 * (not merely invalid) leaves that aspect of the style untouched, so a
 * style's own baked-in defaults (e.g. `yapaja-contrast`'s reduced POI) stay
 * intact unless a caller explicitly overrides them.
 */

import { POI_LAYER_ID_PREFIX, REDUCED_POI_CLASSES } from './constants.js';
import type { MapStyleDocument, StyleLayer, SymbolLayer } from './types.js';

export type StyleLang = 'name' | 'name:de' | 'name:en';
export type StyleLabelScale = '1.0' | '1.2';
export type StylePoiDensity = 'full' | 'reduced' | 'off';

export interface StyleOptions {
  lang?: StyleLang;
  labelScale?: StyleLabelScale;
  poi?: StylePoiDensity;
}

const VALID_LANG: readonly StyleLang[] = ['name', 'name:de', 'name:en'];
const VALID_LABEL_SCALE: readonly StyleLabelScale[] = ['1.0', '1.2'];
const VALID_POI: readonly StylePoiDensity[] = ['full', 'reduced', 'off'];

/** Raw, not-yet-validated query values (Fastify querystring shape). */
export interface RawStyleQuery {
  lang?: unknown;
  labelScale?: unknown;
  poi?: unknown;
}

function firstValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

/**
 * Parses+validates style-option query params. Unknown/invalid values are
 * silently dropped (defensive: a malformed `?poi=whatever` must never crash
 * the endpoint — it just falls back to leaving that option untouched, same
 * as if it had been omitted).
 */
export function parseStyleOptions(query: RawStyleQuery): StyleOptions {
  const options: StyleOptions = {};

  const lang = firstValue(query.lang);
  if (lang && (VALID_LANG as readonly string[]).includes(lang)) {
    options.lang = lang as StyleLang;
  }

  const labelScale = firstValue(query.labelScale);
  if (labelScale && (VALID_LABEL_SCALE as readonly string[]).includes(labelScale)) {
    options.labelScale = labelScale as StyleLabelScale;
  }

  const poi = firstValue(query.poi);
  if (poi && (VALID_POI as readonly string[]).includes(poi)) {
    options.poi = poi as StylePoiDensity;
  }

  return options;
}

function isSymbolLayer(layer: StyleLayer): layer is SymbolLayer {
  return layer.type === 'symbol';
}

function isPoiLayer(layer: StyleLayer): layer is SymbolLayer {
  return isSymbolLayer(layer) && layer.id.startsWith(POI_LAYER_ID_PREFIX);
}

function applyLang(layer: StyleLayer, lang: StyleLang): StyleLayer {
  if (!isSymbolLayer(layer)) {
    return layer;
  }
  return { ...layer, layout: { ...layer.layout, 'text-field': ['get', lang] } };
}

function applyLabelScale(layer: StyleLayer, scale: StyleLabelScale): StyleLayer {
  if (!isSymbolLayer(layer)) {
    return layer;
  }
  const currentSize = layer.layout['text-size'];
  if (typeof currentSize !== 'number') {
    // Expression-valued text-size: left untouched (documented limitation —
    // none of the shipped styles use expression sizes today).
    return layer;
  }
  const factor = scale === '1.2' ? 1.2 : 1.0;
  // Rounded to 2 decimals to keep the served JSON tidy and avoid float noise.
  const nextSize = Math.round(currentSize * factor * 100) / 100;
  return { ...layer, layout: { ...layer.layout, 'text-size': nextSize } };
}

function applyPoi(layer: StyleLayer, poi: StylePoiDensity): StyleLayer {
  if (!isPoiLayer(layer)) {
    return layer;
  }
  if (poi === 'off') {
    const { filter: _filter, ...rest } = layer;
    return { ...rest, layout: { ...layer.layout, visibility: 'none' } };
  }
  if (poi === 'reduced') {
    return {
      ...layer,
      layout: { ...layer.layout, visibility: 'visible' },
      filter: ['in', ['get', 'class'], ['literal', REDUCED_POI_CLASSES]],
    };
  }
  // 'full': visible, no class filter.
  const { filter: _filter, ...rest } = layer;
  return { ...rest, layout: { ...layer.layout, visibility: 'visible' } };
}

/** Applies every explicitly-provided style option to the style's layers. */
export function applyStyleOptions(style: MapStyleDocument, options: StyleOptions): MapStyleDocument {
  let layers = style.layers;

  if (options.lang) {
    const lang = options.lang;
    layers = layers.map((layer) => applyLang(layer, lang));
  }
  if (options.labelScale) {
    const labelScale = options.labelScale;
    layers = layers.map((layer) => applyLabelScale(layer, labelScale));
  }
  if (options.poi) {
    const poi = options.poi;
    layers = layers.map((layer) => applyPoi(layer, poi));
  }

  return { ...style, layers };
}
