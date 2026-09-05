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
// docs/07 §5 flow 9 names this shape explicitly ("App unter
// `/hassio_ingress/xyz/` Sub-Pfad"), so the ingress simulation uses a real
// Home-Assistant-style ingress path rather than a generic prefix.
export const SUBPATH_PREFIX = '/hassio_ingress/e2e0token0xyz';
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
// Dedicated core for drive-lock.spec.ts (E07-T4): drives exact `Position`
// fixes to `/api/v1/position/browser` to deterministically engage/release
// the Speed-Lock, and starts a real navigation session for the Stop-button
// SAFETY INVARIANT test -- same "an unrelated parallel spec's fix could land
// mid-sequence" contention rationale every other dedicated-port comment
// above already explains.
export const DRIVE_LOCK_CORE_PORT = 4322;
// Dedicated core for touch-targets.spec.ts (E07-T4): starts a real
// navigation session (so `DriveControls.tsx`/the TTS toggle are actually on
// screen to measure) -- kept separate so no other spec's navigation-stop
// races this one's bounding-box measurements.
export const TOUCH_TARGETS_CORE_PORT = 4323;
// Dedicated core for a11y.spec.ts (E07-T4): the axe-core scan needs BOTH
// modes (explore + drive) reliably reproducible, including a real active
// navigation session for the drive-mode scans -- same isolation rationale.
export const A11Y_CORE_PORT = 4324;
// Dedicated core for pwa.spec.ts (E07-T5): this spec toggles
// `page.context().setOffline(true)` (Flow 1: cold-start offline) and
// inspects `CacheStorage` after normal use -- context-scoped, so sharing a
// core with another parallel spec's origin would be network-safe, but a
// dedicated core keeps this spec's Service-Worker install/precache timing
// (and the deliberate full-network-cut window) from being noisy alongside
// other specs hammering the same origin in parallel, same rationale as every
// other dedicated-port comment above.
export const PWA_CORE_PORT = 4325;
// Dedicated core for onboarding.spec.ts (E08-T5): the ONLY core in this
// harness that must boot WITHOUT a seeded `settings.onboarding_state` --
// every other core here gets `onboarding_state.completed:true` (+ a valid
// disclaimer consent) PATCHed in during `globalSetup`, specifically so the
// wizard's full-screen overlay does NOT auto-show and cover the UI the other
// 40+ specs assert on (see globalSetup.ts's `seedOnboardingCompleted`). This
// core stays genuinely fresh so the wizard auto-shows, and gets its own
// tiles dir (starts EMPTY -- the wizard installs a region itself) + its own
// regions catalog pointing at a small local HTTP fixture server (never a
// real foreign host, same rule every other region-download test follows).
export const ONBOARDING_CORE_PORT = 4326;
export const ONBOARDING_TILES_DIR = join(WEB_ROOT, 'e2e', '.tmp', 'tiles-onboarding');
export const ONBOARDING_REGION_ID = 'wizardregion';
export const ONBOARDING_REGION_HTTP_PORT = 4327;
// Dedicated core for addon-ui.spec.ts (E09-T2, W-10): installs + enables a
// fixture UI add-on and exercises the sandboxed iframe + scope-checked bridge.
// Gets its OWN add-ons + add-on-storage directories (via env) so its installs
// never collide with the shared CORE_ROOT cwd another core might reuse, and so
// re-runs start clean. Uses the fixture tiles dir so the map renders (add-on
// map layers need a live map).
export const ADDON_UI_CORE_PORT = 4328;
export const ADDON_UI_ADDONS_DIR = join(WEB_ROOT, 'e2e', '.tmp', 'addons-ui');
export const ADDON_UI_STORAGE_DIR = join(WEB_ROOT, 'e2e', '.tmp', 'addon-storage-ui');
// Dedicated core for addon-examples-poi.spec.ts / addon-examples-recorder.spec.ts
// (E09-T5, docs/05 §6): installs the two REAL, esbuild-built reference add-on
// tarballs from `addons-examples/*` (not a hand-rolled fixture) and, for the
// recorder spec, drives a real GPS-simulator run (`POST /api/v1/simulator/play`)
// with an `outage` mutation. Own add-ons/add-on-storage dirs (cleaned in
// globalSetup, same as ADDON_UI_*) so installs never collide with another
// spec's core; own port so the simulator-forced position source and the two
// add-ons' installs never race any other parallel spec's core.
export const ADDON_EXAMPLES_CORE_PORT = 4329;
export const ADDON_EXAMPLES_ADDONS_DIR = join(WEB_ROOT, 'e2e', '.tmp', 'addons-examples');
export const ADDON_EXAMPLES_STORAGE_DIR = join(WEB_ROOT, 'e2e', '.tmp', 'addon-storage-examples');
// Dedicated core for store.spec.ts (E09-T7, docs/05 §5, W-11/W-13): its
// `ADDONS_REGISTRY_URL` points at a local registry STUB this spec starts/
// stops itself (`support/registryStub.ts`, same "spec owns the stub server,
// core is pre-pointed at its fixed port" pattern as
// `profile-reroute.spec.ts`'s Valhalla stub) -- lets the spec flip the
// registry between reachable/unreachable within a single test run to prove
// both the online AND offline (W-13) Store flows. Own add-ons/add-on-storage
// dirs (same convention as ADDON_UI_*/ADDON_EXAMPLES_*) so installs never
// collide with another spec's core.
export const STORE_CORE_PORT = 4330;
export const STORE_REGISTRY_PORT = 4331;
export const STORE_ADDONS_DIR = join(WEB_ROOT, 'e2e', '.tmp', 'addons-store');
export const STORE_STORAGE_DIR = join(WEB_ROOT, 'e2e', '.tmp', 'addon-storage-store');
// Dedicated core for search.spec.ts's SPEED-LOCK test only (E10-T1 de-flake).
//
// `SEARCH_CORE_PORT` above already isolates search.spec.ts from OTHER specs,
// but `fullyParallel: true` also parallelises the tests WITHIN a file, and
// search.spec.ts's speed-lock test POSTs `speed: 5` to
// `/api/v1/position/browser`. A position fix is not test-scoped state: the
// Core broadcasts it over `/ws/v1` to EVERY page connected to that core --
// i.e. straight into the sibling search tests running at the same moment.
// Their `SearchBar` then speed-locks, which calls `resetSearch()` (cancelling
// the pending debounced request) and swaps the whole input for the
// favourites quick-select. That is the real cause of the long-standing
// search.spec.ts flake: the sibling test would either never issue its search
// request at all, or have its results wiped right after they arrived.
//
// Controlled proof: 10x8-parallel repeats of search.spec.ts failed 5/50 with
// the speed-lock test included and 0/50 with `--grep-invert "speed-lock"`,
// everything else identical.
//
// Giving the speed-lock test its own core is the same remedy every other
// position-driving spec here already uses (DRIVE_LOCK_CORE_PORT,
// DRIVE_CORE_PORT, ...), and keeps the rest of search.spec.ts parallel.
export const SEARCH_SPEEDLOCK_CORE_PORT = 4332;

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
export const DRIVE_LOCK_CORE_BASE_URL = `http://127.0.0.1:${DRIVE_LOCK_CORE_PORT}`;
export const TOUCH_TARGETS_CORE_BASE_URL = `http://127.0.0.1:${TOUCH_TARGETS_CORE_PORT}`;
export const A11Y_CORE_BASE_URL = `http://127.0.0.1:${A11Y_CORE_PORT}`;
export const PWA_CORE_BASE_URL = `http://127.0.0.1:${PWA_CORE_PORT}`;
export const ONBOARDING_CORE_BASE_URL = `http://127.0.0.1:${ONBOARDING_CORE_PORT}`;
export const ADDON_UI_CORE_BASE_URL = `http://127.0.0.1:${ADDON_UI_CORE_PORT}`;
export const ADDON_EXAMPLES_CORE_BASE_URL = `http://127.0.0.1:${ADDON_EXAMPLES_CORE_PORT}`;
export const STORE_CORE_BASE_URL = `http://127.0.0.1:${STORE_CORE_PORT}`;
export const STORE_REGISTRY_BASE_URL = `http://127.0.0.1:${STORE_REGISTRY_PORT}`;
export const SEARCH_SPEEDLOCK_CORE_BASE_URL = `http://127.0.0.1:${SEARCH_SPEEDLOCK_CORE_PORT}`;

