/**
 * Speed-Lock e2e (E07-T4, docs/06 §4): above a configurable speed (default
 * 10 km/h) the config/editor surfaces (Settings, Store, Profile editor, the
 * layout Editor) are gated behind an overlay ("Während der Fahrt gesperrt")
 * with an "Ich bin Beifahrer" 5-second-countdown override, remembered for
 * the session. Also the SAFETY INVARIANT: the Stop-Navigation button is
 * NEVER locked, at any speed.
 *
 * Same "drive the Core directly with synthetic Position fixes" approach
 * `drive.spec.ts`/`nav-control.spec.ts` already establish, against a
 * dedicated core (`DRIVE_LOCK_CORE_BASE_URL`, see constants.ts) so no
 * unrelated parallel spec's fix/navigation lands mid-sequence.
 */

import { test, expect, type Page } from '@playwright/test';
import type { Route } from '@yapaja/shared';
import { encodePolyline6, type LatLon } from '../../core/src/routing/polyline.js';
import { DRIVE_LOCK_CORE_BASE_URL, FIXTURE_REGION } from './support/constants.js';
import { collectPageErrors } from './support/network.js';

const BASE_LAT = 47.05;
const BASE_LON = 9.55;
const M_PER_DEG_LAT = 111_195;

function latForProgressM(progressM: number): number {
  return BASE_LAT + progressM / M_PER_DEG_LAT;
}

const ROUTE_POINTS: LatLon[] = Array.from({ length: 11 }, (_, i) => ({
  lat: latForProgressM(i * (M_PER_DEG_LAT * 0.001)),
  lon: BASE_LON,
}));
const TOTAL_LENGTH_M = 10 * (M_PER_DEG_LAT * 0.001);

const ROUTE: Route = {
  id: 'drive-lock-e2e-route',
  distance_m: TOTAL_LENGTH_M,
  duration_s: 120,
  geometry: encodePolyline6(ROUTE_POINTS),
  legs: [{ index: 0, distance_m: TOTAL_LENGTH_M, duration_s: 120 }],
  maneuvers: [
    {
      index: 0,
      type: 'continue',
      instruction: 'Der Straße folgen',
      street_names: ['Teststraße'],
      distance_m: TOTAL_LENGTH_M,
      begin_shape_index: 0,
    },
  ],
  speed_limits: [],
  warnings: [],
};

function browserFixBody(speedMs: number, progressM = 0): Record<string, unknown> {
  return {
    lat: latForProgressM(progressM),
    lon: BASE_LON,
    alt: null,
    speed: speedMs,
    heading: 0,
    accuracy: 5,
    fix: '3d',
    ts: new Date().toISOString(),
  };
}

/** Posts one exact fix and waits out the Core's 1 Hz publish throttle (same
 *  pattern as drive.spec.ts/nav-control.spec.ts's `driveTo`). */
async function postSpeed(page: Page, speedMs: number, progressM = 0): Promise<void> {
  const response = await page.request.post(`${DRIVE_LOCK_CORE_BASE_URL}/api/v1/position/browser`, {
    data: browserFixBody(speedMs, progressM),
  });
  expect(response.ok()).toBe(true);
  await page.waitForTimeout(1100);
}

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapajaMapController?.getMap?.()), undefined, {
    timeout: 15_000,
  });
}

async function startNavigation(page: Page): Promise<void> {
  const response = await page.request.post(`${DRIVE_LOCK_CORE_BASE_URL}/api/v1/navigation/start`, {
    data: { route: ROUTE, destination: { latlng: ROUTE_POINTS[10], name: 'Drive-Lock Ziel' } },
  });
  expect(response.ok()).toBe(true);
}

async function navStatus(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__yapajaNavStore?.getState().navState?.status ?? null);
}

