/**
 * Region-manager routes (E01-T5, docs/03-api-spec.md §2 "Karten & Tiles"):
 *
 * - GET    /api/v1/map/regions/catalog   downloadable regions + `installed` flag
 * - POST   /api/v1/map/regions           starts a resumable download job (202)
 * - DELETE /api/v1/map/regions/:id       removes an installed region (409 if last)
 * - GET    /api/v1/jobs/:id              job status (progress/bytes/error)
 * - DELETE /api/v1/jobs/:id              cancels a queued/running job
 *
 * `GET /api/v1/map/regions` (listing installed regions) already lives in
 * `../routes.ts` (E01-T1) and is untouched -- this plugin is registered
 * alongside it by `mapPlugin`, purely additive.
 */

import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import type { FastifyPluginAsync } from 'fastify';
import type { ApiError } from '@yapaja/shared';
import { REGION_NAME_PATTERN, resolveRegionFilePath, resolveTilesDir } from '../paths.js';
import { listRegions } from '../regions.js';
import { loadCatalog, type CatalogEntry } from './catalog.js';
import { checkDiskSpace, type StatfsFn } from './disk.js';
import { computeRemainingBytes, existingPartBytes, finalFilePath, partFilePath, runDownloadJob } from './download.js';
import { JobRegistry, type JobSnapshot } from './jobs.js';

export interface RegionsPluginOptions {
  /** Injectable for tests (simulates a near-full disk); defaults to the
   *  real `fs.statfs`. */
  statfsImpl?: StatfsFn;
}

interface CatalogReplyEntry extends CatalogEntry {
  installed: boolean;
}

interface CatalogReply {
  data: CatalogReplyEntry[];
}

interface PostRegionsBody {
  region_id?: string;
}

interface PostRegionsReply {
  job_id: string;
}

interface JobReply {
  data: JobSnapshot;
}

interface IdParams {
  id: string;
}

function createErrorResponse(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ApiError {
  return {
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
}

export const regionsPlugin: FastifyPluginAsync<RegionsPluginOptions> = async (fastify, opts) => {
  const tilesDir = resolveTilesDir();
  const jobs = new JobRegistry();
  const statfsImpl = opts.statfsImpl;

  // GET /api/v1/map/regions/catalog -- downloadable regions + installed flag.
  fastify.get<{ Reply: CatalogReply | ApiError }>(
    '/api/v1/map/regions/catalog',
    async (_request, reply) => {
      let catalog: CatalogEntry[];
      try {
        catalog = await loadCatalog();
      } catch (err) {
        fastify.log.error({ error: (err as Error).message }, 'Failed to load regions catalog');
        return reply
          .code(500)
          .send(createErrorResponse('CATALOG_UNAVAILABLE', 'Regions catalog could not be loaded'));
      }
      const installedRegions = await listRegions(tilesDir, fastify.log);
      const installedIds = new Set(installedRegions.map((r) => r.region));
      const data = catalog.map((entry) => ({ ...entry, installed: installedIds.has(entry.id) }));
      return reply.code(200).send({ data });
    },
  );

  // POST /api/v1/map/regions -- starts a resumable download job (W-17).
  fastify.post<{ Body: PostRegionsBody; Reply: PostRegionsReply | ApiError }>(
    '/api/v1/map/regions',
    async (request, reply) => {
      const regionId = request.body?.region_id;
      if (!regionId || typeof regionId !== 'string' || !REGION_NAME_PATTERN.test(regionId)) {
        return reply
          .code(400)
          .send(createErrorResponse('INVALID_REGION', 'region_id is required and must be a valid region slug'));
      }

      let catalog: CatalogEntry[];
      try {
        catalog = await loadCatalog();
      } catch (err) {
        fastify.log.error({ error: (err as Error).message }, 'Failed to load regions catalog');
        return reply
          .code(500)
          .send(createErrorResponse('CATALOG_UNAVAILABLE', 'Regions catalog could not be loaded'));
      }

      const entry = catalog.find((candidate) => candidate.id === regionId);
      if (!entry) {
        return reply
          .code(404)
          .send(createErrorResponse('NOT_FOUND', `Unknown catalog region '${regionId}'`));
      }

      const finalPath = finalFilePath(tilesDir, regionId);
      if (existsSync(finalPath)) {
        return reply
          .code(409)
          .send(createErrorResponse('ALREADY_INSTALLED', `Region '${regionId}' is already installed`));
      }

      // Resume-aware: only the bytes still missing need to fit, not the
      // full catalog size, so retrying an interrupted download doesn't get
      // needlessly rejected once most of it is already on disk.
      const resumeFrom = await existingPartBytes(partFilePath(tilesDir, regionId));
      const remainingBytes = computeRemainingBytes(entry.sizeBytes, resumeFrom);

      const diskCheck = await checkDiskSpace(tilesDir, remainingBytes, statfsImpl);
      if (!diskCheck.ok) {
        return reply.code(409).send(
          createErrorResponse(
            'INSUFFICIENT_SPACE',
            'Not enough free disk space to download this region',
            { requiredBytes: diskCheck.requiredBytes, freeBytes: diskCheck.freeBytes },
          ),
        );
      }

      const jobId = jobs.create();
      runDownloadJob(jobId, jobs, entry, tilesDir);
      return reply.code(202).send({ job_id: jobId });
    },
  );

  // DELETE /api/v1/map/regions/:id -- refuses to remove the last region.
  fastify.delete<{ Params: IdParams; Reply: ApiError | undefined }>(
    '/api/v1/map/regions/:id',
    async (request, reply) => {
      const regionId = request.params.id;
      if (!REGION_NAME_PATTERN.test(regionId)) {
        return reply.code(400).send(createErrorResponse('INVALID_REGION', 'Region name is invalid'));
      }

      const filePath = resolveRegionFilePath(tilesDir, regionId);
      if (!filePath || !existsSync(filePath)) {
        return reply.code(404).send(createErrorResponse('NOT_FOUND', `Region '${regionId}' not found`));
      }

      const installed = await listRegions(tilesDir, fastify.log);
      if (installed.length <= 1) {
        return reply
          .code(409)
          .send(createErrorResponse('LAST_REGION', 'Cannot delete the only installed region'));
      }

      await unlink(filePath);
      return reply.code(204).send(undefined);
    },
  );

  // GET /api/v1/jobs/:id -- job status (progress, bytes, error).
  fastify.get<{ Params: IdParams; Reply: JobReply | ApiError }>(
    '/api/v1/jobs/:id',
    async (request, reply) => {
      const job = jobs.get(request.params.id);
      if (!job) {
        return reply
          .code(404)
          .send(createErrorResponse('NOT_FOUND', `Job '${request.params.id}' not found`));
      }
      return reply.code(200).send({ data: job });
    },
  );

  // DELETE /api/v1/jobs/:id -- cancels a queued/running job.
  fastify.delete<{ Params: IdParams; Reply: ApiError | undefined }>(
    '/api/v1/jobs/:id',
    async (request, reply) => {
      const job = jobs.get(request.params.id);
      if (!job) {
        return reply
          .code(404)
          .send(createErrorResponse('NOT_FOUND', `Job '${request.params.id}' not found`));
      }
      const cancelled = jobs.cancel(request.params.id);
      if (!cancelled) {
        return reply
          .code(409)
          .send(createErrorResponse('JOB_NOT_CANCELLABLE', `Job '${request.params.id}' has already finished`));
      }
      return reply.code(204).send(undefined);
    },
  );
};
