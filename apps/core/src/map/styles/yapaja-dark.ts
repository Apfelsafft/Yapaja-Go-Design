/**
 * "Yapaja Dark" — real night palette (docs/06-ui-ux-guidelines.md §3/§6):
 * a genuinely dark background with dimmed/muted roads and labels, NOT an
 * inverted light style. Background matches the design tokens' dark
 * `--bg-surface` (#111417); text matches dark `--text-primary` (#E7EAED).
 *
 * See `yapaja-light.ts` for the layer-id convention the transforms rely on
 * and the fixture-safety note (empty vector data never crashes this style).
 */

import { PLACEHOLDER_TILE_URL, REGION_SOURCE_ID } from './constants.js';
import type { MapStyleDocument } from './types.js';

export const YAPAJA_DARK_STYLE_ID = 'yapaja-dark';
export const YAPAJA_DARK_STYLE_NAME = 'Yapaja Dark';

export function buildYapajaDarkStyle(): MapStyleDocument {
  return {
    version: 8,
    name: YAPAJA_DARK_STYLE_NAME,
    sources: {
      [REGION_SOURCE_ID]: { type: 'vector', url: PLACEHOLDER_TILE_URL },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#111417' },
      },
      {
        id: 'region-transportation',
        type: 'line',
        source: REGION_SOURCE_ID,
        'source-layer': 'transportation',
        minzoom: 0,
        // Dimmed/muted, not bright — this is a night style, roads must not
        // glare against the dark background.
        paint: { 'line-color': '#3A3F46', 'line-width': 1.2 },
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
        paint: { 'text-color': '#E7EAED', 'text-halo-color': '#111417', 'text-halo-width': 1 },
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
        paint: { 'text-color': '#9BA1A8' },
      },
    ],
  };
}