test.describe('Speed-Lock (E07-T4)', () => {
  test.describe.configure({ mode: 'serial' }); // shared core, one position/nav sequence at a time

  test.afterEach(async ({ page }) => {
    await page
      .evaluate(async (baseUrl: string) => {
        await fetch(`${baseUrl}/api/v1/navigation/stop`, { method: 'POST' });
      }, DRIVE_LOCK_CORE_BASE_URL)
      .catch(() => {
        // Best-effort cleanup.
      });
  });

  test('Settings: lock engages above 10 km/h and releases once slow again', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await page.goto(DRIVE_LOCK_CORE_BASE_URL + '/');
    await waitForMapReady(page);

    await page.getByTestId('style-panel-toggle').click();
    await expect(page.getByTestId('style-panel')).toBeVisible();
    await expect(page.getByTestId('theme-toggle')).toBeVisible(); // normal content while unlocked
    await expect(page.getByTestId('drive-lock-overlay')).toHaveCount(0);

    // 18 km/h (5 m/s) -- above the default 10 km/h threshold.
    await postSpeed(page, 5);
    await expect(page.getByTestId('drive-lock-overlay')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('drive-lock-overlay')).toContainText('Während der Fahrt gesperrt');
    await expect(page.getByTestId('theme-toggle')).toHaveCount(0); // settings content replaced, not just covered
    await expect(page.getByTestId('drive-lock-passenger-button')).toBeVisible();

    // Slow back down -> unlocked again, normal settings content is back.
    await postSpeed(page, 0);
    await expect(page.getByTestId('drive-lock-overlay')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByTestId('theme-toggle')).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test('Store (region manager) and Profile editor are also gated above the threshold', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await page.goto(DRIVE_LOCK_CORE_BASE_URL + '/');
    await waitForMapReady(page);

    await postSpeed(page, 5); // 18 km/h, locked

    // Store (RegionsPanel) -- the fixture region is installed (see
    // globalSetup.ts), so its normal content includes `installed-region-
    // fixture`; while locked, that's replaced by the overlay instead.
    await page.getByTestId('regions-panel-toggle').click();
    await expect(page.getByTestId('regions-panel')).toBeVisible();
    await expect(page.getByTestId('drive-lock-overlay')).toBeVisible();
    await expect(page.getByTestId(`installed-region-${FIXTURE_REGION}`)).toHaveCount(0);

    // Profile editor: open the profiles panel, create-new -> editor form is gated.
    await page.getByTestId('profile-chip').click();
    await expect(page.getByTestId('profiles-panel')).toBeVisible();
    // The LIST view itself is not gated (only the editor form) -- create button reachable.
    await page.getByTestId('create-profile-button').click();
    await expect(page.getByTestId('drive-lock-overlay')).toHaveCount(2); // Store panel (still open) + Profile editor
    await expect(page.getByTestId('profile-name-input')).toHaveCount(0);

    await postSpeed(page, 0);
    await expect(page.getByTestId('profile-name-input')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId(`installed-region-${FIXTURE_REGION}`)).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test('"Ich bin Beifahrer": 5-second countdown unlocks, remembered for the session across reopening the surface', async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const pageErrors = collectPageErrors(page);
    await page.goto(DRIVE_LOCK_CORE_BASE_URL + '/');
    await waitForMapReady(page);

    await postSpeed(page, 5); // locked
    await page.getByTestId('style-panel-toggle').click();
    await expect(page.getByTestId('drive-lock-overlay')).toBeVisible();

    await page.getByTestId('drive-lock-passenger-button').click();
    await expect(page.getByTestId('drive-lock-countdown')).toBeVisible();
    await expect(page.getByTestId('drive-lock-passenger-button')).toHaveCount(0); // swapped for the countdown

    // Not yet unlocked mid-countdown (speed is still high).
    await page.waitForTimeout(2_000);
    await expect(page.getByTestId('drive-lock-overlay')).toBeVisible();

    // Past 5s -> unlocked, even though speed is STILL above the threshold.
    await expect(page.getByTestId('drive-lock-overlay')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByTestId('theme-toggle')).toBeVisible();

    // The override is persisted to `sessionStorage` (the actual "remembered
    // for the session" mechanism, `driveLockStore.ts`), not just held in
    // in-memory component state.
    expect(
      await page.evaluate(() => window.sessionStorage.getItem('yapaja:driveLock:passengerOverride')),
    ).toBe('true');

    // Close the panel and reopen it -- still unlocked (session-remembered),
    // no need to run the countdown again.
    await page.getByTestId('style-panel-toggle').click(); // close
    await expect(page.getByTestId('style-panel')).toHaveCount(0);
    await page.getByTestId('style-panel-toggle').click(); // reopen
    await expect(page.getByTestId('style-panel')).toBeVisible();
    await expect(page.getByTestId('drive-lock-overlay')).toHaveCount(0);
    await expect(page.getByTestId('theme-toggle')).toBeVisible();

    // A DIFFERENT gated surface is unlocked too (the override is global, not per-surface).
    await page.getByTestId('regions-panel-toggle').click();
    await expect(page.getByTestId('regions-panel')).toBeVisible();
    await expect(page.getByTestId('drive-lock-overlay')).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test('SAFETY INVARIANT: the Stop-Navigation button is never locked -- visible, clickable, and actually stops navigation at high speed while other surfaces are locked', async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const pageErrors = collectPageErrors(page);
    await page.goto(DRIVE_LOCK_CORE_BASE_URL + '/');
    await waitForMapReady(page);

    await startNavigation(page);
    await postSpeed(page, 30, 100); // 108 km/h -- well above the 10 km/h threshold
    await expect.poll(() => navStatus(page), { timeout: 5_000 }).toBe('navigating');

    // Prove the lock is genuinely active elsewhere at this same speed.
    await page.getByTestId('style-panel-toggle').click();
    await expect(page.getByTestId('drive-lock-overlay')).toBeVisible();

    // The Stop button is STILL visible, enabled, and NOT covered by any
    // overlay -- `DriveControls.tsx` never even consults the Speed-Lock
    // (see `drive/driveLock.ts#isControlLocked`'s unconditional
    // `'drive-stop'` early return).
    const stopButton = page.getByTestId('drive-stop-button');
    await expect(stopButton).toBeVisible();
    await expect(stopButton).toBeEnabled();
    await expect(stopButton).not.toBeDisabled();

    await stopButton.click();
    await expect.poll(() => navStatus(page), { timeout: 5_000 }).toBe('idle');
    await expect(page.getByTestId('drive-controls')).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test('configurable threshold: a non-default threshold persisted via the settings service changes the lock point', async ({
    page,
  }) => {
    const pageErrors = collectPageErrors(page);

    // Persist a 20 km/h threshold BEFORE the app loads (PATCH /settings,
    // driveLock key) -- mirrors how theme.spec.ts's own settings-key tests
    // seed state ahead of `goto`.
    const patchResponse = await page.request.patch(`${DRIVE_LOCK_CORE_BASE_URL}/api/v1/settings`, {
      data: { driveLock: { thresholdKmh: 20 } },
    });
    expect(patchResponse.ok()).toBe(true);

    await page.goto(DRIVE_LOCK_CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await expect
      .poll(() => page.evaluate(() => window.__yapajaDriveLockStore?.getState().thresholdKmh ?? null), {
        timeout: 5_000,
      })
      .toBe(20);

    await page.getByTestId('style-panel-toggle').click();

    // 15 km/h -- above the OLD default (10) but below the NEW threshold (20): unlocked.
    await postSpeed(page, 15 / 3.6);
    await expect(page.getByTestId('drive-lock-overlay')).toHaveCount(0, { timeout: 5_000 });

    // 25 km/h -- above the new threshold: locked.
    await postSpeed(page, 25 / 3.6);
    await expect(page.getByTestId('drive-lock-overlay')).toBeVisible({ timeout: 5_000 });

    expect(pageErrors).toEqual([]);
  });
});
