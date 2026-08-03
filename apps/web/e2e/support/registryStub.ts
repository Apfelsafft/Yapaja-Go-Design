/**
 * Minimal stub add-on-registry HTTP server for store.spec.ts (E09-T7, W-11/
 * W-13). Serves `/index.json` (mutable, set via `setIndexEntries`) and
 * `/tarball/<name>` (mutable, via `setTarball`) on a FIXED port the
 * dedicated `STORE_CORE_PORT` core's `ADDONS_REGISTRY_URL` already points at
 * (see `globalSetup.ts`) -- same "spec owns the stub, core is pre-pointed at
 * its fixed port" pattern as `valhallaStub.ts`.
 *
 * `goOffline()`/`goOnline()` actually stop/restart listening on the port
 * (rather than e.g. returning 500s) so a Store sync attempt during
 * "offline" gets a genuine connection-refused, exactly W-13's "Registry
 * nicht erreichbar" scenario -- not a simulated error response.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { Buffer } from 'node:buffer';

export interface RegistryStub {
  baseUrl: string;
  indexUrl: string;
  /** Replaces the ENTIRE served `index.json` array. */
  setIndexEntries(entries: readonly unknown[]): void;
  /** Registers `bytes` under `/tarball/<name>`, returning the full URL to
   *  use as a `download_url`. */
  setTarball(name: string, bytes: Buffer): string;
  /** Stops accepting connections -- a sync attempt against `indexUrl` while
   *  offline gets ECONNREFUSED. */
  goOffline(): Promise<void>;
  /** Re-listens on the SAME port with the same (mutable) served state. */
  goOnline(): Promise<void>;
  close(): Promise<void>;
}

export async function startRegistryStub(port: number): Promise<RegistryStub> {
  let entries: readonly unknown[] = [];
  const tarballs = new Map<string, Buffer>();
  let server: Server | null = null;

  function handler(req: IncomingMessage, res: ServerResponse): void {
    if (req.method === 'GET' && req.url === '/index.json') {
      const body = JSON.stringify(entries);
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) });
      res.end(body);
      return;
    }
    if (req.method === 'GET' && req.url?.startsWith('/tarball/')) {
      const name = decodeURIComponent(req.url.slice('/tarball/'.length));
      const bytes = tarballs.get(name);
      if (!bytes) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-length': String(bytes.length) });
      res.end(bytes);
      return;
    }
    res.writeHead(404);
    res.end();
  }

  async function listen(): Promise<void> {
    const s = createServer(handler);
    await new Promise<void>((resolve, reject) => {
      s.once('error', reject);
      s.listen(port, '127.0.0.1', () => resolve());
    });
    server = s;
  }

  await listen();

  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    indexUrl: `${baseUrl}/index.json`,
    setIndexEntries: (e) => {
      entries = e;
    },
    setTarball: (name, bytes) => {
      tarballs.set(name, bytes);
      return `${baseUrl}/tarball/${encodeURIComponent(name)}`;
    },
    goOffline: () =>
      new Promise<void>((resolve, reject) => {
        if (!server) return resolve();
        server.close((err) => (err ? reject(err) : resolve()));
        server = null;
      }),
    goOnline: () => listen(),
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (!server) return resolve();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
