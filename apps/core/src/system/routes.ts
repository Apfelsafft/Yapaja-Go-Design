/**
 * Fastify route for real system resource stats (E08-T5, W-12/W-18).
 * Prefix: /api/v1.
 *
 *  - GET /api/v1/system/resources -> `{ data: SystemResources }`, real
 *    measured free/total disk (of the map-tiles data dir) + free/total RAM.
 *
 * Consumed by the onboarding wizard's region step to derive a "< 3 GB free
 * -> recommend turning Photon off" recommendation client-side (see
 * `apps/web/src/onboarding/resourceRecommendation.ts`) -- this endpoint only
 * reports the raw numbers, it never hardcodes or embeds the recommendation
 * itself.
 */

import type { FastifyPluginAsync } from 'fastify';
import { resolveTilesDir } from '../map/paths.js';
import { getSystemResources, type FullStatfsFn, type SystemResources } from './resources.js';

export interface SystemPluginOptions {
  /** Defaults to the map tiles dir (`TILES_DIR`/`resolveTilesDir()`) -- the
   *  filesystem that actually matters for "can a region download fit". */
  dataDir?: string;
  /** Injectable for tests; defaults to the real `fs.statfs`. */
  statfsFn?: FullStatfsFn;
  /** Injectable for tests; defaults to the real `os.freemem`. */
  freeMemFn?: () => number;
  /** Injectable for tests; defaults to the real `os.totalmem`. */
  totalMemFn?: () => number;
}

interface SystemResourcesReply {
  data: SystemResources;
}

export const systemPlugin: FastifyPluginAsync<SystemPluginOptions> = async (fastify, opts) => {
  const dataDir = opts.dataDir ?? resolveTilesDir();

  fastify.get<{ Reply: SystemResourcesReply }>('/api/v1/system/resources', async (_request, reply) => {
    const data = await getSystemResources(dataDir, {
      statfsFn: opts.statfsFn,
      freeMemFn: opts.freeMemFn,
      totalMemFn: opts.totalMemFn,
    });
    reply.code(200).send({ data });
  });
};
