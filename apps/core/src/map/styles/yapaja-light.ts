/**
 * „Yapaja Hell" — der Tagesstil (docs/06-ui-ux-guidelines.md §6).
 *
 * Die Kartografie steht in `baseLayers.ts`, die Farben in `palette.ts`. Bis
 * 0.3.6 stand hier eine eigene, sehr knappe Ebenenliste: Hintergrund, EINE
 * graue Linie für jede Straße, Ortsnamen, POI-Namen. Kein Wasser, kein Grün,
 * keine Gebäude, keine Straßennamen — die Karte sah aus wie ein Drahtgitter,
 * und genau so wurde sie auch gemeldet.
 */

import { buildBaseLayers } from './baseLayers.js';
import { LIGHT_PALETTE } from './palette.js';
import { PLACEHOLDER_TILE_URL, REGION_SOURCE_ID } from './constants.js';
import { GLYPHS_URL } from './fonts.js';
import type { MapStyleDocument } from './types.js';

export const YAPAJA_LIGHT_STYLE_ID = 'yapaja-light';
export const YAPAJA_LIGHT_STYLE_NAME = 'Yapaja Hell';

export function buildYapajaLightStyle(): MapStyleDocument {
  return {
    version: 8,
    name: YAPAJA_LIGHT_STYLE_NAME,
    glyphs: GLYPHS_URL,
    sources: { [REGION_SOURCE_ID]: { type: 'vector', url: PLACEHOLDER_TILE_URL } },
    layers: buildBaseLayers(LIGHT_PALETTE),
  };
}
