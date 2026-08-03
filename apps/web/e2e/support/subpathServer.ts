/**
 * Minimal same-process static file server + reverse proxy used ONLY by the
 * sub-path smoke test (E01-T2 acceptance criterion #4).
 *
 * apps/core always serves the SPA at `/` (root) — it's not this task's job
 * to add sub-path-prefix serving to the core (that's out of scope / not
 * "apps/web/src"). Instead, this test-only server proves the *frontend's*
 * contract holds: because `vite.config.ts` uses `base: './'` and MapView
 * builds all tile/API URLs from `import.meta.env.BASE_URL`, the exact same
 * built `apps/web/dist` output works correctly when served from an
 * arbitrary path prefix — it never hardcodes an absolute `/...` URL.
 *
 * This server: serves static files from `distDir` under `prefix`, and
 * transparently proxies `prefix/api/*`, `prefix/tiles/*` (including Range
 * requests) AND `prefix/ws/*` (HTTP Upgrade / WebSocket) through to the
 * already-running core instance.
 *
 * E10-T1: the WebSocket half was missing. docs/07 §5 flow 9 requires the
 * ingress simulation to prove "alle Assets, WS und Tiles laden", and a real
 * Home-Assistant ingress is exactly a reverse proxy that must forward the
 * Upgrade handshake too -- so the proxy that stands in for it has to do the
 * same, or the flow's WS clause is untested.
 */

import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'http';
import type { Socket } from 'net';
import { createReadStream, existsSync, statSync } from 'fs';
import { extname, join, normalize, sep } from 'path';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

export interface SubpathServerOptions {
  /** URL prefix, no trailing slash, e.g. "/hassio_ingress/<token>". */
  prefix: string;
  /** Directory containing the built web app (apps/web/dist). */
  distDir: string;
  /** Port of the already-running core instance to proxy /api and /tiles to. */
  corePort: number;
  /** Port this server itself listens on. */
  port: number;
}

export interface SubpathServerHandle {
  close: () => Promise<void>;
}

export function startSubpathServer(options: SubpathServerOptions): Promise<SubpathServerHandle> {
  const { prefix, distDir, corePort, port } = options;

  const server = createServer((req, res) => {
    handleRequest(req, res, { prefix, distDir, corePort });
  });

  // WebSocket (HTTP Upgrade) proxying -- see the file header.
  server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '/';
    if (!url.startsWith(prefix)) {
      socket.destroy();
      return;
    }
    proxyUpgradeToCore(req, socket as Socket, head, corePort, url.slice(prefix.length) || '/');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        close: () =>
          new Promise((resolveClose) => {
            server.close(() => resolveClose());
          }),
      });
    });
  });
}

function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { prefix: string; distDir: string; corePort: number },
): void {
  const { prefix, distDir, corePort } = opts;
  const url = req.url ?? '/';

  if (!url.startsWith(prefix)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found (outside configured sub-path prefix)');
    return;
  }

  const rest = url.slice(prefix.length) || '/';

  if (rest.startsWith('/api/') || rest.startsWith('/tiles/')) {
    proxyToCore(req, res, corePort, rest);
    return;
  }

  serveStatic(res, distDir, rest);
}

function proxyToCore(
  req: IncomingMessage,
  res: ServerResponse,
  corePort: number,
  targetPath: string,
): void {
  const proxyReq = httpRequest(
    {
      host: '127.0.0.1',
      port: corePort,
      method: req.method,
      path: targetPath,
      headers: req.headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad gateway');
  });
  req.pipe(proxyReq);
}

/** Forwards an HTTP Upgrade (WebSocket) handshake to the core and then pipes
 *  the two sockets together, exactly like a reverse proxy in front of ingress. */
function proxyUpgradeToCore(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
  corePort: number,
  targetPath: string,
): void {
  const proxyReq = httpRequest({
    host: '127.0.0.1',
    port: corePort,
    method: req.method,
    path: targetPath,
    headers: req.headers,
  });

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    const statusLine = [
      'HTTP/1.1 101 Switching Protocols',
      ...Object.entries(proxyRes.headers).flatMap(([key, value]) =>
        value === undefined ? [] : [`${key}: ${Array.isArray(value) ? value.join(', ') : value}`],
      ),
      '',
      '',
    ].join('\r\n');
    socket.write(statusLine);
    if (proxyHead && proxyHead.length > 0) socket.unshift(proxyHead);
    proxySocket.on('error', () => socket.destroy());
    socket.on('error', () => proxySocket.destroy());
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  proxyReq.on('response', () => {
    // The core declined the upgrade -- nothing sane to forward.
    socket.destroy();
  });
  proxyReq.on('error', () => socket.destroy());

  if (head && head.length > 0) proxyReq.write(head);
  proxyReq.end();
}

function serveStatic(res: ServerResponse, distDir: string, requestPath: string): void {
  // Defense in depth against ../ traversal, even though this only ever
  // serves a local build directory in a test harness.
  const normalized = normalize(requestPath).split(sep).filter((seg) => seg !== '..');
  const safePath = normalized.join(sep) || sep;

  let filePath = join(distDir, safePath === sep ? 'index.html' : safePath);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    // SPA fallback, mirroring apps/core's own notFoundHandler behavior.
    filePath = join(distDir, 'index.html');
  }

  const contentType = MIME_TYPES[extname(filePath)] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  createReadStream(filePath).pipe(res);
}
