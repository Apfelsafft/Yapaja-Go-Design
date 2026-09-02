/**
 * Resumable region-tile download (E01-T5, W-17 "Update/Resume").
 *
 * Downloads into `<region>.pmtiles.part` and only atomically renames to
 * `<region>.pmtiles` once the transfer is complete (and, if the catalog
 * entry declares one, its sha256 matches) -- so a half-downloaded file can
 * never appear as an installed region (`listRegions()` only looks at
 * `.pmtiles` files, never `.part`).
 *
 * Resume: if a `.part` file already exists, we re-request with
 * `Range: bytes=<existing size>-`. If the server honors it (206) we append
 * from that offset; if it doesn't (any 200 response to a resumed request)
 * we restart the `.part` file from scratch rather than corrupt it by
 * appending a full-file body after existing partial bytes.
 *
 * Error handling: network/timeout errors leave the `.part` file in place
 * so a subsequent POST can resume it (W-17); a sha256 mismatch deletes the
 * `.part` file (the bytes are actively known-bad, keeping them around only
 * invites a corrupt "resume") and reports a job error. Either way the job
 * ends in `error` state with a message -- never a silent failure -- and the
 * core process itself is unaffected (the download runs off the request
 * that started it).
 */

import { createHash } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { rename, stat, unlink } from 'fs/promises';
import { join } from 'path';
import http from 'http';
import https from 'https';
import type { IncomingMessage } from 'http';
import { Buffer } from 'node:buffer';
import type { CatalogEntry } from './catalog.js';
import type { JobRegistry } from './jobs.js';

/** Socket inactivity timeout for the download request. */
export const DOWNLOAD_TIMEOUT_MS = 30_000;

export function partFileName(regionId: string): string {
  return `${regionId}.pmtiles.part`;
}

export function finalFileName(regionId: string): string {
  return `${regionId}.pmtiles`;
}

export function partFilePath(tilesDir: string, regionId: string): string {
  return join(tilesDir, partFileName(regionId));
}

export function finalFilePath(tilesDir: string, regionId: string): string {
  return join(tilesDir, finalFileName(regionId));
}

/** Bytes already present in a `.part` file, or 0 if it doesn't exist. */
export async function existingPartBytes(path: string): Promise<number> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : 0;
  } catch {
    return 0;
  }
}

/** Pure helper (unit-tested): the `Range` header value for resuming from
 *  `resumeFrom` bytes, or undefined for a fresh download. */
export function buildRangeHeader(resumeFrom: number): string | undefined {
  return resumeFrom > 0 ? `bytes=${resumeFrom}-` : undefined;
}

/** Pure helper (unit-tested): bytes still needed for the disk check,
 *  accounting for what a resumable `.part` file already has on disk. */
export function computeRemainingBytes(totalSizeBytes: number, resumeFrom: number): number {
  return Math.max(0, totalSizeBytes - resumeFrom);
}

function requestFn(url: string): typeof http.request {
  return url.startsWith('https:') ? https.request : http.request;
}

async function hashFile(path: string): Promise<string> {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolveHash(hash.digest('hex')));
    stream.on('error', rejectHash);
  });
}

interface StreamToFileParams {
  url: string;
  dest: string;
  resumeFrom: number;
  jobId: string;
  jobs: JobRegistry;
}

/**
 * Performs the HTTP request and streams the response body into `dest`,
 * reporting progress into the job registry as bytes arrive. Resolves once
 * the file write is flushed to disk; rejects on network/timeout/HTTP-status
 * errors (the `.part` file is left as-is for a future resume attempt).
 */