// ---------------------------------------------------------------------------
// E10-T1: dedicated cores for the canonical docs/07 §5 flow specs
// (`flow-NN-*.spec.ts`). Same "one core per scenario" rationale every comment
// above documents -- these specs drive positions, navigation sessions,
// add-on installs and MQTT commands, none of which is test-scoped state on a
// shared Core.
// ---------------------------------------------------------------------------

/** flow-02 (search -> route -> navigate -> arrive): runs a full navigation
 *  session driven by the REAL GPS simulator, which force-pins the position
 *  source process-wide. */
export const FLOW2_CORE_PORT = 4333;
/** flow-03 (wrong turn -> reroute): the deviation reroute is triggered
 *  SERVER-side (`NavigationService` -> `RoutingService.createRoutes`), so
 *  like `profile-reroute.spec.ts` this core needs `VALHALLA_URL` pointed at a
 *  stub HTTP server the spec itself owns. */
export const FLOW3_CORE_PORT = 4334;
export const FLOW3_VALHALLA_PORT = 4335;
/** flow-08 (MQTT `cmd/destination`): core is pointed at an in-process `aedes`
 *  broker the spec starts (the repo's established Docker-free MQTT pattern,
 *  see `apps/core/src/mqtt/bridge.integration.test.ts`), plus a Valhalla stub
 *  because `cmd/destination` computes a route server-side before autostarting. */
