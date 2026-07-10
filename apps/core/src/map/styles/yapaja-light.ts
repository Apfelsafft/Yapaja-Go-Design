/**
 * "Yapaja Light" — the default day style (docs/06-ui-ux-guidelines.md §6).
 *
 * Layer ids follow a convention the transforms in `options.ts` rely on:
 *  - any `type: 'symbol'` layer is a label layer (lang / labelScale apply)
 *  - a symbol layer whose id starts with `POI_LAYER_ID_PREFIX` is also a POI
 *    layer (the `poi` density option additionally applies to it)
 *
 * The vector source's `url` is a placeholder (see constants.ts) rewritten to
 * the active region's real tile URL by `rewrite.ts` before the style is ever
 * served — this module never talks to the filesystem or knows about regions.
 *
 * Fixture-safety: the fixture PMTiles archive has no real vector data, so
 * `region-transportation` / `place-labels` / `poi-labels` reference
 * source-layers ("transportation", "place", "poi") that simply won't be
 * present. MapLibre renders such layers as empty rather than erroring, so
 * this style stays valid and non-crashing against an empty/dummy archive.
 */

import { PLACEHOLDER_TILE_URL, REGION_SOURCE_ID } from './constants.js';
import type { MapStyleDocument } from './types.js';

export const YAPAJA_LIGHT_STYLE_ID = 'yapaja-light';
export const YAPAJA_LIGHT_STYLE_NAME = 'Yapaja Light';

export function buildYapajaLightStyle(): MapStyleDocument {
  return {
    version: 8,
    name: YAPAJA_LIGHT_STYLE_NAME,
    sources: {
      [REGION_SOURCE_ID]: { type: 'vector', url: PLACEHOLDER_TILE_URL },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#F5F3EC' },
      },
      {
        id: 'region-transportation',
        type: 'line',
        source: REGION_SOURCE_ID,
        'source-layer': 'transportation',
        minzoom: 0,
        paint: { 'line-color': '#B9AF9C', 'line-width': 1.2 },
      },
      {
        id: 'place-labels',
        type: 'symbol',
        source: REGION_SOURCE_ID,
        'source-layer': 'place',
        minzoom: 3,
        layout: {
          visibility: 'visible',
          'text-field': ['get', 'name'],
          'text-size': 12,
        },
        paint: { 'text-color': '#1A1C1E', 'text-halo-color': '#F5F3EC', 'text-halo-width': 1 },
      },
      {
        id: 'poi-labels',
        type: 'symbol',
        source: REGION_SOURCE_ID,
        'source-layer': 'poi',
        minzoom: 14,
        layout: {
          visibility: 'visible',
          'text-field': ['get', 'name'],
          'text-size': 11,
        },
        paint: { 'text-color': '#6B6455' },
      },
    ],
  };
}
