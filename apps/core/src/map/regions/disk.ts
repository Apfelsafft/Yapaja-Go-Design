/**
 * Disk-space pre-check for region downloads (W-18: "Disk voll").
 *
 * This task (E01-T5) only downloads the raw `.pmtiles` file, so the safety
 * factor here is 1x (required = remaining download bytes) plus a flat 1 GB
 * reserve. Note for later: once a Valhalla graph-build step runs on top of
 * a downloaded extract (a later task), that step's own disk check needs a
 * much larger factor -- docs/08-wargame.md W-18 calls out ~2.5x for graph
 * build (temp working set + final graph alongside the source extract). Do
 * not reuse this 1x/1GB constant for that check without revisiting it.
 */

import { statfs as fsStatfs } from 'fs/promises';

export interface DiskStats {
  /** Free blocks available to an unprivileged user. */
  bavail: number;
  /** Block size in bytes. */
  bsize: number;
}

export type StatfsFn = (path: string) => Promise<DiskStats>;

/** Flat safety reserve kept free below the raw "enough bytes" threshold. */
export const DISK_SAFETY_MARGIN_BYTES = 1_000_000_000; // 1 GB

export interface DiskCheckResult {
  ok: boolean;
  requiredBytes: number;
  freeBytes: number;
}

/**
 * Checks whether `requiredBytes` can be safely downloaded into `dirPath`'s
 * filesystem, i.e. `requiredBytes <= freeBytes - DISK_SAFETY_MARGIN_BYTES`.
 * `statfsFn` is injectable so tests can simulate a near-full disk without
 * needing a real small filesystem.
 */
export async function checkDiskSpace(
  dirPath: string,
  requiredBytes: number,
  statfsFn: StatfsFn = fsStatfs,
): Promise<DiskCheckResult> {
  const stats = await statfsFn(dirPath);
  const freeBytes = stats.bavail * stats.bsize;
  const ok = requiredBytes <= freeBytes - DISK_SAFETY_MARGIN_BYTES;
  return { ok, requiredBytes, freeBytes };
}
