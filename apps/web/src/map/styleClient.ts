/**
 * Fetches the core-served style system (E01-T4): the available style list
 * and individual style JSONs, with the `lang` / `labelScale` / `poi`
 * options applied server-side (docs/03-api-spec.md §2).
 *
 * Like `apps/web/src/map/regions.ts`, every URL is built from
 * `import.meta.env.BASE_URL` (never a hardcoded `/api/...` path), so this
 * keeps working when served under an ingress sub-path (W-15).
 */

import type { StyleSpecification } from 'maplibre-gl';

export type StyleLang = 'name' | 'name:de' | 'name:en';
export type StyleLabelScale = '1.0' | '1.2';
export type StylePoiDensity = 'full' | 'reduced' | 'off';

export interface StyleOptions {
  lang: StyleLang;
  labelScale: StyleLabelScale;
  poi: StylePoiDensity;
}

export interface StyleSummary {
  id: string;
  name: string;
  preview?: string;
}

export const DEFAULT_STYLE_ID = 'yapaja-light';

export const DEFAULT_STYLE_OPTIONS: StyleOptions = {
  lang: 'name',
  labelScale: '1.0',
  poi: 'full',
};

interface StylesListApiResponse {
  data: StyleSummary[];
}

function stylesBaseUrl(): string {
  return `${import.meta.env.BASE_URL}api/v1/map/styles`;
}

/** Fetches the list of available styles. Returns [] (never throws) on
 *  network/parse failure, mirroring `fetchRegions`. */
export async function fetchStyleSummaries(): Promise<StyleSummary[]> {
  try {
    const response = await fetch(stylesBaseUrl());
    if (!response.ok) {
      return [];
    }
    const body = (await response.json()) as StylesListApiResponse;
    return Array.isArray(body?.data) ? body.data : [];
  } catch {
    return [];
  }
}

/**
 * Fetches a single style's JSON with the given options applied. Falls back
 * to `DEFAULT_STYLE_ID` if the requested id 404s (e.g. a stale persisted
 * choice from a core that no longer ships that style), and to `null` if
 * even that fails — callers must handle `null` with `buildFallbackStyle()`
 * (never crash / never show a broken map, per E01-T2's "no-region"
 * philosophy).
 */
export async function fetchStyle(
  styleId: string,
  options: StyleOptions,
): Promise<StyleSpecification | null> {
  const params = new URLSearchParams({
    lang: options.lang,
    labelScale: options.labelScale,
    poi: options.poi,
  });

  try {
    const response = await fetch(`${stylesBaseUrl()}/${encodeURIComponent(styleId)}?${params.toString()}`);
    if (!response.ok) {
      if (styleId !== DEFAULT_STYLE_ID) {
        return fetchStyle(DEFAULT_STYLE_ID, options);
      }
      return null;
    }
    return (await response.json()) as StyleSpecification;
  } catch {
    return null;
  }
}

/**
 * Last-resort style used only if the core is unreachable or has no styles
 * registered at all. A plain background keeps the map canvas rendering
 * (never a crash / blank white screen) even in that unlikely case — mirrors
 * the defensive philosophy of MapView's "no-region" empty state.
 */
export function buildFallbackStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#EAE7DC' } }],
  };
}