export const FLOW8_CORE_PORT = 4336;
export const FLOW8_MQTT_PORT = 4337;
export const FLOW8_VALHALLA_PORT = 4338;
export const FLOW8_MQTT_PREFIX = 'yapaja';
/** flow-10 (add-on install from registry -> uninstall residue-free): own
 *  registry stub + own add-ons/storage dirs, so the residue assertions can
 *  look at the real directories on disk. */
export const FLOW10_CORE_PORT = 4339;
export const FLOW10_REGISTRY_PORT = 4340;
export const FLOW10_ADDONS_DIR = join(WEB_ROOT, 'e2e', '.tmp', 'addons-flow10');
export const FLOW10_STORAGE_DIR = join(WEB_ROOT, 'e2e', '.tmp', 'addon-storage-flow10');
/** flow-11 (geolocation denied): must observe a Core that NEVER receives a
 *  browser position fix, so it cannot share a core with any spec that POSTs
 *  `/api/v1/position/browser` (position.spec.ts does, on CORE_PORT). */
// Dedicated core for vehicle-dimensions.spec.ts: der EINZIGE Core, dessen
// Fahrzeugmasse NICHT als bestaetigt geseedet werden (globalSetup tut das
// fuer alle anderen, sonst laege der Dialog ueber 40+ Specs). Nur hier laesst
// sich zeigen, dass der Sicherheitsdialog ueberhaupt erscheint -- und weil es
// bewusst kein „Bestaetigung zuruecknehmen" gibt, geht das nur mit einer
// eigenen, frischen Datenbank.
export const DIMENSIONS_CORE_PORT = 4351;

export const FLOW11_CORE_PORT = 4341;

export const FLOW2_CORE_BASE_URL = `http://127.0.0.1:${FLOW2_CORE_PORT}`;
export const FLOW3_CORE_BASE_URL = `http://127.0.0.1:${FLOW3_CORE_PORT}`;
export const FLOW3_VALHALLA_BASE_URL = `http://127.0.0.1:${FLOW3_VALHALLA_PORT}`;
export const FLOW8_CORE_BASE_URL = `http://127.0.0.1:${FLOW8_CORE_PORT}`;
export const FLOW8_VALHALLA_BASE_URL = `http://127.0.0.1:${FLOW8_VALHALLA_PORT}`;
export const FLOW8_MQTT_BROKER_URL = `mqtt://127.0.0.1:${FLOW8_MQTT_PORT}`;
export const FLOW10_CORE_BASE_URL = `http://127.0.0.1:${FLOW10_CORE_PORT}`;
export const FLOW10_REGISTRY_BASE_URL = `http://127.0.0.1:${FLOW10_REGISTRY_PORT}`;
export const FLOW11_CORE_BASE_URL = `http://127.0.0.1:${FLOW11_CORE_PORT}`;
export const DIMENSIONS_CORE_BASE_URL = `http://127.0.0.1:${DIMENSIONS_CORE_PORT}`;
