/**
 * „Yapaja Kontrast" — Barrierefreiheit (docs/06 §6).
 *
 * Heller Grund, schwarze Beschriftung, kräftig gezeichnete Straßen
 * (`roadWidthScale` in der Palette), zurückgenommene Flächen. Die POI-Dichte
 * ist ab Werk reduziert: bei hohem Kontrast konkurrieren viele kleine Labels
 * am stärksten mit dem, worauf es ankommt.
 */

import { buildBaseLayers } from './baseLayers.js';
import { CONTRAST_PALETTE } from './palette.js';
import { PLACEHOLDER_TILE_URL, REDUCED_POI_CLASSES, REGION_SOURCE_ID } from './constants.js';
import { GLYPHS_URL } from './fonts.js';
import type { MapStyleDocument, SymbolLayer } from './types.js';

export const YAPAJA_CONTRAST_STYLE_ID = 'yapaja-contrast';
export const YAPAJA_CONTRAST_STYLE_NAME = 'Yapaja Kontrast';

export function buildYapajaContrastStyle(): MapStyleDocument {
  const layers = buildBaseLayers(CONTRAST_PALETTE).map((layer) =>
    layer.id === 'poi-labels'
      ? ({
          ...(layer as SymbolLayer),
          filter: ['in', ['get', 'class'], ['literal', REDUCED_POI_CLASSES]],
        } as SymbolLayer)
      : layer,
  );

  return {
    version: 8,
    name: YAPAJA_CONTRAST_STYLE_NAME,
    glyphs: GLYPHS_URL,
    sources: { [REGION_SOURCE_ID]: { type: 'vector', url: PLACEHOLDER_TILE_URL } },
    layers,
  };
}
