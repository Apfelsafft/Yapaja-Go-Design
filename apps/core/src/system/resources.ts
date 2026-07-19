/**
 * System resource snapshot (E08-T5, W-12/W-18 plausibility): real, MEASURED
 * free/total disk (of the data/tiles filesystem, same one the region
 * download disk-check in `map/regions/disk.ts` guards) and free/total RAM
 * (`node:os`). This is a pure DISPLAY endpoint for the onboarding wizard's
 * region step -- unlike `map/regions/disk.ts#checkDiskSpace` (which gates a
 * specific download against a specific required-bytes figure), this reports
 * the raw numbers so the client can derive its own "< 3 GB free -> recommend
 * turning Photon off" recommendation (see
 * `apps/web/src/onboarding/resourceRecommendation.ts`).
 *
 * `statfsFn`/`freeMemFn`/`totalMemFn` are all injectable so tests can prove
 * the numbers really flow from the (mocked) OS calls rather than being
 * hardcoded -- same "inject the syscall" pattern `checkDiskSpace` already
 * uses for `fs.statfs`.
 */

import { statfs as fsStatfs } from 'fs/promises';
import { freemem, totalmem } from 'os';
import { mkdir } from 'fs/promises';

/** The subset of Node's native `statfs` result this module needs. Includes
 *  `blocks` (total) on top of `map/regions/disk.ts#DiskStats`'s `bavail`
 *  (free) -- that module only ever needed "is there enough free space",
 *  this one also reports the total for a "X of Y free" display. */
export interface FullDiskStats {
  /** Free blocks available to an unprivileged user. */
  bavail: number;
  /** Total blocks on the filesystem. */
  blocks: number;
  /** Block size in bytes. */
  bsize: number;
}

export type FullStatfsFn = (path: string) => Promise<FullDiskStats>;

export interface SystemResources {
  disk_free_bytes: number;
  disk_total_bytes: number;
  mem_free_bytes: number;
  mem_total_bytes: number;
}

export interface GetSystemResourcesDeps {
  /** Defaults to the real `fs/promises.statfs`. */
  statfsFn?: FullStatfsFn;
  /** Defaults to the real `os.freemem`. */
  freeMemFn?: () => number;
  /** Defaults to the real `os.totalmem`. */
  totalMemFn?: () => number;
}

/**
 * Measures real free/total disk (of `dataDir`'s filesystem) and free/total
 * RAM. `dataDir` is created if it doesn't exist yet (mkdir -p, best-effort)
 * so a fresh install with no tiles downloaded yet doesn't fail `statfs`
 * with ENOENT -- mirrors the assumption `map/regions/disk.ts#checkDiskSpace`
 * already makes (its callers always pass an existing `tilesDir`).
 */
export async function getSystemResources(
  dataDir: string,
  deps: GetSystemResourcesDeps = {},
): Promise<SystemResources> {
  const statfsFn = deps.statfsFn ?? (fsStatfs as unknown as FullStatfsFn);
  const freeMemFn = deps.freeMemFn ?? freemem;
  const totalMemFn = deps.totalMemFn ?? totalmem;

  try {
    await mkdir(dataDir, { recursive: true });
  } catch {
    // Best-effort -- if this fails, the statfs call below will surface the
    // real underlying problem (permissions, invalid path, ...) on its own.
  }

  const stats = await statfsFn(dataDir);

  return {
    disk_free_bytes: stats.bavail * stats.bsize,
    disk_total_bytes: stats.blocks * stats.bsize,
    mem_free_bytes: freeMemFn(),
    mem_total_bytes: totalMemFn(),
  };
}
