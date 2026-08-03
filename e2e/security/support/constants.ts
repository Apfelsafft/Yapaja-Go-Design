/**
 * Constants for the E09-T6 Sandbox-Escape- & Sicherheits-Testsuite.
 *
 * The suite runs against ONE dedicated, real Core process on its own port with
 * its own add-ons/add-on-storage/tiles directories -- same isolation rationale
 * every dedicated-port spec in `apps/web/e2e/support/constants.ts` documents,
 * except more so: this suite deliberately installs a HOSTILE add-on, disables
 * it mid-run and replays its token, so it must never share a Core with
 * anything else.
 *
 * Port 4340 continues the harness's 43xx block (the main harness currently
 * ends at 4329) without colliding with it.
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// e2e/security/support -> e2e/security
export const SECURITY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// e2e/security -> e2e -> <repo root>
export const REPO_ROOT = join(SECURITY_ROOT, '..', '..');
export const EVIL_FIXTURE_DIR = join(REPO_ROOT, 'addons-examples', 'evil-fixture');

export const SECURITY_CORE_PORT = 4340;
export const SECURITY_CORE_BASE_URL = `http://127.0.0.1:${SECURITY_CORE_PORT}`;

export const SECURITY_TMP_DIR = join(SECURITY_ROOT, '.tmp');
export const SECURITY_TILES_DIR = join(SECURITY_TMP_DIR, 'tiles');
export const SECURITY_ADDONS_DIR = join(SECURITY_TMP_DIR, 'addons');
export const SECURITY_ADDON_STORAGE_DIR = join(SECURITY_TMP_DIR, 'addon-storage');

/**
 * The Core API token this suite's Core is started with.
 *
 * DELIBERATE, and load-bearing for the `token.replay_after_disable` vector:
 * with NO Core token configured the API keeps its documented open posture
 * (`apps/core/src/auth/authGuard.ts`), so a replayed -- i.e. no longer
 * recognised -- add-on token would fall through to the anonymous-LAN-client
 * path and be ALLOWED. Enforcing a Core token here is what makes "the replayed
 * token buys nothing" a real, observable 401 rather than an assumption.
 * See `e2e/security/README.md` ("Warum dieser Core einen API-Token hat").
 */
export const SECURITY_CORE_TOKEN = 'e09t6-security-suite-core-token';

/** The evil fixture's add-on id (must match `addons-examples/evil-fixture/yapaja-addon.json`). */
export const EVIL_ADDON_ID = 'com.example.evil-fixture';

/** A second, innocent add-on the evil one tries to reach into. */
export const VICTIM_ADDON_ID = 'com.example.victim';
