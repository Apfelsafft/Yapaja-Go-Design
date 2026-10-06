/**
 * „Satellit (online)": Satellitenbilder mit Straßen und Namen darüber.
 *
 * Gewünscht: „Und können wir auch Satellitenkarten einbinden?"
 *
 * ─── WOHER DIE BILDER KOMMEN ────────────────────────────────────────────────
 * Sentinel-2 cloudless 2016 von EOX (https://s2maps.eu), lizenziert unter
 * CC BY 4.0 — frei nutzbar mit Namensnennung. Die bekannten hochauflösenden
 * Dienste (Esri, Google, Bing) erlauben das Einbinden in fremde Anwendungen
 * nicht ohne Vertrag. Sentinel-2 hat 10 m je Bildpunkt: Landschaft, Orte,
 * Seen und Wald sind gut zu erkennen, einzelne Häuser nicht.
 *
 * ─── WARUM ÜBER DEN KERN ────────────────────────────────────────────────────
 * Die Seite darf nur mit dem eigenen Server reden (`security/headers.ts`,
 * `connect-src 'self'`). Der Kern holt die Kacheln und reicht sie durch
 * (`GET /api/v1/map/satellit/:z/:x/:y`). Ohne Internet bleibt die Fläche
 * leer, Straßen und Namen aus der Offline-Karte bleiben.
 */
import { buildBaseLayers } from './baseLayers.js';
import { LIGHT_PALETTE } from './palette.js';
import { PLACEHOLDER_TILE_URL, REGION_SOURCE_ID } from './constants.js';
import { GLYPHS_URL } from './fonts.js';
import { SPRITE_URL } from './sprites.js';
import type { MapStyleDocument, StyleLayer } from './types.js';

export const YAPAIA_SATELLIT_STYLE_ID = 'yapaja-satellit';
export const YAPAIA_SATELLIT_STYLE_NAME = 'Satellit (online)';
export const SATELLIT_SOURCE_ID = 'satellit';
/** Relativ zur Seite, wie die Kachel-URLs der Karten (Ingress-Unterpfad). */
export const SATELLIT_TILE_URL = './api/v1/map/satellit/{z}/{x}/{y}.jpg';
export const SATELLIT_MAXZOOM = 15;

/** Flächen der Vektorkarte verdecken das Bild -- sie fallen weg. Linien
 *  (Straßen, Grenzen, Gewässer) und Beschriftungen bleiben. */
function ueberBild(layer: StyleLayer): boolean {
  return layer.type !== 'background' && layer.type !== 'fill';
}

export function buildYapaiaSatellitStyle(): MapStyleDocument {
  return {
    version: 8,
    name: YAPAIA_SATELLIT_STYLE_NAME,
    glyphs: GLYPHS_URL,
    sprite: SPRITE_URL,
    sources: {
      [SATELLIT_SOURCE_ID]: {
        type: 'raster',
        tiles: [SATELLIT_TILE_URL],
        tileSize: 256,
        maxzoom: SATELLIT_MAXZOOM,
        attribution:
          'Sentinel-2 cloudless – <a href="https://s2maps.eu">s2maps.eu</a> by EOX IT Services GmbH ' +
          '(Contains modified Copernicus Sentinel data 2016), CC BY 4.0',
      },
      [REGION_SOURCE_ID]: { type: 'vector', url: PLACEHOLDER_TILE_URL },
    },
    layers: [
      { id: 'satellit-hintergrund', type: 'background', paint: { 'background-color': '#1d2b1f' } },
      { id: 'satellit', type: 'raster', source: SATELLIT_SOURCE_ID },
      ...buildBaseLayers(LIGHT_PALETTE).filter(ueberBild),
    ],
  };
}