function streamToFile({ url, dest, resumeFrom, jobId, jobs }: StreamToFileParams): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const settleOk = (): void => {
      if (!settled) {
        settled = true;
        resolvePromise();
      }
    };
    const settleErr = (err: Error): void => {
      if (!settled) {
        settled = true;
        rejectPromise(err);
      }
    };

    const headers: Record<string, string> = {};
    const rangeHeader = buildRangeHeader(resumeFrom);
    if (rangeHeader) {
      headers.Range = rangeHeader;
    }

    const req = requestFn(url)(
      url,
      { headers, timeout: DOWNLOAD_TIMEOUT_MS },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0;
        if (status !== 200 && status !== 206) {
          res.resume();
          settleErr(new Error(`Unexpected HTTP status ${status} downloading region tiles`));
          return;
        }

        // A resume attempt where the server ignores Range and answers 200
        // (full body) must restart the .part file from byte 0 -- never
        // append the full body after our existing partial bytes.
        const isFullRestart = status === 200 && resumeFrom > 0;
        const writeStart = isFullRestart ? 0 : resumeFrom;

        const out = createWriteStream(
          dest,
          writeStart > 0 ? { flags: 'r+', start: writeStart } : { flags: 'w' },
        );

        let bytesWritten = writeStart;
        const contentLengthHeader = res.headers['content-length'];
        const contentLength =
          typeof contentLengthHeader === 'string' ? parseInt(contentLengthHeader, 10) : null;
        const totalBytes =
          contentLength !== null && !Number.isNaN(contentLength) ? writeStart + contentLength : null;

        jobs.updateProgress(jobId, bytesWritten, totalBytes ?? undefined);

        res.on('data', (chunk: Buffer) => {
          bytesWritten += chunk.length;
          jobs.updateProgress(jobId, bytesWritten, totalBytes ?? undefined);
          if (jobs.isCancelled(jobId)) {
            res.unpipe(out);
            out.end();
            res.destroy();
            req.destroy();
          }
        });

        res.on('error', (err) => settleErr(err));
        out.on('error', (err) => settleErr(err));
        out.on('finish', () => settleOk());

        res.pipe(out);
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Download timed out after ${DOWNLOAD_TIMEOUT_MS}ms of inactivity`));
    });
    req.on('error', (err) => settleErr(err instanceof Error ? err : new Error(String(err))));
    req.end();
  });
}

/**
 * Runs a full download job to completion (or failure) in the background.
 * The caller (route handler) creates the job, checks disk space, responds
 * 202 immediately, and fires this without awaiting it.
 */
export function runDownloadJob(
  jobId: string,
  jobs: JobRegistry,
  entry: CatalogEntry,
  tilesDir: string,
): void {
  void (async () => {
    const dest = partFilePath(tilesDir, entry.id);
    const final = finalFilePath(tilesDir, entry.id);
    const resumeFrom = await existingPartBytes(dest);

    if (jobs.isCancelled(jobId)) {
      jobs.markError(jobId, { code: 'CANCELLED', message: 'Download cancelled' });
      return;
    }

    // Ein Katalogeintrag OHNE `url` ist kein Fehler, sondern eine Region, die
    // GEBAUT statt geladen wird (`services/tiles/build-pmtiles.sh`) -- seit
    // klar ist, dass es keine fertigen PMTiles zum Herunterladen gibt. Ein
    // Download-Job darf dafuer trotzdem nicht still nichts tun: er endet mit
    // einer Meldung, die sagt, was stattdessen zu tun ist.
    if (!entry.url) {
      jobs.markError(jobId, {
        code: 'NO_DOWNLOAD_URL',
        message:
          `Für die Region "${entry.id}" gibt es keine Download-Quelle. ` +
          'Diese Kacheln werden aus einem OSM-Extrakt gebaut. Im Add-on-Container: ' +
          'yapaja-build-pmtiles <url-oder-pfad-zur.osm.pbf>. ' +
          'Aus einem Repository-Checkout: services/tiles/build-pmtiles.sh <pfad>.',
      });
      return;
    }

    jobs.markRunning(jobId, entry.sizeBytes);

    try {
      await streamToFile({ url: entry.url, dest, resumeFrom, jobId, jobs });
    } catch (err) {
      // A cancellation forcibly destroys the in-flight request/response,
      // which surfaces here as a stream error -- check isCancelled() first
      // so a user-requested cancel is reported as CANCELLED, not a generic
      // (and misleading) DOWNLOAD_FAILED.
      if (jobs.isCancelled(jobId)) {
        jobs.markError(jobId, { code: 'CANCELLED', message: 'Download cancelled' });
        return;
      }
      jobs.markError(jobId, {
        code: 'DOWNLOAD_FAILED',
        message: err instanceof Error ? err.message : 'Download failed',
      });
      return;
    }

    if (jobs.isCancelled(jobId)) {
      jobs.markError(jobId, { code: 'CANCELLED', message: 'Download cancelled' });
      return;
    }

    if (entry.sha256) {
      let actualHash: string;
      try {
        actualHash = await hashFile(dest);
      } catch (err) {
        jobs.markError(jobId, {
          code: 'DOWNLOAD_FAILED',
          message: `Failed to verify downloaded file: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }
      if (actualHash.toLowerCase() !== entry.sha256.toLowerCase()) {
        await unlink(dest).catch(() => {
          // Best-effort cleanup; even if it fails, the job error below still
          // prevents the file from ever being treated as installed (only a
          // successful rename below does that).
        });
        jobs.markError(jobId, {
          code: 'HASH_MISMATCH',
          message: `Downloaded file hash does not match the catalog (expected ${entry.sha256}, got ${actualHash})`,
        });
        return;
      }
    }

    await rename(dest, final);
    jobs.markDone(jobId);
  })();
}
