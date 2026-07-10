/**
 * Minimal inline MapLibre style used until the core-served style system
 * lands in E01-T4. Keep this file tiny and dependency-free: a light
 * background layer plus the region's PMTiles vector source registered (but
 * deliberately not wired to any label/POI layers yet — that richer styling
 * is E01-T4's job).
 *
 * The single `line` layer below exists only to prove the vector source is
 * live and renderable; it targets a `source-layer` name ("transportation")
 * that simply won't be present in a fixture/empty archive, so it silently
 * renders nothing rather than crashing when there's no real vector data
 * (see MapView's `error` handler for the belt-and-suspenders case where a
 * tile fetch itself fails).
 */

import type { StyleSpecification } from 'maplibre-gl';

const BACKGROUND_COLOR_LIGHT = '#EAE7DC';

export const REGION_SOURCE_ID = 'yapaja-region';

/**
 * Build the minimal style for a given region's PMTiles source URL.
 * `pmtilesUrl` must already be a relative `pmtiles://...` URL (see MapView).
 */
export function buildMinimalStyle(pmtilesUrl: string): StyleSpecification {
  return {
    version: 8,
    // No external glyphs/sprites: offline-first (rule #3), and the minimal
    // style below doesn't use symbol layers or icons yet.
    sources: {
      [REGION_SOURCE_ID]: {
        type: 'vector',
        url: pmtilesUrl,
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: {
          'background-color': BACKGROUND_COLOR_LIGHT,
        },
      },
      {
        id: 'region-transportation',
        type: 'line',
        source: REGION_SOURCE_ID,
        'source-layer': 'transportation',
        paint: {
          'line-color': '#9C9689',
          'line-width': 1,
        },
      },
    ],
  };
}
