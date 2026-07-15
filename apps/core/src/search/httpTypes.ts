/* eslint-disable no-undef -- `fetch` is a standard Node 22 global (typed via
 * @types/node); same justification as routing/valhallaClient.ts. */

/**
 * Minimal injectable HTTP transport shared by the Photon and Nominatim
 * backends -- a strict subset of WHATWG `Response`/`fetch`, so tests can
 * intercept outgoing requests without a live network.
 */

export interface HttpResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export interface HttpRequestInitLike {
  method: string;
  headers: Record<string, string>;
  signal: AbortSignal;
}

export type FetchLike = (url: string, init: HttpRequestInitLike) => Promise<HttpResponseLike>;

export const defaultFetch: FetchLike = (url, init) =>
  fetch(url, init) as unknown as Promise<HttpResponseLike>;
