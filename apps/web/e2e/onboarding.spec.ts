/**
 * Onboarding wizard e2e (E08-T5).
 *
 * Three mandatory flows against the dedicated, genuinely-fresh
 * `ONBOARDING_CORE_BASE_URL` (see `support/constants.ts`/`support/globalSetup.ts`
 * for why this is the ONE core in the harness that must NOT get
 * `onboarding_state` seeded):
 *
 *  1. The complete wizard walks all six steps -- including a REAL region
 *     download against a local fixture HTTP server -- to a drive-ready app
 *     (acceptance #1).
 *  2. Resume: starting a region download and reloading mid-way (simulating
 *     an aborted download) resumes the wizard at the SAME step, not from the
 *     beginning (acceptance #2).
 *  3. Disclaimer gate: without a valid (current-version) consent recorded,
 *     "Navigation starten" is disabled and does not start navigation, even
 *     when `onboarding_state.completed` is otherwise true -- e.g. a
 *     disclaimer-version bump invalidating a stale consent (acceptance #3).
 *
 * Every test resets `onboarding_state` (and removes any installed region
 * file left on disk) in `beforeEach` so the three tests are independent of
 * execution order.
 */

import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Route } from '@yapaja/shared';
import { encodePolyline6, type LatLon } from '../../core/src/routing/polyline.js';
import { buildPMTilesFixtureBuffer } from '../../core/src/map/__fixtures__/pmtiles-fixture.js';
import {
  ONBOARDING_CORE_BASE_URL,
  ONBOARDING_TILES_DIR,
  ONBOARDING_REGION_ID,
} from './support/constants.js';
import { collectPageErrors } from './support/network.js';

const REGION_FILE = join(ONBOARDING_TILES_DIR, `${ONBOARDING_REGION_ID}.pmtiles`);
const REGION_PART_FILE = `${REGION_FILE}.part`;

