/**
 * Fetches a tarball from a registry/direct URL for `POST /api/v1/addons/install
 * {source:'url'}` (E09-T1, docs/05 §5). Mirrors `map/regions/download.ts`'s
 * plain `http`/`https` request pattern (rather than global `fetch`, to stay
 * consistent with the rest of this codebase's download code) but buffers
 * the WHOLE response in memory instead of streaming to a file -- the
 * install pipeline needs the complete bytes anyway (sha256 verification,
 * then tarball extraction), and the 50 MB compressed-size cap keeps this
 * bounded.
 *
 * The compressed-size cap is enforced WHILE STREAMING the response (not
 * just checked against `Content-Length` afterward, which a malicious/
 * misconfigured server could lie about): the connection is aborted the
 * moment received bytes exceed `maxBytes`.
 */

import http from 'http';
import https from 'https';
import type { IncomingMessage } from 'http';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { AddonError } from './errors.js';

export const DOWNLOAD_TIMEOUT_MS = 30_000;

function requestFn(url: string): typeof http.request {
  return url.startsWith('https:') ? https.request : http.request;
}

export interface DownloadTarballOptions {
  url: string;
  /** Compressed-byte cap; the download aborts the moment received bytes
   *  exceed this (E09-T1 §2: "reject if the received/compressed size >
   *  50 MB"). */
  maxBytes: number;
  timeoutMs?: number;
}

/** Downloads `url` fully into memory, enforcing `maxBytes` while streaming.
 *  Throws {@link AddonError} (`DOWNLOAD_FAILED`/`DOWNLOAD_TOO_LARGE`) on any
 *  failure -- never returns a partial/truncated buffer. */
export function downloadTarball(opts: DownloadTarballOptions): Promise<Buffer> {
  const { url, maxBytes, timeoutMs = DOWNLOAD_TIMEOUT_MS } = opts;

  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const settleOk = (buf: Buffer): void => {
      if (!settled) {
        settled = true;
        resolvePromise(buf);
      }
    };
    const settleErr = (err: Error): void => {
      if (!settled) {
        settled = true;
        rejectPromise(err);
      }
    };

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      settleErr(new AddonError('DOWNLOAD_FAILED', `Invalid URL: ${url}`));
      return;
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      settleErr(new AddonError('DOWNLOAD_FAILED', `Unsupported URL scheme: ${parsedUrl.protocol}`));
      return;
    }

    const req = requestFn(url)(url, { timeout: timeoutMs }, (res: IncomingMessage) => {
      const status = res.statusCode ?? 0;
      if (status !== 200) {
        res.resume();
        settleErr(new AddonError('DOWNLOAD_FAILED', `Unexpected HTTP status ${status} fetching add-on tarball`));
        return;
      }

      const chunks: Buffer[] = [];
      let total = 0;

      res.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          res.destroy();
          req.destroy();
          settleErr(
            new AddonError(
              'DOWNLOAD_TOO_LARGE',
              `Add-on tarball exceeds the ${maxBytes}-byte compressed-size cap`,
            ),
          );
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        if (!settled) settleOk(Buffer.concat(chunks));
      });
      res.on('error', (err) => settleErr(err instanceof Error ? err : new Error(String(err))));
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Download timed out after ${timeoutMs}ms of inactivity`));
    });
    req.on('error', (err) =>
      settleErr(
        err instanceof AddonError
          ? err
          : new AddonError('DOWNLOAD_FAILED', err instanceof Error ? err.message : String(err)),
      ),
    );
    req.end();
  });
}
