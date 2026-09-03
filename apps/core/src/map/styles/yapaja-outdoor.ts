/**
 * „Yapaja Natur" — Landbedeckung und Wege treten hervor.
 *
 * Gedacht für die beiden Dinge, für die man mit einem Wohnmobil auf die Karte
 * schaut, wenn man NICHT gerade auf der Autobahn ist: einen Stell- oder
 * Campingplatz finden, und sehen, wie das Gelände drumherum aussieht. Wald,
 * Wiese und Wasser sind deshalb kräftiger, Wege sichtbarer, versiegelte
 * Flächen zurückgenommen.
 */

import { buildBaseLayers } from './baseLayers.js';
import { OUTDOOR_PALETTE } from './palette.js';
import { PLACEHOLDER_TILE_URL, REGION_SOURCE_ID } from './constants.js';
import { GLYPHS_URL } from './fonts.js';
import type { MapStyleDocument } from './types.js';

export const YAPAJA_OUTDOOR_STYLE_ID = 'yapaja-outdoor';
export const YAPAJA_OUTDOOR_STYLE_NAME = 'Yapaja Natur';

export function buildYapajaOutdoorStyle(): MapStyleDocument {
  return {
    version: 8,
    name: YAPAJA_OUTDOOR_STYLE_NAME,
    glyphs: GLYPHS_URL,
    sources: { [REGION_SOURCE_ID]: { type: 'vector', url: PLACEHOLDER_TILE_URL } },
    layers: buildBaseLayers(OUTDOOR_PALETTE),
  };
}
