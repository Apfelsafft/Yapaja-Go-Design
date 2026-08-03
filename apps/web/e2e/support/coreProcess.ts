/**
 * Shared Playwright-harness plumbing for booting REAL, built Core processes.
 *
 * Extracted verbatim from `globalSetup.ts` (E01-T2) in E09-T6 so a SECOND
 * global setup -- the dedicated security-suite one in
 * `e2e/security/support/globalSetup.ts` -- can boot its own Core with exactly
 * the same mechanics (same build step, same staged `public/` dir, same env
 * conventions, same health-wait) instead of inventing a parallel harness.
 * `globalSetup.ts` imports these; nothing about its behaviour changed.
 */

import { execSync, spawn, type ChildProcess } from 'child_process';
import { existsSync, mkdirSync, rmSync, cpSync } from 'fs';
import { REPO_ROOT, CORE_ROOT, CORE_DIST_INDEX, CORE_PUBLIC_DIR, WEB_DIST_DIR } from './constants.js';

/** Polls `/api/v1/health` until the Core answers, or throws after `timeoutMs`. */
export async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
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

/** Builds the production web + core artifacts (never the dev server). */
export function buildApps(): void {
  execSync('pnpm --filter @yapaja/web build', { cwd: REPO_ROOT, stdio: 'inherit' });
  execSync('pnpm --filter @yapaja/core build', { cwd: REPO_ROOT, stdio: 'inherit' });
}

/** Stages the built web app as the Core's static `public/` dir, exactly like
 *  `apps/core/Dockerfile` does. Must run before any Core process boots. */
export function preparePublicDir(): void {
  if (!existsSync(WEB_DIST_DIR)) {
    throw new Error(`Expected web build output at ${WEB_DIST_DIR}, but it does not exist.`);
  }
  rmSync(CORE_PUBLIC_DIR, { recursive: true, force: true });
  cpSync(WEB_DIST_DIR, CORE_PUBLIC_DIR, { recursive: true });
}

/** Wipes and re-creates a directory (tiles/add-ons/storage fixtures). */
export function resetDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

/**
 * Spawns one built Core on `port` with its own tiles dir and an in-memory DB
 * (`DB_PATH=:memory:` -- per-process, so parallel cores never fight over one
 * SQLite file). Output is buffered and only surfaced if the process dies.
 */
export function startCore(
  port: number,
  tilesDir: string,
  extraEnv: Record<string, string> = {},
): ChildProcess {
  const child = spawn('node', [CORE_DIST_INDEX], {
    cwd: CORE_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      TILES_DIR: tilesDir,
      DB_PATH: ':memory:',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

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
