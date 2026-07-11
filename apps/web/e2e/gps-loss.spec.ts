/**
 * GPS-loss E2E flow (E02-T5, W-01, docs/07-testing-qa.md §5 Flow 4).
 *
 * Drives the GPS simulator with an `outage` mutation and asserts:
 * 1. No premature "GPS-Signal verloren" banner while fixes are still fresh.
 * 2. The banner appears once no real fix has arrived for >3s.
 * 3. The banner disappears again as soon as playback resumes (a real fix
 *    returns).
 * 4. The store never received a `pos/extrapolated` fix during the outage
 *    (`noopDeadReckoningProvider` is wired in production until E04-T6 ships
 *    the real route-based math) -- "no active route" means the puck freezes
 *    rather than guessing.
 * 5. The puck's paint config uses MapLibre `*-transition`, so the
 *    gray -> blue recovery never hard-snaps ("kein Teleport-Flackern").
 *
 * Runs against its own dedicated core (SIMULATOR_CORE_BASE_URL) -- forcing
 * the simulator as active position source would otherwise race the other
 * specs sharing CORE_BASE_URL (`fullyParallel: true`); see the
 * SIMULATOR_CORE_PORT comment in support/constants.ts.
 */

import { test, expect, type Page } from '@playwright/test';
import { SIMULATOR_CORE_BASE_URL } from './support/constants.js';
import { collectPageErrors } from './support/network.js';

const BANNER_TEXT = /GPS-Signal verloren/;

async function startSimulatorOutage(page: Page): Promise<void> {
  const status = await page.evaluate(async (baseUrl: string) => {
    const response = await fetch(`${baseUrl}/api/v1/simulator/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track: { gpxId: 'city' },
        speed_factor: 1,
        // Outage starts 1 simulated second in and lasts 6s -- comfortably
        // longer than the 3s "signal lost" threshold, short enough to keep
        // the test fast.
        mutations: { outage: { at_s: 1, duration_s: 6 } },
      }),
    });
    return response.status;
  }, SIMULATOR_CORE_BASE_URL);
  expect(status).toBe(200);
}

test.describe('GPS loss (W-01)', () => {
  // Both tests drive the ONE shared simulator core (SIMULATOR_CORE_BASE_URL)
  // and its single global simulator; `fullyParallel: true` would otherwise
  // run them on separate workers at once, so one test's `simulator/stop`
  // (afterEach) races the other's playback. Serial keeps simulator control
  // to one test at a time.
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.goto(SIMULATOR_CORE_BASE_URL + '/');
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(() => Boolean(window.__yapajaMapController?.getMap?.()));
  });

  test.afterEach(async ({ page }) => {
    await page
      .evaluate(async (baseUrl: string) => {
        await fetch(`${baseUrl}/api/v1/simulator/stop`, { method: 'POST' });
      }, SIMULATOR_CORE_BASE_URL)
      .catch(() => {
        // Best-effort cleanup; a failure here must not fail the test itself.
      });
  });

  test('banner appears ~3s after signal loss, disappears on recovery, puck never extrapolates without a route', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const pageErrors = collectPageErrors(page);

    await startSimulatorOutage(page);

    // Before the 3s-without-a-real-fix threshold is reached, no banner yet.
    await page.waitForTimeout(1500);
    await expect(page.getByText(BANNER_TEXT)).toHaveCount(0);

    // Banner shows once the signal has been lost for >3s (the outage starts
    // at t=1s and lasts until t=7s, so this lands comfortably inside it).
    await expect(page.getByText(BANNER_TEXT)).toBeVisible({ timeout: 10_000 });

    // While lost, the store must reflect a REAL signal loss, not a
    // dead-reckoned guess -- with no active route (noopDeadReckoningProvider,
    // E04-T6 ships the real math), `pos/extrapolated` must never have fired.
    const extrapolatedWhileLost = await page.evaluate(
      () => window.__yapajaPositionStore?.getState().extrapolated ?? null,
    );
    expect(extrapolatedWhileLost).toBe(false);

    // Playback resumes after the outage window -> a real fix returns ->
    // banner disappears again.
    await expect(page.getByText(BANNER_TEXT)).toBeHidden({ timeout: 15_000 });

    const stateAfterRecovery = await page.evaluate(() => {
      const s = window.__yapajaPositionStore?.getState();
      return s ? { extrapolated: s.extrapolated, hasPosition: s.position !== null } : null;
    });
    expect(stateAfterRecovery).toEqual({ extrapolated: false, hasPosition: true });

    expect(pageErrors).toEqual([]);
  });

  test('puck layers configure MapLibre paint transitions (no hard color snap on recovery)', async ({ page }) => {
    // The puck source/layers are added on the map's `load` event (see
    // PositionPuck's style-readiness guard), which can land slightly after
    // the canvas is visible. Wait for the layer before querying its paint.
    await page.waitForFunction(
      () => Boolean(window.__yapajaMapController?.getMap()?.getLayer('position-puck-layer')),
      undefined,
      { timeout: 10_000 },
    );

    const transitions = await page.evaluate(() => {
      const map = window.__yapajaMapController?.getMap();
      if (!map) return null;
      return {
        puckColor: map.getPaintProperty('position-puck-layer', 'circle-color-transition'),
        ringColor: map.getPaintProperty('position-puck-layer-ring', 'circle-color-transition'),
      };
    });

    expect(transitions?.puckColor).toEqual({ duration: 600, delay: 0 });
    expect(transitions?.ringColor).toEqual({ duration: 600, delay: 0 });
  });
});
