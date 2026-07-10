/**
 * Rewrites a style document's vector source URL(s) to point at the active
 * region's actual tile archive before it's served.
 */

import type { MapStyleDocument } from './types.js';

/**
 * Builds the relative `pmtiles://` tile URL for a region.
 *
 * Deliberately a *page-relative* URL (`./tiles/<region>.pmtiles`, no leading
 * slash, no origin) rather than a root-relative or absolute one: this style
 * JSON is delivered as plain data (`fetch(...).then(r => r.json())`), not
 * navigated to, so the browser has no "style URL" to resolve relative paths
 * against — the `pmtiles://` protocol handler resolves the remainder
 * against the *page's* location instead (see
 * `apps/web/src/map/regions.ts` `pmtilesUrlForRegion`, which already builds
 * region tile URLs this same way for the same reason). A page-relative URL
 * is the only form that keeps working both at `/` and under an ingress
 * sub-path (W-15) — the core has no notion of that prefix and must not bake
 * one in.
 */
export function tileUrlForRegion(region: string): string {
  return `pmtiles://./tiles/${region}.pmtiles`;
}

/** Rewrites every vector source's URL to the given region's real tile URL. */
export function rewriteSourceUrls(style: MapStyleDocument, region: string): MapStyleDocument {
  const url = tileUrlForRegion(region);
  const sources = Object.fromEntries(
    Object.entries(style.sources).map(([id, source]) =>
      source.type === 'vector' ? [id, { ...source, url }] : [id, source],
    ),
  );
  return { ...style, sources };
}
