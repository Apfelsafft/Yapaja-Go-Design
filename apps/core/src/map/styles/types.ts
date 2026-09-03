/**
 * Minimal, hand-rolled MapLibre style-spec types for the style documents
 * this module serves.
 *
 * Deliberately NOT imported from `@maplibre/maplibre-gl-style-spec` (a
 * devDependency used only by `styles.test.ts` to validate the *served*
 * JSON against the real spec): that package pulls in style-spec's full
 * validation/expression machinery, which has no business being part of the
 * runtime bundle for a handful of statically-authored style documents. The
 * shapes below cover exactly what `apps/core/src/map/styles/*` needs.
 */

export interface VectorStyleSource {
  type: 'vector';
  url: string;
}

export type StyleSource = VectorStyleSource;

export interface BackgroundLayer {
  id: string;
  type: 'background';
  paint: { 'background-color': string };
}

export interface LineLayer {
  id: string;
  type: 'line';
  source: string;
  'source-layer': string;
  minzoom?: number;
  maxzoom?: number;
  /** Klassenfilter, z. B. nur Autobahnen. Fehlte hier bis 0.3.7 -- die
   *  Stile konnten deshalb ALLE Strassen nur als eine einzige Linienart
   *  zeichnen, ohne Hierarchie. Genau das liess die Karte leer wirken. */
  filter?: unknown[];
  layout?: { visibility?: 'visible' | 'none' } & Record<string, unknown>;
  paint: Record<string, unknown>;
}

/** Flaechen: Wasser, Landbedeckung, Parks, Gebaeude. Ohne diesen Typ konnte
 *  das Stil-System ueberhaupt keine Flaeche zeichnen -- und eine Karte ohne
 *  Wasser und Gruen sieht aus wie ein Drahtgitter. */
export interface FillLayer {
  id: string;
  type: 'fill';
  source: string;
  'source-layer': string;
  minzoom?: number;
  maxzoom?: number;
  filter?: unknown[];
  layout?: { visibility?: 'visible' | 'none' } & Record<string, unknown>;
  paint: Record<string, unknown>;
}

export interface SymbolLayerLayout {
  visibility?: 'visible' | 'none';
  'text-field'?: unknown;
  'text-size'?: unknown;
  [key: string]: unknown;
}

export interface SymbolLayer {
  id: string;
  type: 'symbol';
  source: string;
  'source-layer': string;
  minzoom?: number;
  maxzoom?: number;
  layout: SymbolLayerLayout;
  paint?: Record<string, unknown>;
  filter?: unknown[];
}

export type StyleLayer = BackgroundLayer | FillLayer | LineLayer | SymbolLayer;

export interface MapStyleDocument {
  version: 8;
  name: string;
  /** Woher MapLibre die Schriftzeichen holt. OHNE dieses Feld zeichnet
   *  MapLibre KEINEN Buchstaben -- die Symbol-Ebenen bleiben stumm, ohne
   *  Fehlermeldung. Bis 0.3.6 fehlte es; siehe `fonts.ts`. */
  glyphs: string;
  sources: Record<string, StyleSource>;
  layers: StyleLayer[];
}
