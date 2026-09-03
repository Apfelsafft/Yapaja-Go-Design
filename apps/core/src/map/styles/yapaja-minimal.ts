/**
 * „Yapaja Reduziert" — bewusst ruhig.
 *
 * ─── WARUM ES DIESEN STIL GIBT ──────────────────────────────────────────────
 * Bis 0.3.6 sahen ALLE Yapaja-Karten so aus wie dieser hier, und das war kein
 * Entwurf, sondern eine Lücke: die Stile zeichneten nur drei der sechzehn
 * vorhandenen Ebenen. Gemeldet wurde es als „irgendwie langweilig".
 *
 * Die Zurückhaltung selbst ist aber nicht wertlos — während der Fahrt ist eine
 * Karte ohne Gebäude, ohne Flächenfarben und ohne POI-Namen leichter zu lesen,
 * und die Route bleibt das Auffälligste im Bild. Deshalb bleibt dieser Blick
 * erhalten: nicht mehr als einziger, sondern als AUSWAHL.
 *
 * Weggelassen wird hier nur, was Fläche und Text hinzufügt. Wasser, Parks und
 * die Straßenhierarchie bleiben — sie sind die Orientierung selbst, nicht
 * Schmuck.
 */

import { buildBaseLayers } from './baseLayers.js';
import { LIGHT_PALETTE } from './palette.js';
import { PLACEHOLDER_TILE_URL, REGION_SOURCE_ID } from './constants.js';
import { GLYPHS_URL } from './fonts.js';
import type { MapStyleDocument } from './types.js';

export const YAPAJA_MINIMAL_STYLE_ID = 'yapaja-minimal';
export const YAPAJA_MINIMAL_STYLE_NAME = 'Yapaja Reduziert';

/** Was in diesem Stil nicht gezeichnet wird. Als Liste von Ebenen-IDs, damit
 *  eine neue Ebene in `baseLayers.ts` hier sichtbar auftaucht, statt
 *  stillschweigend mitzukommen. */
const OMITTED_LAYER_IDS: ReadonlySet<string> = new Set([
  'landcover-farmland',
  'landcover-sand',
  'landcover-rock',
  'landcover-wetland',
  'landcover-ice',
  'landuse-residential',
  'landuse-industrial',
  'landuse-institution',
  'landuse-cemetery',
  'building',
  'building-outline',
  'poi-labels',
  'mountain-peak-labels',
]);

export function buildYapajaMinimalStyle(): MapStyleDocument {
  return {
    version: 8,
    name: YAPAJA_MINIMAL_STYLE_NAME,
    glyphs: GLYPHS_URL,
    sources: { [REGION_SOURCE_ID]: { type: 'vector', url: PLACEHOLDER_TILE_URL } },
    layers: buildBaseLayers(LIGHT_PALETTE).filter((layer) => !OMITTED_LAYER_IDS.has(layer.id)),
  };
}
