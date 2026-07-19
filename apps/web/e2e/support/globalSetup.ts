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
import { createServer, type Server } from 'http';
import {
  WEB_ROOT,
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
  SIMULATOR_CORE_PORT,
  SEARCH_CORE_PORT,
  FAVORITES_CORE_PORT,
  DRIVE_CORE_PORT,
  NAV_CONTROL_CORE_PORT,
  PROFILE_REROUTE_CORE_PORT,
  PROFILE_REROUTE_VALHALLA_BASE_URL,
  SHELL_CORE_PORT,
  SHELL_EDIT_CORE_PORT,
  DRIVE_LOCK_CORE_PORT,
  TOUCH_TARGETS_CORE_PORT,
  A11Y_CORE_PORT,
  PWA_CORE_PORT,
  ONBOARDING_CORE_PORT,
  ONBOARDING_TILES_DIR,
  ONBOARDING_REGION_ID,
  ONBOARDING_REGION_HTTP_PORT,
  CORE_BASE_URL,
  EMPTY_CORE_BASE_URL,
  SIMULATOR_CORE_BASE_URL,
  SEARCH_CORE_BASE_URL,
  FAVORITES_CORE_BASE_URL,
  DRIVE_CORE_BASE_URL,
  NAV_CONTROL_CORE_BASE_URL,
  PROFILE_REROUTE_CORE_BASE_URL,
  SHELL_CORE_BASE_URL,
  SHELL_EDIT_CORE_BASE_URL,
  DRIVE_LOCK_CORE_BASE_URL,
  TOUCH_TARGETS_CORE_BASE_URL,
  A11Y_CORE_BASE_URL,
  PWA_CORE_BASE_URL,
  ONBOARDING_CORE_BASE_URL,
} from './constants.js';
// Reuse E01-T1's fixture generator directly (read-only import, apps/core is
// not modified) instead of hand-rolling another PMTiles binary writer.
import { buildPMTilesFixtureBuffer } from '../../../core/src/map/__fixtures__/pmtiles-fixture.js';
// Reuse the wizard's own disclaimer-version constant (rather than a
// duplicated string literal here) so the consent seeded into every
// NON-onboarding core below can never silently drift out of sync with what
// `hasValidConsent()` actually checks client-side.
import { DISCLAIMER_VERSION } from '../../src/onboarding/state.js';

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

/** onboarding.spec.ts's core starts with NO region installed -- the wizard's
 *  region step downloads one itself. */
function prepareOnboardingTilesDir(): void {
  rmSync(ONBOARDING_TILES_DIR, { recursive: true, force: true });
  mkdirSync(ONBOARDING_TILES_DIR, { recursive: true });
}

/** A tiny local HTTP server serving the SAME deterministic PMTiles fixture
 *  buffer the other cores install directly -- but here served over HTTP so
 *  the onboarding wizard's region step can genuinely POST /api/v1/map/regions
 *  and watch a real (if instant) download job run to completion. Never a
 *  real foreign host, same rule `regions.spec.ts`/`routes.test.ts` follow. */
function startOnboardingRegionServer(buffer: Buffer): Server {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Length': String(buffer.length) });
    res.end(buffer);
  });
  server.listen(ONBOARDING_REGION_HTTP_PORT, '127.0.0.1');
  return server;
}

/** Writes a regions catalog (`MAP_REGIONS_CATALOG_FILE` override, same
 *  mechanism `disk-check.routes.test.ts`/`routes.test.ts` use) with a SINGLE
 *  entry pointing at the local fixture server above. */
function writeOnboardingCatalog(catalogPath: string, sizeBytes: number): void {
  writeFileSync(
    catalogPath,
    JSON.stringify([
      {
        id: ONBOARDING_REGION_ID,
        name: 'Wizard-Testregion',
        url: `http://127.0.0.1:${ONBOARDING_REGION_HTTP_PORT}/${ONBOARDING_REGION_ID}.pmtiles`,
        sizeBytes,
        bounds: [9.4, 47.0, 9.7, 47.3],
      },
    ]),
  );
}

