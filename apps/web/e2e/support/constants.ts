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
// Dedicated core for drive.spec.ts (E04-T3, Flow 2): the test POSTs a
// synthetic `Route` straight to `/api/v1/navigation/start` and then drives a
// sequence of exact `Position` fixes to `/api/v1/position/browser` to
// deterministically step through maneuvers/thresholds/speed-limit segments --
// same rationale as SEARCH_CORE_PORT (an unrelated parallel spec's browser
// fix landing in between would flip an assertion flaky), plus this test
// leaves navigation genuinely ACTIVE for a while, which no other spec's core
// should ever observe.
export const DRIVE_CORE_PORT = 4316;
// Dedicated core for nav-control.spec.ts (E04-T5, Flow 2 full + W-19 reload
// recovery): the W-19 test needs navigation to stay genuinely ACTIVE on the
// Core process across a `page.reload()` -- sharing a core with any other
// parallel spec (including drive.spec.ts's own dedicated one, which leaves
// navigation active for stretches too) would risk another test's `stop()` or
// position fix landing in the middle of this one's reload assertion, same
// class of cross-test contention `DRIVE_CORE_PORT` already exists to avoid.
export const NAV_CONTROL_CORE_PORT = 4317;
// Dedicated core for profile-reroute.spec.ts (E06-T3, Flow 5): the ONLY spec
// that needs a real (stubbed) Valhalla behind `RoutingService.createRoutes`
// -- every other spec's routing is mocked at the BROWSER's `POST
// /api/v1/routes` fetch (see nav-control.spec.ts's file-level comment), which
// only covers UI-initiated routing. The profile-change reroute is triggered
// SERVER-SIDE (`NavigationService` calls `RoutingService.createRoutes`
// in-process, never through the browser), so it needs `VALHALLA_URL` pointed
// at a real (stub) HTTP server -- this core is the only one configured that
// way, kept separate so no other spec's routing is affected.
export const PROFILE_REROUTE_CORE_PORT = 4318;
/** The stub Valhalla HTTP server profile-reroute.spec.ts starts itself (in `test.beforeAll`). */
export const PROFILE_REROUTE_VALHALLA_PORT = 4319;
// Dedicated core for shell.spec.ts (E07-T1): drives synthetic `nav/state`/
// `pos/update` fixes (same "POST browser fixes + navigation/start directly"
// approach as drive.spec.ts/nav-control.spec.ts) to prove widgets update
// live, PLUS asserts the exact WS-connection COUNT while doing so -- an
// unrelated parallel spec's fix landing mid-sequence, or extra `/ws/v1`
// connections opened by another spec sharing the port, would both flip
// these assertions flaky, same rationale as every other dedicated-port spec
// above.
export const SHELL_CORE_PORT = 4320;
// Dedicated core for shell-edit.spec.ts (E07-T2): drives its own
// move-widget/save/reload/cancel/reset flows against `pos/update` +
// `/api/v1/settings` -- sharing `SHELL_CORE_PORT` with shell.spec.ts would
// let one spec's `pos/update` fixture (needed for the standstill gate) or
// layout save land mid-sequence of the other's assertions, exactly the
// class of cross-test contention every other dedicated-port comment above
// already explains.
export const SHELL_EDIT_CORE_PORT = 4321;

export const CORE_BASE_URL = `http://127.0.0.1:${CORE_PORT}`;
export const EMPTY_CORE_BASE_URL = `http://127.0.0.1:${EMPTY_CORE_PORT}`;
export const SUBPATH_BASE_URL = `http://127.0.0.1:${SUBPATH_PORT}`;
export const SIMULATOR_CORE_BASE_URL = `http://127.0.0.1:${SIMULATOR_CORE_PORT}`;
export const SEARCH_CORE_BASE_URL = `http://127.0.0.1:${SEARCH_CORE_PORT}`;
export const FAVORITES_CORE_BASE_URL = `http://127.0.0.1:${FAVORITES_CORE_PORT}`;
export const DRIVE_CORE_BASE_URL = `http://127.0.0.1:${DRIVE_CORE_PORT}`;
export const NAV_CONTROL_CORE_BASE_URL = `http://127.0.0.1:${NAV_CONTROL_CORE_PORT}`;
export const PROFILE_REROUTE_CORE_BASE_URL = `http://127.0.0.1:${PROFILE_REROUTE_CORE_PORT}`;
export const PROFILE_REROUTE_VALHALLA_BASE_URL = `http://127.0.0.1:${PROFILE_REROUTE_VALHALLA_PORT}`;
export const SHELL_CORE_BASE_URL = `http://127.0.0.1:${SHELL_CORE_PORT}`;
export const SHELL_EDIT_CORE_BASE_URL = `http://127.0.0.1:${SHELL_EDIT_CORE_PORT}`;
