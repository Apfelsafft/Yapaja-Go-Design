/**
 * Fastify routes for the add-on install/lifecycle pipeline (E09-T1, docs/03
 * §2, docs/05 §2/§5). Prefix: /api/v1 -- inherits the E08-T3 bearer-token
 * guard automatically (no second auth layer here, see `auth/plugin.ts`).
 *
 *  - POST   /addons/install                 -> step 1 of the two-step
 *    scope-confirm flow (docs/05 §2): validates a tarball (upload OR URL)
 *    and returns a PENDING install (manifest + permissions + warnings).
 *    Nothing is installed yet.
 *  - POST   /addons/install/:pendingId/confirm -> step 2: actually unpacks
 *    + writes the DB row (fresh install disabled by default, OR an update
 *    with rollback-on-failure if `:id` is already installed).
 *  - GET    /addons                         -> installed add-ons + status.
 *  - POST   /addons/:id/enable|disable       -> lifecycle.
 *  - DELETE /addons/:id                      -> uninstall (code + storage +
 *    DB row, residue-free).
 *
 * Upload transport: rather than adding `@fastify/multipart`, the tarball is
 * sent as base64 inside a plain JSON body (`{source:'upload', data, sha256?}`)
 * -- this keeps the whole install endpoint on Fastify's existing JSON body
 * parser (just with a raised per-route `bodyLimit`, since 50 MB of tarball
 * becomes ~67 MB of base64) and avoids a new dependency for what is, on this
 * offline LAN device, a rare, deliberate operator action rather than a
 * high-throughput path. `{source:'url', url, sha256}` is the alternative,
 * used for registry/direct-URL installs (sha256 mandatory there).
 */

import type { FastifyPluginAsync } from 'fastify';
import { Buffer } from 'node:buffer';
import type { ApiError } from '@yapaja/shared';
import { InstallService, MAX_TARBALL_COMPRESSED_BYTES } from './installService.js';
import { AddonError } from './errors.js';
import { downloadTarball } from './download.js';
import type { AddonRecord } from './repository.js';

/** ~67 MB: enough for a 50 MB tarball base64-encoded (×4/3) plus headroom
 *  for the rest of the JSON envelope. */
const INSTALL_ROUTE_BODY_LIMIT_BYTES = Math.ceil((MAX_TARBALL_COMPRESSED_BYTES * 4) / 3) + 1024 * 1024;

function createErrorResponse(code: string, message: string): ApiError {
  return { error: { code, message } };
}

/** Maps an `AddonError.code` to an HTTP status. Every branch is deliberate
 *  (see the comment on each) -- nothing falls through to a generic 500 for
 *  an error this module itself threw. */
function statusForAddonError(err: AddonError): number {
  switch (err.code) {
    case 'PENDING_NOT_FOUND':
    case 'NOT_FOUND':
      return 404;
    case 'TARBALL_TOO_LARGE':
    case 'DOWNLOAD_TOO_LARGE':
      return 413; // Payload Too Large
    case 'INCOMPATIBLE_CORE_API':
      return 409; // Conflict with the running Core's declared API version
    case 'ADDON_START_FAILED':
      return 422; // Well-formed package, but not actually startable
    case 'DOWNLOAD_FAILED':
      return 502; // Upstream (registry/URL) fetch failed
    case 'UPDATE_SWAP_FAILED':
      return 500; // Rolled back internally, but still a server-side failure
    // SHA256_REQUIRED, SHA256_MISMATCH, INVALID_MANIFEST, TARBALL_REJECTED
    // (TarballSecurityError extends AddonError with this code), and any
    // other validation-shaped rejection.
    default:
      return 400;
  }
}

function sendAddonError(reply: { code: (n: number) => { send: (b: ApiError) => void } }, err: unknown): void {
  if (err instanceof AddonError) {
    reply.code(statusForAddonError(err)).send(createErrorResponse(err.code, err.message));
    return;
  }
  reply
    .code(500)
    .send(createErrorResponse('INTERNAL_ERROR', err instanceof Error ? err.message : 'Unknown error'));
}

interface InstallBodyUpload {
  source: 'upload';
  data: unknown; // base64 string
  sha256?: unknown;
}
interface InstallBodyUrl {
  source: 'url';
  url: unknown;
  sha256: unknown;
}
type InstallBody = InstallBodyUpload | InstallBodyUrl | Record<string, unknown>;

interface ConfirmParams {
  pendingId: string;
}
interface AddonIdParams {
  id: string;
}

interface AddonRecordReply {
  data: AddonRecord;
}
interface AddonListReply {
  data: AddonRecord[];
}

