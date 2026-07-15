/**
 * `GeocoderBackendError` -- the single typed error a `GeocoderBackend`
 * implementation throws on failure (timeout, unreachable, malformed
 * response). `SearchService` catches this (and any other throw, defensively)
 * per backend, logs it, marks that backend "degraded", and continues to the
 * next backend in the chain -- so a Photon outage never crashes a request
 * (rule: "keine stillen Fehler", but also never a 500 for a degraded chain).
 */
import type { SearchResult } from '@yapaja/shared';

export type GeocoderBackendErrorCode = 'TIMEOUT' | 'UNAVAILABLE' | 'BAD_RESPONSE';

export class GeocoderBackendError extends Error {
  readonly backend: SearchResult['source'];
  readonly code: GeocoderBackendErrorCode;

  constructor(backend: SearchResult['source'], code: GeocoderBackendErrorCode, message: string) {
    super(message);
    this.name = 'GeocoderBackendError';
    this.backend = backend;
    this.code = code;
  }
}

export function isGeocoderBackendError(err: unknown): err is GeocoderBackendError {
  return err instanceof GeocoderBackendError;
}
