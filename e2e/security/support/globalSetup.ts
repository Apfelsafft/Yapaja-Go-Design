/**
 * Playwright global setup for the E09-T6 security suite.
 *
 * Boots ONE dedicated, REAL, BUILT Core process -- the task's plausibility
 * requirement is explicit: "Kein Vektor wird durch Test-Mocks 'geblockt' --
 * Suite läuft gegen echten Core". Nothing here stubs, patches or injects a
 * seam into the Core; the suite talks to it exclusively over HTTP/WS and
 * through a real browser.
 *
 * All the build/stage/spawn/health plumbing is REUSED from the main harness
 * (`apps/web/e2e/support/coreProcess.ts`, extracted for exactly this purpose)
 * so there is one way of starting a Core in this repo, not two.
 *
 * The Core is started WITH `API_AUTH_TOKEN` -- see
 * `constants.ts#SECURITY_CORE_TOKEN` for why that is essential to the
 * token-replay vector.
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import type { ChildProcess } from 'child_process';
import {
  buildApps,
  preparePublicDir,
  resetDir,
  startCore,
  waitForHealth,
} from '../../../apps/web/e2e/support/coreProcess.js';
// The SAME deterministic PMTiles fixture generator every other core in this
// repo's harness uses -- so the map actually renders for the browser-side
// vectors, without inventing a second fixture format.
import { buildPMTilesFixtureBuffer } from '../../../apps/core/src/map/__fixtures__/pmtiles-fixture.js';
import { DISCLAIMER_VERSION } from '../../../apps/web/src/onboarding/state.js';
import {
  SECURITY_ADDONS_DIR,
  SECURITY_ADDON_STORAGE_DIR,
  SECURITY_CORE_BASE_URL,
  SECURITY_CORE_PORT,
  SECURITY_CORE_TOKEN,
  SECURITY_TILES_DIR,
} from './constants.js';

/** Same seeding the main harness does, so the onboarding wizard's full-screen
 *  overlay never covers the UI the browser-side vectors assert on. */
async function seedOnboardingCompleted(): Promise<void> {
  await fetch(`${SECURITY_CORE_BASE_URL}/api/v1/settings`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      authorization: `Bearer ${SECURITY_CORE_TOKEN}`,
    },
    body: JSON.stringify({
      onboarding_state: {
        step: 'mqtt',
        completed: true,
        disclaimer: { version: DISCLAIMER_VERSION, acceptedAt: new Date().toISOString() },
      },
    }),
  });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  buildApps();
  preparePublicDir();

  resetDir(SECURITY_TILES_DIR);
  writeFileSync(join(SECURITY_TILES_DIR, 'fixture.pmtiles'), buildPMTilesFixtureBuffer({}));
  resetDir(SECURITY_ADDONS_DIR);
  resetDir(SECURITY_ADDON_STORAGE_DIR);

  let core: ChildProcess | null = startCore(SECURITY_CORE_PORT, SECURITY_TILES_DIR, {
    ADDONS_DIR: SECURITY_ADDONS_DIR,
    ADDON_STORAGE_DIR: SECURITY_ADDON_STORAGE_DIR,
    // See constants.ts: without an enforced Core token, a replayed add-on
    // token would fall through to the open-posture anonymous path.
    API_AUTH_TOKEN: SECURITY_CORE_TOKEN,
    // NOT set: `ADDON_PROXY_ALLOW_PRIVATE_HOSTS`. Leaving the loopback/
    // private-literal refusal at its default ON is deliberate -- one of the
    // egress vectors is an add-on that DID declare `net.fetch:127.0.0.1:<core
    // port>` and tries to SSRF back into the Core's own API; that must be
    // refused too (`proxy.ts#isPrivateOrLoopbackHost`).
  });

  try {
    await waitForHealth(SECURITY_CORE_BASE_URL, 30_000);
  } catch (err) {
    core.kill();
    core = null;
    throw err;
  }

  await seedOnboardingCompleted();

  return async () => {
    core?.kill();
  };
}