export interface AddonsPluginOptions {
  /** Injectable for tests; if omitted a real `InstallService` is built,
   *  requiring `coreVersion`. */
  service?: InstallService;
  /** The running Core's version (see `version.ts#readPackageVersion`),
   *  checked against each manifest's `core_api` range. Required unless
   *  `service` is injected directly. */
  coreVersion?: string;
}

export const addonsPlugin: FastifyPluginAsync<AddonsPluginOptions> = async (fastify, opts) => {
  if (!opts.service && !opts.coreVersion) {
    throw new Error('addonsPlugin: either `service` or `coreVersion` must be provided');
  }
  const service = opts.service ?? new InstallService({ coreVersion: opts.coreVersion as string });

  fastify.get<{ Reply: AddonListReply }>('/addons', async (_request, reply) => {
    reply.code(200).send({ data: service.listAddons() });
  });

  fastify.post<{ Body: InstallBody; Reply: unknown }>(
    '/addons/install',
    { bodyLimit: INSTALL_ROUTE_BODY_LIMIT_BYTES },
    async (request, reply) => {
      const body = request.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || !('source' in body)) {
        reply.code(400).send(createErrorResponse('VALIDATION_ERROR', 'Body must include a "source" field ("upload" or "url")'));
        return;
      }

      try {
        let result;
        if (body.source === 'upload') {
          const upload = body as InstallBodyUpload;
          if (typeof upload.data !== 'string' || upload.data.length === 0) {
            reply.code(400).send(createErrorResponse('VALIDATION_ERROR', '"data" (base64 tarball) is required for an upload install'));
            return;
          }
          const sha256 = typeof upload.sha256 === 'string' ? upload.sha256 : undefined;
          let tarballBytes: Buffer;
          try {
            tarballBytes = Buffer.from(upload.data, 'base64');
          } catch {
            reply.code(400).send(createErrorResponse('VALIDATION_ERROR', '"data" is not valid base64'));
            return;
          }
          result = await service.beginInstallFromUpload(tarballBytes, sha256);
        } else if (body.source === 'url') {
          const urlBody = body as InstallBodyUrl;
          if (typeof urlBody.url !== 'string' || urlBody.url.length === 0) {
            reply.code(400).send(createErrorResponse('VALIDATION_ERROR', '"url" is required for a URL install'));
            return;
          }
          if (typeof urlBody.sha256 !== 'string' || urlBody.sha256.length === 0) {
            reply.code(400).send(createErrorResponse('VALIDATION_ERROR', '"sha256" is required for a URL install'));
            return;
          }
          const tarballBytes = await downloadTarball({
            url: urlBody.url,
            maxBytes: MAX_TARBALL_COMPRESSED_BYTES,
          });
          result = await service.beginInstallFromUrl(tarballBytes, urlBody.sha256);
        } else {
          reply.code(400).send(createErrorResponse('VALIDATION_ERROR', '"source" must be "upload" or "url"'));
          return;
        }

        reply.code(202).send({
          data: {
            pending_id: result.pendingId,
            manifest: result.manifest,
            permissions: result.permissions,
            warnings: result.warnings,
            is_update: result.isUpdate,
            sha256: result.sha256,
            expires_at: result.expiresAt,
          },
        });
      } catch (err) {
        sendAddonError(reply, err);
      }
    },
  );

  fastify.post<{ Params: ConfirmParams; Reply: AddonRecordReply | ApiError }>(
    '/addons/install/:pendingId/confirm',
    async (request, reply) => {
      try {
        const record = await service.confirmInstall(request.params.pendingId);
        reply.code(201).send({ data: record });
      } catch (err) {
        sendAddonError(reply, err);
      }
    },
  );

  fastify.post<{ Params: AddonIdParams; Reply: AddonRecordReply | ApiError }>(
    '/addons/:id/enable',
    async (request, reply) => {
      try {
        reply.code(200).send({ data: service.enable(request.params.id) });
      } catch (err) {
        sendAddonError(reply, err);
      }
    },
  );

  fastify.post<{ Params: AddonIdParams; Reply: AddonRecordReply | ApiError }>(
    '/addons/:id/disable',
    async (request, reply) => {
      try {
        reply.code(200).send({ data: service.disable(request.params.id) });
      } catch (err) {
        sendAddonError(reply, err);
      }
    },
  );

  fastify.delete<{ Params: AddonIdParams; Reply: ApiError | undefined }>(
    '/addons/:id',
    async (request, reply) => {
      try {
        await service.uninstall(request.params.id);
        reply.code(204).send();
      } catch (err) {
        sendAddonError(reply, err);
      }
    },
  );
};