async function resetOnboardingState(): Promise<void> {
  await fetch(`${ONBOARDING_CORE_BASE_URL}/api/v1/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      onboarding_state: { step: 'language', completed: false, disclaimer: null },
    }),
  });
}

function removeInstalledRegionFile(): void {
  if (existsSync(REGION_FILE)) rmSync(REGION_FILE);
  if (existsSync(REGION_PART_FILE)) rmSync(REGION_PART_FILE);
}

/** Installs the region DIRECTLY on disk (bypassing the wizard's download
 *  flow) -- used only by tests that need a real map/route but aren't
 *  themselves testing the download step. */
function installRegionDirectly(): void {
  mkdirSync(ONBOARDING_TILES_DIR, { recursive: true });
  writeFileSync(REGION_FILE, buildPMTilesFixtureBuffer({}));
}

const BASE_LAT = 47.1;
const BASE_LON = 9.55;

const ROUTE_POINTS: LatLon[] = [
  { lat: BASE_LAT, lon: BASE_LON },
  { lat: BASE_LAT + 0.01, lon: BASE_LON + 0.01 },
];

const MOCK_ROUTE: Route = {
  id: 'onboarding-e2e-route',
  distance_m: 1200,
  duration_s: 90,
  geometry: encodePolyline6(ROUTE_POINTS),
  legs: [{ index: 0, distance_m: 1200, duration_s: 90 }],
  maneuvers: [
    {
      index: 0,
      type: 'continue',
      instruction: 'Der Straße folgen',
      street_names: ['Teststraße'],
      distance_m: 1200,
      begin_shape_index: 0,
    },
  ],
  speed_limits: [],
  warnings: [],
};

async function mockRoutesEndpoint(page: Page): Promise<void> {
  await page.route('**/api/v1/routes', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [MOCK_ROUTE] }),
    });
  });
}

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapajaMapController?.getMap?.()), undefined, {
    timeout: 15_000,
  });
}

async function clickMapCenter(page: Page): Promise<void> {
  const box = await page.locator('canvas.maplibregl-canvas').boundingBox();
  if (!box) throw new Error('Canvas has no bounding box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function navStatus(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__yapajaNavStore?.getState().navState?.status ?? null);
}

test.describe('Onboarding wizard (E08-T5)', () => {
  // One shared Core -- keep tests from racing on the same server-side
  // `onboarding_state` / installed-region file.
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async () => {
    await resetOnboardingState();
    removeInstalledRegionFile();
  });

  test.afterAll(() => {
    removeInstalledRegionFile();
  });

  test('fresh instance auto-shows the wizard and walks all steps to a drive-ready, nav-capable app', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const pageErrors = collectPageErrors(page);
    await mockRoutesEndpoint(page);

    await page.goto(ONBOARDING_CORE_BASE_URL + '/');

    // The wizard auto-shows on a fresh instance (no `onboarding_state.completed`).
    await expect(page.getByTestId('onboarding-wizard')).toBeVisible({ timeout: 10_000 });

    // Step 1: language/units -- accept defaults.
    await expect(page.getByTestId('onboarding-step-language')).toBeVisible();
    await page.getByTestId('onboarding-language-en').click();
    await page.getByTestId('onboarding-next-button').click();

    // Step 2: the mandatory, versioned disclaimer -- "Weiter" is disabled
    // until consent is explicitly given.
    await expect(page.getByTestId('onboarding-step-disclaimer')).toBeVisible();
    await expect(page.getByTestId('onboarding-next-button')).toBeDisabled();
    await page.getByTestId('onboarding-disclaimer-checkbox').check();
    await page.getByTestId('onboarding-disclaimer-accept-button').click();
    await expect(page.getByTestId('onboarding-disclaimer-accepted-status')).toBeVisible();
    await expect(page.getByTestId('onboarding-next-button')).toBeEnabled();
    await page.getByTestId('onboarding-next-button').click();

    // Step 3 (first skippable step): region select + a REAL download against
    // the local fixture HTTP server, with the RAM/disk-check display (W-12/W-18).
    await expect(page.getByTestId('onboarding-step-region')).toBeVisible();
    await expect(page.getByTestId('onboarding-resources-display')).toBeVisible();
    await expect(page.getByTestId('onboarding-disk-free')).not.toBeEmpty();
    await page.getByTestId(`onboarding-download-button-${ONBOARDING_REGION_ID}`).click();
    // The fixture region is tiny and served from localhost, so the download
    // job frequently finishes (and the catalog entry moves from
    // "downloadable" to "installed", unmounting its progress element)
    // between two 400ms polling ticks -- wait directly for the installed
    // marker rather than racing an intermediate progress-bar text.
    await expect(page.getByTestId(`onboarding-installed-region-${ONBOARDING_REGION_ID}`)).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId('onboarding-next-button').click();

    // Step 4: vehicle profile -- embeds the REAL E06 ProfileEditor, editing
    // the default "Camper" profile the Core seeds on first boot (height_m
    // 3.0 > 2.7 -- the height disclaimer dialog (W-08) fires, same real
    // ProfileEditor behavior as everywhere else it's embedded).
    await expect(page.getByTestId('onboarding-step-profile')).toBeVisible();
    await page.getByTestId('profile-name-input').fill('Wizard Camper');
    await page.getByTestId('save-button').click();
    await expect(page.getByTestId('height-disclaimer-dialog')).toBeVisible();
    await page.getByTestId('disclaimer-confirm-button').click();
    await expect(page.getByTestId('height-disclaimer-dialog')).toHaveCount(0);
    await page.getByTestId('onboarding-next-button').click();

    // Step 5: GPS source select + test, live status.
    await expect(page.getByTestId('onboarding-step-gps')).toBeVisible();
    await expect(page.getByTestId('onboarding-gps-signal-status')).toHaveAttribute(
      'data-signal-state',
      'acquiring',
    );
    await page.getByTestId('onboarding-gps-select-simulator').click();
    await expect(page.getByTestId('onboarding-gps-signal-status')).toHaveAttribute(
      'data-signal-state',
      'live',
      { timeout: 15_000 },
    );
    await page.getByTestId('onboarding-next-button').click();

    // Step 6: MQTT (optional, standalone form since this core is not ingress) -- finish.
    await expect(page.getByTestId('onboarding-step-mqtt')).toBeVisible();
    await expect(page.getByTestId('onboarding-mqtt-broker-url')).toBeVisible();
    await page.getByTestId('onboarding-finish-button').click();

    // The wizard closes -- the app underneath is drive-ready.
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0);
    await waitForMapReady(page);

    // Acceptance #1, closing the loop: navigation is genuinely startable now
    // (disclaimer consent was recorded, region installed, profile active).
    await clickMapCenter(page);
    await expect(page.getByTestId('route-here-button')).toBeEnabled({ timeout: 10_000 });
    await page.getByTestId('route-here-button').click();
    await expect(page.getByTestId('route-summary-panel')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('start-navigation-button')).toBeEnabled();
    await expect(page.getByTestId('start-navigation-disclaimer-gate')).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test('aborting mid region-download: reloading resumes the wizard at the SAME step', async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto(ONBOARDING_CORE_BASE_URL + '/');
    await expect(page.getByTestId('onboarding-wizard')).toBeVisible({ timeout: 10_000 });

    // Walk to the region step.
    await page.getByTestId('onboarding-next-button').click(); // language -> disclaimer
    await expect(page.getByTestId('onboarding-step-disclaimer')).toBeVisible();
    await page.getByTestId('onboarding-disclaimer-checkbox').check();
    await page.getByTestId('onboarding-disclaimer-accept-button').click();
    await page.getByTestId('onboarding-next-button').click(); // disclaimer -> region
    await expect(page.getByTestId('onboarding-step-region')).toBeVisible();

    // Start (but do not wait out) a region download -- simulates an abort
    // mid-download (W-17/E08-T5 acceptance #2): the browser goes away before
    // the job finishes or the step advances. (The fixture region is tiny and
    // served from localhost, so the job itself may well complete before the
    // reload below even fires -- irrelevant here: the WIZARD STEP, not the
    // job, is what must survive. `apps/core/src/map/regions/routes.test.ts`/
    // `disk-check.routes.test.ts` already cover job-level abort/resume.)
    await page.getByTestId(`onboarding-download-button-${ONBOARDING_REGION_ID}`).click();

    // Reload -- the wizard must resume at the region step, NOT restart from
    // language (server-side `settings.onboarding_state`, not a client-only
    // in-memory step).
    await page.reload();
    await expect(page.getByTestId('onboarding-wizard')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('onboarding-step-region')).toBeVisible();
    await expect(page.getByTestId('onboarding-step-language')).toHaveCount(0);
    await expect(page.getByTestId('onboarding-step-disclaimer')).toHaveCount(0);

    // The wizard remains fully usable after the resume -- skipping forward
    // from here (region is the first skippable step) reaches the end
    // without hitting any gate, proving the resumed state is a genuinely
    // functional continuation, not a dead end.
    await page.getByTestId('onboarding-skip-button').click();
    await page.getByTestId('onboarding-skip-button').click();
    await page.getByTestId('onboarding-skip-button').click();
    await expect(page.getByTestId('onboarding-step-mqtt')).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test('disclaimer gate: without a valid consent, "Navigation starten" is disabled and does not start navigation', async ({
    page,
  }) => {
    const pageErrors = collectPageErrors(page);
    await mockRoutesEndpoint(page);

    // A realistic negative case: onboarding is marked `completed`, but there
    // is NO recorded disclaimer consent (e.g. a disclaimer-text version bump
    // invalidated a stale one while `completed` stayed true). The gate must
    // be independent of the wizard's own `completed` flag -- see
    // `onboarding/store.ts#selectNavigationAllowed`/`state.ts#hasValidConsent`.
    await fetch(`${ONBOARDING_CORE_BASE_URL}/api/v1/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        onboarding_state: { step: 'mqtt', completed: true, disclaimer: null },
      }),
    });
    installRegionDirectly();

    await page.goto(ONBOARDING_CORE_BASE_URL + '/');

    // Onboarding is "completed" -> the wizard does NOT auto-show, the app
    // underneath is reachable.
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0);
    await waitForMapReady(page);

    await clickMapCenter(page);
    await expect(page.getByTestId('route-here-button')).toBeEnabled({ timeout: 10_000 });
    await page.getByTestId('route-here-button').click();
    await expect(page.getByTestId('route-summary-panel')).toBeVisible({ timeout: 10_000 });

    // The gate: disabled, with an explicit reason shown, and clicking it
    // (even forced) never starts navigation.
    const startButton = page.getByTestId('start-navigation-button');
    await expect(startButton).toBeDisabled();
    await expect(startButton).toHaveAttribute('data-disclaimer-gated', 'true');
    await expect(page.getByTestId('start-navigation-disclaimer-gate')).toBeVisible();

    await startButton.click({ force: true });
    await page.waitForTimeout(500);
    expect(await navStatus(page)).not.toBe('navigating');

    expect(pageErrors).toEqual([]);
  });
});
