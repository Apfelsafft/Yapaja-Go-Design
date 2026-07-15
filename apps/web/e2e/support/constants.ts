/**
 * Shared constants for the Playwright harness (ports, paths, fixture region
 * name). Kept as plain data so both `playwright.config.ts` and the spec
 * files can import it without duplicating magic numbers.
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// apps/web/e2e/support -> apps/web
export const WEB_ROOT = join(__dirname, '..', '..');
// apps/web -> apps -> <repo root>
export const REPO_ROOT = join(WEB_ROOT, '..', '..');
export const CORE_ROOT = join(REPO_ROOT, 'apps', 'core');
export const CORE_DIST_INDEX = join(CORE_ROOT, 'dist', 'index.js');
export const CORE_PUBLIC_DIR = join(CORE_ROOT, 'public');
export const WEB_DIST_DIR = join(WEB_ROOT, 'dist');

export const FIXTURE_REGION = 'fixture';
export const FIXTURE_TILES_DIR = join(WEB_ROOT, 'e2e', '.tmp', 'tiles-fixture');
export const EMPTY_TILES_DIR = join(WEB_ROOT, 'e2e', '.tmp', 'tiles-empty');

// Fixed, uncommon ports so parallel local dev servers (vite :5173, core :8080)
// never collide with the e2e harness.
export const CORE_PORT = 4310;
export const EMPTY_CORE_PORT = 4311;
export const SUBPATH_PORT = 4312;
export const SUBPATH_PREFIX = '/rv-demo';
// Dedicated core for gps-loss.spec.ts (E02-T5): the GPS-simulator control
// plane (`POST /api/v1/simulator/play`) force-pins the active position
// source for the whole core process it targets. Sharing CORE_PORT with the
// other specs (which run in parallel, `fullyParallel: true`, and assert on
// the browser/gpsd sources being active) would make those tests flaky, so
// this gets its own core + port instead.
export const SIMULATOR_CORE_PORT = 4313;
// Dedicated core for search.spec.ts (E05-T2): its speed-lock test POSTs real
// `Position` fixes (with an exact `speed`) to `/api/v1/position/browser` to
// deterministically drive the search field's speed-lock threshold. Sharing
// CORE_PORT with the other specs (which run in parallel, `fullyParallel:
// true`, and some of which -- position.spec.ts -- also POST browser fixes
// of their own to the same core) would let an unrelated test's fix land in
// between this test's `speed: 5` and `speed: 0` pushes and flip the
// lock/unlock assertion flaky, same class of problem `SIMULATOR_CORE_PORT`
// exists to avoid for gps-loss.spec.ts.
export const SEARCH_CORE_PORT = 4314;
// Dedicated core for favorites.spec.ts (E05-T3, Flow 6): the test creates a
// favorite, then RELOADS THE PAGE to prove persistence -- a fresh navigation
// against a core shared with other parallel specs would risk picking up
// favorites/history left behind by an unrelated test (or vice versa),
// exactly the class of cross-test contention `SEARCH_CORE_PORT` /
// `SIMULATOR_CORE_PORT` already exist to avoid.
export const FAVORITES_CORE_PORT = 4315;

export const CORE_BASE_URL = `http://127.0.0.1:${CORE_PORT}`;
export const EMPTY_CORE_BASE_URL = `http://127.0.0.1:${EMPTY_CORE_PORT}`;
export const SUBPATH_BASE_URL = `http://127.0.0.1:${SUBPATH_PORT}`;
export const SIMULATOR_CORE_BASE_URL = `http://127.0.0.1:${SIMULATOR_CORE_PORT}`;
export const SEARCH_CORE_BASE_URL = `http://127.0.0.1:${SEARCH_CORE_PORT}`;
export const FAVORITES_CORE_BASE_URL = `http://127.0.0.1:${FAVORITES_CORE_PORT}`;