/**
 * Seeds `settings.onboarding_state` as already-completed, WITH a valid
 * (current-version) disclaimer consent, on every core EXCEPT the dedicated
 * onboarding core. This is THE fix for the E08-T5 regression risk: without
 * it, `OnboardingWizard`'s full-screen overlay would auto-show on every one
 * of the 40+ pre-existing specs' cores (none of them ever set
 * `onboarding_state` themselves) and cover the UI those specs assert on --
 * and separately, `RoutingPanel`'s disclaimer gate
 * (`onboarding/store.ts#selectNavigationAllowed`) would disable "Navigation
 * starten" in drive.spec.ts/nav-control.spec.ts/etc. without a seeded
 * consent. Reuses the exact shape `patchOnboardingState`/`coerceOnboardingState`
 * (`apps/web/src/onboarding/{client,state}.ts`) expect, so it round-trips
 * exactly like a real wizard completion would have written it.
 */
async function seedOnboardingCompleted(baseUrl: string): Promise<void> {
  await fetch(`${baseUrl}/api/v1/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      onboarding_state: {
        step: 'mqtt',
        completed: true,
        disclaimer: { version: DISCLAIMER_VERSION, acceptedAt: new Date().toISOString() },
      },
    }),
  });
}

function startCore(port: number, tilesDir: string, extraEnv: Record<string, string> = {}): ChildProcess {
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
      ...extraEnv,
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
  prepareOnboardingTilesDir();

  // E08-T5: the onboarding core's own tiny region-download fixture -- a
  // local HTTP server serving the SAME deterministic PMTiles buffer the
  // other cores install directly onto disk, plus a catalog.json pointing at it.
  const onboardingRegionBuffer = buildPMTilesFixtureBuffer({});
  const onboardingRegionServer = startOnboardingRegionServer(onboardingRegionBuffer);
  const onboardingCatalogDir = join(WEB_ROOT, 'e2e', '.tmp', 'onboarding-catalog');
  rmSync(onboardingCatalogDir, { recursive: true, force: true });
  mkdirSync(onboardingCatalogDir, { recursive: true });
  const onboardingCatalogPath = join(onboardingCatalogDir, 'catalog.json');
  writeOnboardingCatalog(onboardingCatalogPath, onboardingRegionBuffer.length);

  const fixtureCore = startCore(CORE_PORT, FIXTURE_TILES_DIR);
  const emptyCore = startCore(EMPTY_CORE_PORT, EMPTY_TILES_DIR);
  // Dedicated core for gps-loss.spec.ts (E02-T5, W-01) -- see the
  // SIMULATOR_CORE_PORT comment in constants.ts for why it can't share
  // CORE_PORT with the other specs. Reuses the fixture tiles dir so the map
  // still has an installed region to render.
  const simulatorCore = startCore(SIMULATOR_CORE_PORT, FIXTURE_TILES_DIR);
  // Dedicated core for search.spec.ts (E05-T2) -- see the SEARCH_CORE_PORT
  // comment in constants.ts.
  const searchCore = startCore(SEARCH_CORE_PORT, FIXTURE_TILES_DIR);
  // Dedicated core for favorites.spec.ts (E05-T3) -- see the
  // FAVORITES_CORE_PORT comment in constants.ts.
  const favoritesCore = startCore(FAVORITES_CORE_PORT, FIXTURE_TILES_DIR);
  // Dedicated core for drive.spec.ts (E04-T3) -- see the DRIVE_CORE_PORT
  // comment in constants.ts.
  const driveCore = startCore(DRIVE_CORE_PORT, FIXTURE_TILES_DIR);
  // Dedicated core for nav-control.spec.ts (E04-T5) -- see the
  // NAV_CONTROL_CORE_PORT comment in constants.ts.
  const navControlCore = startCore(NAV_CONTROL_CORE_PORT, FIXTURE_TILES_DIR);
  // Dedicated core for profile-reroute.spec.ts (E06-T3, Flow 5) -- see the
  // PROFILE_REROUTE_CORE_PORT comment in constants.ts. `VALHALLA_URL` points
  // at the stub Valhalla HTTP server the spec itself starts/stops (per-test,
  // in `test.beforeAll`/`afterAll`) -- nothing needs to be listening on that
  // port yet for the core to boot; it's only dialled once a reroute fires.
  const profileRerouteCore = startCore(PROFILE_REROUTE_CORE_PORT, FIXTURE_TILES_DIR, {
    VALHALLA_URL: PROFILE_REROUTE_VALHALLA_BASE_URL,
  });
  // Dedicated core for shell.spec.ts (E07-T1) -- see the SHELL_CORE_PORT
  // comment in constants.ts.
  const shellCore = startCore(SHELL_CORE_PORT, FIXTURE_TILES_DIR);
  // Dedicated core for shell-edit.spec.ts (E07-T2) -- see the
  // SHELL_EDIT_CORE_PORT comment in constants.ts.
  const shellEditCore = startCore(SHELL_EDIT_CORE_PORT, FIXTURE_TILES_DIR);
  // Dedicated cores for E07-T4's three new specs -- see the
  // DRIVE_LOCK_CORE_PORT/TOUCH_TARGETS_CORE_PORT/A11Y_CORE_PORT comments in
  // constants.ts.
  const driveLockCore = startCore(DRIVE_LOCK_CORE_PORT, FIXTURE_TILES_DIR);
  const touchTargetsCore = startCore(TOUCH_TARGETS_CORE_PORT, FIXTURE_TILES_DIR);
  const a11yCore = startCore(A11Y_CORE_PORT, FIXTURE_TILES_DIR);
  // Dedicated core for pwa.spec.ts (E07-T5) -- see the PWA_CORE_PORT comment
  // in constants.ts.
  const pwaCore = startCore(PWA_CORE_PORT, FIXTURE_TILES_DIR);
  // Dedicated core for onboarding.spec.ts (E08-T5) -- see the
  // ONBOARDING_CORE_PORT comment in constants.ts. Deliberately NOT seeded
  // with `onboarding_state` below (every other core is) -- this is the one
  // core that must boot genuinely fresh so the wizard auto-shows.
  const onboardingCore = startCore(ONBOARDING_CORE_PORT, ONBOARDING_TILES_DIR, {
    MAP_REGIONS_CATALOG_FILE: onboardingCatalogPath,
  });

  const allCores = [
    fixtureCore,
    emptyCore,
    simulatorCore,
    searchCore,
    favoritesCore,
    driveCore,
    navControlCore,
    profileRerouteCore,
    shellCore,
    shellEditCore,
    driveLockCore,
    touchTargetsCore,
    a11yCore,
    pwaCore,
    onboardingCore,
  ];

  try {
    await Promise.all([
      waitForHealth(CORE_BASE_URL, 20_000),
      waitForHealth(EMPTY_CORE_BASE_URL, 20_000),
      waitForHealth(SIMULATOR_CORE_BASE_URL, 20_000),
      waitForHealth(SEARCH_CORE_BASE_URL, 20_000),
      waitForHealth(FAVORITES_CORE_BASE_URL, 20_000),
      waitForHealth(DRIVE_CORE_BASE_URL, 20_000),
      waitForHealth(NAV_CONTROL_CORE_BASE_URL, 20_000),
      waitForHealth(PROFILE_REROUTE_CORE_BASE_URL, 20_000),
      waitForHealth(SHELL_CORE_BASE_URL, 20_000),
      waitForHealth(SHELL_EDIT_CORE_BASE_URL, 20_000),
      waitForHealth(DRIVE_LOCK_CORE_BASE_URL, 20_000),
      waitForHealth(TOUCH_TARGETS_CORE_BASE_URL, 20_000),
      waitForHealth(A11Y_CORE_BASE_URL, 20_000),
      waitForHealth(PWA_CORE_BASE_URL, 20_000),
      waitForHealth(ONBOARDING_CORE_BASE_URL, 20_000),
    ]);
  } catch (err) {
    for (const core of allCores) core.kill();
    onboardingRegionServer.close();
    throw err;
  }

  // E08-T5: seed every core EXCEPT the dedicated onboarding one with an
  // already-completed `onboarding_state` (+ valid disclaimer consent) --
  // see `seedOnboardingCompleted`'s doc comment for why this is required to
  // keep the other 40+ pre-existing specs green.
  await Promise.all(
    [
      CORE_BASE_URL,
      EMPTY_CORE_BASE_URL,
      SIMULATOR_CORE_BASE_URL,
      SEARCH_CORE_BASE_URL,
      FAVORITES_CORE_BASE_URL,
      DRIVE_CORE_BASE_URL,
      NAV_CONTROL_CORE_BASE_URL,
      PROFILE_REROUTE_CORE_BASE_URL,
      SHELL_CORE_BASE_URL,
      SHELL_EDIT_CORE_BASE_URL,
      DRIVE_LOCK_CORE_BASE_URL,
      TOUCH_TARGETS_CORE_BASE_URL,
      A11Y_CORE_BASE_URL,
      PWA_CORE_BASE_URL,
    ].map((baseUrl) => seedOnboardingCompleted(baseUrl)),
  );

  return async () => {
    for (const core of allCores) core.kill();
    onboardingRegionServer.close();
  };
}
