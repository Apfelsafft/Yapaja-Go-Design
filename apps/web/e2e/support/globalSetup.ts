/**
 * Playwright global setup for the E01-T2 harness.
 *
 * Responsibilities:
 *  1. Build the web app and the core (so we test the real production
 *     artifacts, not the dev server).
 *  2. Stage the built web app as the core's static `public/` dir, exactly
 *     like `apps/core/Dockerfile` does (`COPY apps/web/dist apps/core/public`)
 *     — apps/core's entrypoint always serves from that fixed relative path,
 *     so this staging step must run before the core process boots.
 *  3. Generate a deterministic PMTiles fixture (reusing apps/core's own
 *     fixture generator — not duplicating it) into two tile directories: one
 *     with a region installed, one empty.
 *  4. Boot two core server processes (one per tiles dir) and wait for them
 *     to answer their health endpoint.
 *
 * Per Playwright's documented pattern, returning a function from the default
 * export registers it as the matching global teardown (kills both servers).
 *
 * IMPORTANT: this all happens in `globalSetup`, not in `webServer` config —
 * Playwright starts `webServer` entries *before* `globalSetup` runs, which
 * would race the public-dir staging above.
 */

import { execSync, spawn, type ChildProcess } from 'child_process';
import { existsSync, mkdirSync, rmSync, cpSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  REPO_ROOT,
  CORE_ROOT,
  CORE_DIST_INDEX,
  CORE_PUBLIC_DIR,
  WEB_DIST_DIR,
  FIXTURE_REGION,
  FIXTURE_TILES_DIR,
  EMPTY_TILES_DIR,
  CORE_PORT,
  EMPTY_CORE_PORT,
  CORE_BASE_URL,
  EMPTY_CORE_BASE_URL,
} from './constants.js';
// Reuse E01-T1's fixture generator directly (read-only import, apps/core is
// not modified) instead of hand-rolling another PMTiles binary writer.
import { buildPMTilesFixtureBuffer } from '../../../core/src/map/__fixtures__/pmtiles-fixture.js';

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      if (response.ok) {
        return;
      }
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `Core server at ${baseUrl} did not become healthy within ${timeoutMs}ms: ${String(lastError)}`,
  );
}

function buildApps(): void {
  execSync('pnpm --filter @yapaja/web build', { cwd: REPO_ROOT, stdio: 'inherit' });
  execSync('pnpm --filter @yapaja/core build', { cwd: REPO_ROOT, stdio: 'inherit' });
}

function preparePublicDir(): void {
  if (!existsSync(WEB_DIST_DIR)) {
    throw new Error(`Expected web build output at ${WEB_DIST_DIR}, but it does not exist.`);
  }
  rmSync(CORE_PUBLIC_DIR, { recursive: true, force: true });
  cpSync(WEB_DIST_DIR, CORE_PUBLIC_DIR, { recursive: true });
}

function prepareFixtureTilesDir(): void {
  rmSync(FIXTURE_TILES_DIR, { recursive: true, force: true });
  mkdirSync(FIXTURE_TILES_DIR, { recursive: true });
  const buffer = buildPMTilesFixtureBuffer({});
  writeFileSync(join(FIXTURE_TILES_DIR, `${FIXTURE_REGION}.pmtiles`), buffer);
}

function prepareEmptyTilesDir(): void {
  rmSync(EMPTY_TILES_DIR, { recursive: true, force: true });
  mkdirSync(EMPTY_TILES_DIR, { recursive: true });
}

function startCore(port: number, tilesDir: string): ChildProcess {
  const child = spawn('node', [CORE_DIST_INDEX], {
    cwd: CORE_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      TILES_DIR: tilesDir,
      // Each e2e core gets its own in-memory DB. The two cores (fixture-region
      // and empty-tiles) would otherwise share the default on-disk SQLite file
      // and race on it (SQLITE_BUSY: "database is locked") — flaky, and it hit
      // the slower CI runner. :memory: is per-process, so no file, no lock, and
      // no leftover state between runs.
      DB_PATH: ':memory:',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Buffer output; only surface it if the process fails to become healthy
  // (keeps normal test runs quiet — see waitForHealth's catch in the caller).
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`[e2e] core process on port ${port} exited with code ${code}:\n${output}`);
    }
  });

  return child;
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  buildApps();
  preparePublicDir();
  prepareFixtureTilesDir();
  prepareEmptyTilesDir();

  const fixtureCore = startCore(CORE_PORT, FIXTURE_TILES_DIR);
  const emptyCore = startCore(EMPTY_CORE_PORT, EMPTY_TILES_DIR);

  try {
    await Promise.all([
      waitForHealth(CORE_BASE_URL, 20_000),
      waitForHealth(EMPTY_CORE_BASE_URL, 20_000),
    ]);
  } catch (err) {
    fixtureCore.kill();
    emptyCore.kill();
    throw err;
  }

  return async () => {
    fixtureCore.kill();
    emptyCore.kill();
  };
}
