/**
 * "Yapaja Contrast" — high-contrast, accessibility-oriented style
 * (docs/06-ui-ux-guidelines.md §6): reduced POI density, thicker roads,
 * near-maximum contrast (black on white, ~21:1) for sunlight/AAA-readability
 * (docs/06 §3 "Drive-Modus-Widgets AAA").
 *
 * "Reduced POI" is baked into this style's own default (the `poi-labels`
 * layer ships with the `REDUCED_POI_CLASSES` filter already applied) —
 * independent of, and overridable by, the `?poi=` query option (see
 * options.ts): a caller can still explicitly request `?poi=full` or
 * `?poi=off` on top of this style.
 *
 * See `yapaja-light.ts` for the layer-id convention the transforms rely on
 * and the fixture-safety note (empty vector data never crashes this style).
 */

import { PLACEHOLDER_TILE_URL, REDUCED_POI_CLASSES, REGION_SOURCE_ID } from './constants.js';
import type { MapStyleDocument } from './types.js';

export const YAPAJA_CONTRAST_STYLE_ID = 'yapaja-contrast';
export const YAPAJA_CONTRAST_STYLE_NAME = 'Yapaja Contrast';

export function buildYapajaContrastStyle(): MapStyleDocument {
  return {
    version: 8,
    name: YAPAJA_CONTRAST_STYLE_NAME,
    sources: {
      [REGION_SOURCE_ID]: { type: 'vector', url: PLACEHOLDER_TILE_URL },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#FFFFFF' },
      },
      {
        id: 'region-transportation',
        type: 'line',
        source: REGION_SOURCE_ID,
        'source-layer': 'transportation',
        minzoom: 0,
        // Thicker + pure black: "dicke Straßen, hoher Kontrast".
        paint: { 'line-color': '#000000', 'line-width': 3 },
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
          'text-size': 13,
        },
        paint: { 'text-color': '#000000', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.5 },
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
        paint: { 'text-color': '#000000' },
        // Reduced POI density baked into this style's own baseline.
        filter: ['in', ['get', 'class'], ['literal', REDUCED_POI_CLASSES]],
      },
    ],
  };
}
