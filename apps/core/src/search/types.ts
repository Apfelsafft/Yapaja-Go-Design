/**
 * Shared contracts for the search module (E05-T1).
 *
 * `GeocoderBackend` is the interface every backend in the chain (coordinate
 * parser, Photon, Nominatim, and later `lite` in E05-T5) implements. Each
 * backend is independently injectable, which is what makes the whole chain
 * mockable in tests without a live Photon/Nominatim.
 */

import type { SearchResult } from '@yapaja/shared';

/** Forward-search query, as resolved from `GET /search?q&limit&lat&lon`. */
export interface SearchQuery {
  q: string;
  limit: number;
  /** Optional position bias (device location or map center). */
  lat?: number;
  lon?: number;
  /** Result language; falls back to the backend's own default. */
  lang?: string;
}

/** Reverse-geocode query, as resolved from `GET /search/reverse?lat&lon`. */
export interface ReverseQuery {
  lat: number;
  lon: number;
  limit: number;
  lang?: string;
}

export interface GeocoderBackend {
  /** Matches `SearchResult['source']` -- identifies this backend in results/health. */
  readonly source: SearchResult['source'];
  /** Forward search. Returns `[]` for "no hits" -- never for a backend failure
   *  (those reject with {@link GeocoderBackendError}, see ./errors.ts). */
  search(query: SearchQuery): Promise<SearchResult[]>;
  /** Reverse geocode. Same no-hits-vs-failure contract as `search`. */
  reverse(query: ReverseQuery): Promise<SearchResult[]>;
}

export interface SearchLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

/** 'disabled' (E05-T5, W-12): the backend was intentionally skipped by a
 *  Setting (currently only Photon, via `photonEnabled:false`) -- distinct
 *  from 'degraded' (backend was tried and failed) so the health snapshot
 *  can tell "we chose not to call this" apart from "this is broken". */
export type BackendHealthStatus = 'ok' | 'degraded' | 'disabled';
