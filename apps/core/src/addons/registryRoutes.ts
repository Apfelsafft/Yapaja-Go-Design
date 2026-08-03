/**
 * Fastify routes for the add-on registry client (E09-T7, docs/05 §5,
 * Wargame W-11/W-13). Prefix: `/api/v1`.
 *
 *  - GET  /addons/registry       -> the CACHED catalog + its age (W-13:
 *    "Katalog-Cache mit Zeitstempel") + a per-entry `compatible` flag
 *    (Wargame W-11: checked BEFORE install, not just at install time).
 *    NEVER touches the network -- this is what keeps the store usable while
 *    the registry host is unreachable.
 *  - POST /addons/registry/sync  -> fetches + validates + persists a FRESH
 *    catalog. A failure (unreachable host, invalid JSON) leaves the
 *    previously cached catalog completely untouched (`RegistryService.sync`'s
 *    own guarantee) and is reported as a normal `ApiError`; the client is
 *    expected to fall back to its last `GET /addons/registry` result, which
 *    is still valid.
 *
 * The actual INSTALL of a registry entry reuses the existing
 * `POST /addons/install {source:'url', url, sha256}` endpoint verbatim --
 * see `routes.ts`. This module never re-implements sha256 verification or
 * the `core_api` install-time gate; `compatible` here is purely an
 * ADVISORY the UI uses to grey out/hide the install button before the
 * operator ever gets there (acceptance criterion 2: "inkompatibles Add-on
 * zeigt Sperr-Hinweis statt Install-Button").
 */

import type { FastifyPluginAsync } from 'fastify';
import type { ApiError } from '@yapaja/shared';
import { satisfies } from '@yapaja/shared';
import { RegistryService, RegistryError, type RegistryEntry, type RegistryCacheSnapshot } from './registry.js';

function createErrorResponse(code: string, message: string): ApiError {
  return { error: { code, message } };
}

function statusForRegistryError(err: RegistryError): number {
  switch (err.code) {
    case 'REGISTRY_UNREACHABLE':
    case 'REGISTRY_INVALID':
      return 502; // upstream (registry host) problem, same convention as DOWNLOAD_FAILED
    default:
      return 500;
  }
}

/** A catalog entry as served to the client: the validated {@link RegistryEntry}
 *  plus the `core_api` compatibility verdict (Wargame W-11) computed against
 *  the RUNNING Core's version -- always freshly computed here (not cached
 *  alongside the entry), so a Core UPDATE changes `compatible` immediately
 *  even without a registry re-sync. */
export interface RegistryEntryView extends RegistryEntry {
  compatible: boolean;
}

export interface RegistryCatalogReplyData {
  entries: RegistryEntryView[];
  fetched_at: string | null;
  age_ms: number | null;
  source_url: string;
  /** Validation errors from the last successful parse (dropped entries) --
   *  surfaced so an operator can see why an expected entry is missing. */
  errors: string[];
}

function toReplyData(snapshot: RegistryCacheSnapshot, coreVersion: string): RegistryCatalogReplyData {
  return {
    entries: snapshot.entries.map((entry) => ({ ...entry, compatible: satisfies(coreVersion, entry.core_api) })),
    fetched_at: snapshot.fetchedAt,
    age_ms: snapshot.ageMs,
    source_url: snapshot.sourceUrl,
    errors: snapshot.errors,
  };
}

export interface AddonRegistryPluginOptions {
  /** Injectable for tests; if omitted a real `RegistryService` (backed by a
   *  fresh `SettingsService`) is built. */
  service?: RegistryService;
  /** The running Core's version (Wargame W-11), same value `addonsPlugin`
   *  gets -- required unless `service` is injected directly. */
  coreVersion?: string;
}

export const addonRegistryPlugin: FastifyPluginAsync<AddonRegistryPluginOptions> = async (fastify, opts) => {
  if (!opts.service && !opts.coreVersion) {
    throw new Error('addonRegistryPlugin: either `service` or `coreVersion` must be provided');
  }
  const coreVersion = opts.coreVersion ?? '0.0.0';
  const service = opts.service ?? new RegistryService();

  fastify.get<{ Reply: { data: RegistryCatalogReplyData } }>('/addons/registry', async (_request, reply) => {
    reply.code(200).send({ data: toReplyData(service.getCachedCatalog(), coreVersion) });
  });

  fastify.post<{ Reply: { data: RegistryCatalogReplyData } | ApiError }>(
    '/addons/registry/sync',
    async (_request, reply) => {
      try {
        const snapshot = await service.sync();
        reply.code(200).send({ data: toReplyData(snapshot, coreVersion) });
      } catch (err) {
        if (err instanceof RegistryError) {
          reply.code(statusForRegistryError(err)).send(createErrorResponse(err.code, err.message));
          return;
        }
        reply
          .code(500)
          .send(createErrorResponse('INTERNAL_ERROR', err instanceof Error ? err.message : 'Unknown error'));
      }
    },
  );
};
