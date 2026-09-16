/**
 * Public surface of the style system (E01-T4), re-exported for
 * `apps/core/src/map/routes.ts`.
 */

export { listStyleSummaries, getStyleDocument, type StyleSummary } from './registry.js';
export {
  rewriteSourceUrls,
  rewriteToRegions,
  regionSourceId,
  tileUrlForRegion,
} from './rewrite.js';
export {
  sichtbareRegionen,
  verdeckteRegionen,
  enthaelt,
  flaeche,
} from './mehrRegionen.js';
export {
  parseStyleOptions,
  applyStyleOptions,
  type StyleOptions,
  type StyleLang,
  type StyleLabelScale,
  type StylePoiDensity,
  type RawStyleQuery,
} from './options.js';
export type { MapStyleDocument } from './types.js';
