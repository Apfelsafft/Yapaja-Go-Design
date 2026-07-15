/**
 * Fastify routes for the SearchService (E05-T1).
 * Prefix: /api/v1 (see docs/03-api-spec.md §2 "Suche & Favoriten").
 *
 *  - GET /search?q=&limit=&lat=&lon=  -> `{ data: SearchResult[] }`
 *  - GET /search/reverse?lat=&lon=    -> `{ data: SearchResult[] }`
 *
 * Every backend (coords/Photon/Nominatim) is injectable so tests can drive
 * the whole chain -- including failure and rate-limit paths -- without a
 * live Photon/Nominatim. Responses are always 200 with `{ data: [...] }`
 * (possibly empty); only malformed query parameters yield 400
 * VALIDATION_ERROR -- a degraded backend chain is not a client error.
 */
import type { FastifyPluginAsync } from 'fastify';
import type { ApiError, SearchResult } from '@yapaja/shared';
import { CoordsBackend } from './coordsBackend.js';
import type { SearchRegionsProvider } from './coverage.js';
import type { FetchLike } from './httpTypes.js';
import { NominatimBackend } from './nominatimBackend.js';
import { PhotonBackend } from './photonBackend.js';
import { SearchService } from './service.js';
import type { GeocoderBackend, SearchLogger } from './types.js';
import { listRegions } from '../map/regions.js';
import { resolveTilesDir } from '../map/paths.js';

export interface SearchRoutesOptions {
  photonUrl?: string;
  nominatimUrl?: string;
  nominatimUserAgent?: string;
  /** Setting `online_fallback`; default false (docs/03, E05-T1). */
  onlineFallback?: boolean;
  /** Default result language for Photon/Nominatim; default 'de'. */
  lang?: string;
  /** Test seam: injectable HTTP transport for the built-in backends. */
  fetchImpl?: FetchLike;
  /** Test seam: pre-built backends win over the built-in ones. */
  photonBackend?: GeocoderBackend;
  nominatimBackend?: GeocoderBackend;
  /** Test seam: injectable regions provider (mirrors routing's E03-T6 seam). */
  regionsProvider?: SearchRegionsProvider;
  /** Test seam: fully pre-built service wins over everything above. */
  service?: SearchService;
  logger?: SearchLogger;
}

interface SearchQuerystring {
  q?: string;
  limit?: string;
  lat?: string;
  lon?: string;
}

interface ReverseQuerystring {
  lat?: string;
  lon?: string;
  limit?: string;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

function errorResponse(code: string, message: string): ApiError {
  return { error: { code, message } };
}

/** Parses `limit`; `undefined` -> default. Returns `null` on an invalid value. */
function parseLimit(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) return null;
  return n;
}

/** Parses an optional coordinate query param. `undefined` -> `undefined`
 *  (absent, not an error); an unparsable/out-of-range value -> `null`. */
function parseOptionalCoord(raw: string | undefined, min: number, max: number): number | null | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

export const searchPlugin: FastifyPluginAsync<SearchRoutesOptions> = async (fastify, opts) => {
  const logger: SearchLogger = opts.logger ?? {
    info: (msg, meta) => fastify.log.info(meta ?? {}, msg),
    warn: (msg, meta) => fastify.log.warn(meta ?? {}, msg),
    error: (msg, meta) => fastify.log.error(meta ?? {}, msg),
  };

  const photonBackend: GeocoderBackend =
    opts.photonBackend ??
    new PhotonBackend({ baseUrl: opts.photonUrl, lang: opts.lang, fetchImpl: opts.fetchImpl, logger });

  const nominatimBackend: GeocoderBackend =
    opts.nominatimBackend ??
    new NominatimBackend({
      baseUrl: opts.nominatimUrl,
      userAgent: opts.nominatimUserAgent,
      lang: opts.lang,
      fetchImpl: opts.fetchImpl,
      logger,
    });

  const coordsBackend: GeocoderBackend = new CoordsBackend();

  // Mirrors the regions-provider construction in routing/routes.ts (E03-T6);
  // only `getInstalledRegions` is needed here (see coverage.ts).
  const regionsProvider: SearchRegionsProvider =
    opts.regionsProvider ??
    {
      async getInstalledRegions() {
        const tilesDir = resolveTilesDir();
        const regions = await listRegions(tilesDir, fastify.log);
        return regions.map((r) => ({ id: r.region, name: r.region, bounds: r.bounds }));
      },
    };

  const service =
    opts.service ??
    new SearchService({
      coordsBackend,
      photonBackend,
      nominatimBackend,
      onlineFallback: opts.onlineFallback ?? false,
      regionsProvider,
      logger,
    });

  // GET /search
  fastify.get<{ Querystring: SearchQuerystring; Reply: { data: SearchResult[] } | ApiError }>(
    '/search',
    async (request, reply) => {
      const q = request.query.q;
      if (typeof q !== 'string' || q.trim().length === 0) {
        return reply
          .code(400)
          .send(errorResponse('VALIDATION_ERROR', 'Query parameter "q" is required'));
      }

      const limit = parseLimit(request.query.limit);
      if (limit === null) {
        return reply
          .code(400)
          .send(
            errorResponse('VALIDATION_ERROR', `"limit" must be an integer between 1 and ${MAX_LIMIT}`),
          );
      }

      const lat = parseOptionalCoord(request.query.lat, -90, 90);
      if (lat === null) {
        return reply
          .code(400)
          .send(errorResponse('VALIDATION_ERROR', '"lat" must be a number between -90 and 90'));
      }

      const lon = parseOptionalCoord(request.query.lon, -180, 180);
      if (lon === null) {
        return reply
          .code(400)
          .send(errorResponse('VALIDATION_ERROR', '"lon" must be a number between -180 and 180'));
      }

      const results = await service.search({ q, limit, lat, lon });
      return reply.code(200).send({ data: results });
    },
  );

  // GET /search/reverse
  fastify.get<{ Querystring: ReverseQuerystring; Reply: { data: SearchResult[] } | ApiError }>(
    '/search/reverse',
    async (request, reply) => {
      const lat = parseOptionalCoord(request.query.lat, -90, 90);
      if (lat === null || lat === undefined) {
        return reply
          .code(400)
          .send(
            errorResponse(
              'VALIDATION_ERROR',
              '"lat" is required and must be a number between -90 and 90',
            ),
          );
      }

      const lon = parseOptionalCoord(request.query.lon, -180, 180);
      if (lon === null || lon === undefined) {
        return reply
          .code(400)
          .send(
            errorResponse(
              'VALIDATION_ERROR',
              '"lon" is required and must be a number between -180 and 180',
            ),
          );
      }

      const limit = parseLimit(request.query.limit);
      if (limit === null) {
        return reply
          .code(400)
          .send(
            errorResponse('VALIDATION_ERROR', `"limit" must be an integer between 1 and ${MAX_LIMIT}`),
          );
      }

      const results = await service.reverse({ lat, lon, limit });
      return reply.code(200).send({ data: results });
    },
  );
};
