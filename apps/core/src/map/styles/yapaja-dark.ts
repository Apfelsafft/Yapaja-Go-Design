/**
 * „Yapaja Dunkel" — der Nachtstil.
 *
 * Bewusst eine eigene Palette und nicht die helle invertiert: ein
 * invertiertes Grün wird magenta, ein invertiertes Wasserblau orange. Der
 * Test `yapaja-dark ist NICHT yapaja-light merely inverted` hält das fest.
 */

import { buildBaseLayers } from './baseLayers.js';
import { DARK_PALETTE } from './palette.js';
import { PLACEHOLDER_TILE_URL, REGION_SOURCE_ID } from './constants.js';
import { GLYPHS_URL } from './fonts.js';
import type { MapStyleDocument } from './types.js';

export const YAPAJA_DARK_STYLE_ID = 'yapaja-dark';
export const YAPAJA_DARK_STYLE_NAME = 'Yapaja Dunkel';

export function buildYapajaDarkStyle(): MapStyleDocument {
  return {
    version: 8,
    name: YAPAJA_DARK_STYLE_NAME,
    glyphs: GLYPHS_URL,
    sources: { [REGION_SOURCE_ID]: { type: 'vector', url: PLACEHOLDER_TILE_URL } },
    layers: buildBaseLayers(DARK_PALETTE),
  };
}
