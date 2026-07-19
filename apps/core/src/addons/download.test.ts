/* eslint-disable no-undef -- `setInterval`/`clearInterval` are standard Node
 * globals (typed via @types/node); same justification as
 * `position/deadReckoning.ts`. */

/**
 * Unit tests for `downloadTarball` (E09-T1 §2 step 1, URL/registry install
 * path). Targets a local `http.createServer()` mock on an ephemeral port,
 * mirroring `map/regions/routes.test.ts`'s pattern -- never a real host.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { Buffer } from 'node:buffer';
import { downloadTarball } from './download.js';
import { AddonError } from './errors.js';

let mockServer: Server;
let mockPort: number;
let responseBody: Buffer;
let responseStatus: number;
let slowInfinite: boolean;

function requestHandler(_req: IncomingMessage, res: ServerResponse): void {
  if (slowInfinite) {
    res.writeHead(200);
    // Never end the response -- used for an oversized-response test where
    // the download must abort as soon as the byte cap is exceeded, without
    // waiting for the (never-arriving) end of the stream.
    const chunk = Buffer.alloc(64 * 1024, 7);
    const interval = setInterval(() => {
      if (res.destroyed) {
        clearInterval(interval);
        return;
      }
      res.write(chunk);
    }, 5);
    res.on('close', () => clearInterval(interval));
    return;
  }
  res.writeHead(responseStatus, { 'Content-Length': String(responseBody.length) });
  res.end(responseBody);
}

beforeEach(async () => {
  responseBody = Buffer.from('fake tarball bytes');
  responseStatus = 200;
  slowInfinite = false;
  mockServer = createServer(requestHandler);
  await new Promise<void>((resolveListen) => mockServer.listen(0, '127.0.0.1', resolveListen));
  const address = mockServer.address();
  if (address === null || typeof address === 'string') throw new Error('mock server did not bind');
  mockPort = address.port;
});

afterEach(async () => {
  await new Promise<void>((resolveClose) => mockServer.close(() => resolveClose()));
});

describe('downloadTarball', () => {
  it('downloads the full body on a 200 response', async () => {
    const bytes = await downloadTarball({
      url: `http://127.0.0.1:${mockPort}/addon.tar.gz`,
      maxBytes: 1024 * 1024,
    });
    expect(bytes.equals(responseBody)).toBe(true);
  });

  it('rejects a non-200 status', async () => {
    responseStatus = 404;
    await expect(
      downloadTarball({ url: `http://127.0.0.1:${mockPort}/missing.tar.gz`, maxBytes: 1024 }),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
  });

  it('rejects (and stops downloading) once received bytes exceed maxBytes', async () => {
    slowInfinite = true;
    await expect(
      downloadTarball({ url: `http://127.0.0.1:${mockPort}/huge.tar.gz`, maxBytes: 200_000 }),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_TOO_LARGE' });
  });

  it('rejects an unreachable host', async () => {
    await expect(
      downloadTarball({ url: 'http://127.0.0.1:1/nope.tar.gz', maxBytes: 1024, timeoutMs: 2000 }),
    ).rejects.toBeInstanceOf(Error);
  });

  it('rejects a non-http(s) URL scheme', async () => {
    await expect(downloadTarball({ url: 'file:///etc/passwd', maxBytes: 1024 })).rejects.toMatchObject({
      code: 'DOWNLOAD_FAILED',
    });
  });

  it('rejects a malformed URL', async () => {
    await expect(downloadTarball({ url: 'not a url', maxBytes: 1024 })).rejects.toBeInstanceOf(AddonError);
  });
});
