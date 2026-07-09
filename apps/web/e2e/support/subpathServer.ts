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
 * transparently proxies `prefix/api/*` and `prefix/tiles/*` (including
 * Range requests) through to the already-running core instance.
 */

import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'http';
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
  /** URL prefix, no trailing slash, e.g. "/rv-demo". */
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
