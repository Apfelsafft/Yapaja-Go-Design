/**
 * E04-T5 (capstone): end-to-end navigation control + destination convenience.
 *
 * Flow 2 (full, docs/07 §5): destination -> "Route hierhin" -> "Navigation
 * starten" -> Drive mode (3d-course camera + follow-me, maneuver panel) ->
 * pause -> resume -> stop -> back to Explore mode with the route still
 * visible and `nav/state` idle.
 *
 * W-19 reload-recovery: reloading mid-navigation (Core process stays alive,
 * only the tab/page reloads) shows a one-click "Navigation fortsetzen?"
 * prompt; confirming it resumes into `navigating` in well under 3 s. (The
 * OTHER W-19 case -- the Core process itself restarting, `idle` +
 * `recovered_route` -- is covered by `apps/core/src/navigation/service.test.ts`
 * / `routes.test.ts` + `apps/web/src/drive/resume.test.ts` instead of here:
 * restarting the shared dedicated Core process mid-test isn't practical in
 * this harness without disrupting the "one process per spec file" pattern
 * every other e2e spec relies on.)
 *
 * Flow 5 (prepared, per spec -- full profile-change-triggers-reroute is out
 * of E04-T5's scope): a minimal smoke check that changing the active profile
 * while navigating doesn't crash the app or corrupt `nav/state`.
 *
 * No real Valhalla/geocoder in this harness (same constraint routing.spec.ts
 * / drive.spec.ts document) -- `POST /api/v1/routes` is mocked with a fixed
 * multi-maneuver `Route` fixture; navigation control itself (start/pause/
 * resume/stop/destination) hits the REAL Core.
 */

import { test, expect, type Page } from '@playwright/test';
import type { Route } from '@yapaja/shared';
import { encodePolyline6, type LatLon } from '../../core/src/routing/polyline.js';
import { NAV_CONTROL_CORE_BASE_URL } from './support/constants.js';
import { collectPageErrors, trackRequests } from './support/network.js';

const BASE_LAT = 47.3;
const BASE_LON = 9.9;
const M_PER_DEG_LAT = 111_195;

function latForProgressM(progressM: number): number {
  return BASE_LAT + progressM / M_PER_DEG_LAT;
}

// 11 vertices, ~111.2 m apart -> ~1112 m total, straight due north, 2 maneuvers.
const ROUTE_POINTS: LatLon[] = Array.from({ length: 11 }, (_, i) => ({
  lat: latForProgressM(i * (M_PER_DEG_LAT * 0.001)),
  lon: BASE_LON,
}));
const TOTAL_LENGTH_M = 10 * (M_PER_DEG_LAT * 0.001);

const ROUTE: Route = {
  id: 'nav-control-e2e-route',
  distance_m: TOTAL_LENGTH_M,
  duration_s: 120,
  geometry: encodePolyline6(ROUTE_POINTS),
  legs: [{ index: 0, distance_m: TOTAL_LENGTH_M, duration_s: 120 }],
  maneuvers: [
    {
      index: 0,
      type: 'continue',
      instruction: 'Der Hauptstraße folgen',
      street_names: ['Hauptstraße'],
      distance_m: 8 * (M_PER_DEG_LAT * 0.001),
      begin_shape_index: 0,
    },
    {
      index: 1,
      type: 'turn_left',
      instruction: 'Links abbiegen auf die Zielstraße',
      street_names: ['Zielstraße'],
      distance_m: 2 * (M_PER_DEG_LAT * 0.001),
      begin_shape_index: 8,
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
      body: JSON.stringify({ data: [ROUTE] }),
    });
  });
}

async function createAndActivateProfile(page: Page, name = 'E2E Nav-Control Test-Fahrzeug'): Promise<string> {
  const createResponse = await page.request.post(`${NAV_CONTROL_CORE_BASE_URL}/api/v1/profiles`, {
    data: {
      name,
      height_m: 2.5,
      width_m: 2.1,
      length_m: 6.5,
      weight_t: 3.5,
      avg_speed_kmh: 80,
      hazmat: false,
      avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
    },
  });
  expect(createResponse.ok()).toBe(true);
  const created = (await createResponse.json()) as { data: { id: string } };
  const activateResponse = await page.request.put(
    `${NAV_CONTROL_CORE_BASE_URL}/api/v1/profiles/${created.data.id}/activate`,
  );
  expect(activateResponse.ok()).toBe(true);
  return created.data.id;
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

function browserFixBody(progressM: number, speedMs: number): Record<string, unknown> {
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

/** Posts one exact fix and waits out the Core's 1 Hz publish throttle. */
async function driveTo(page: Page, progressM: number, speedMs = 3): Promise<void> {
  const response = await page.request.post(`${NAV_CONTROL_CORE_BASE_URL}/api/v1/position/browser`, {
    data: browserFixBody(progressM, speedMs),
  });
  expect(response.ok()).toBe(true);
  await page.waitForTimeout(1100);
}

async function readPitch(page: Page): Promise<number | null> {
  return page.evaluate(() => window.__yapajaMapController?.getMap()?.getPitch?.() ?? null);
}

async function readCenter(page: Page): Promise<{ lat: number; lon: number } | null> {
  return page.evaluate(() => {
    const center = window.__yapajaMapController?.getMap()?.getCenter?.();
    return center ? { lat: center.lat, lon: center.lng } : null;
  });
}

async function navStatus(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__yapajaNavStore?.getState().navState?.status ?? null);
}

test.describe('Navigation control end-to-end (E04-T5, Flow 2 + W-19)', () => {
  test.describe.configure({ mode: 'serial' }); // one shared Core, one navigation session at a time
  // Opt back IN to the PWA Service Worker that `playwright.config.ts` blocks
  // by default (E07-T5): the W-19 test below is the mandatory "reload-recovery
  // still works with the SW active" proof -- the resume prompt must appear and
  // resume even though the reloaded app shell is now served from the SW's
  // precache. (These tests already ran green with the SW; they aren't among
  // the tight-budget specs the default block exists to protect.)
  test.use({ serviceWorkers: 'allow' });

  test.afterEach(async ({ page }) => {
    await page
      .evaluate(async (baseUrl: string) => {
        await fetch(`${baseUrl}/api/v1/navigation/stop`, { method: 'POST' });
      }, NAV_CONTROL_CORE_BASE_URL)
      .catch(() => {
        // Best-effort cleanup.
      });
  });

  test('Flow 2 (full): destination -> Navigation starten -> drive mode -> pause/resume -> stop -> Explore mode with route still visible', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const tracker = await trackRequests(page, NAV_CONTROL_CORE_BASE_URL);
    const pageErrors = collectPageErrors(page);
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await mockRoutesEndpoint(page);
    await createAndActivateProfile(page);

    await page.goto(NAV_CONTROL_CORE_BASE_URL + '/');
    await waitForMapReady(page);

    // Starts in 2d-north (pitch 0) -- the "prior view mode" Stop must restore.
    await expect.poll(() => readPitch(page)).toBeLessThan(1);

    // 1. Destination -> "Route hierhin".
    await clickMapCenter(page);
    await expect(page.getByTestId('destination-sheet')).toBeVisible();
    await expect(page.getByTestId('route-here-button')).toBeEnabled({ timeout: 10_000 });
    await page.getByTestId('route-here-button').click();
    await expect(page.getByTestId('route-summary-panel')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('start-navigation-button')).toBeEnabled();

    // 2. "Navigation starten" -> real POST /navigation/start against the Core.
    await page.getByTestId('start-navigation-button').click();
    await expect(page.getByTestId('maneuver-panel')).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => navStatus(page), { timeout: 5_000 }).toBe('navigating');

    // The destination sheet (route-planning UI) makes way for drive mode.
    await expect(page.getByTestId('destination-sheet')).not.toBeVisible();

    // 3. Drive mode: camera switches to 3d-course (pitch ~55) + follow-me
    // recenters on each new position fix.
    await expect.poll(() => readPitch(page), { timeout: 5_000 }).toBeGreaterThan(50);

    await driveTo(page, 200);
    // Maneuver anchors are keyed by `begin_shape_index`; maneuver 0 sits at
    // shape index 0 (the depart point, `progressM` 0) so it's already
    // "passed" at any progress > 0 -- the panel shows the first REAL turn
    // (index 1) from the very start of the drive (same mechanism
    // `drive.spec.ts`'s own route exercises).
    await expect(page.getByTestId('maneuver-street')).toHaveText('Zielstraße');
    await expect
      .poll(async () => {
        const center = await readCenter(page);
        return center ? Math.abs(center.lat - latForProgressM(200)) : Infinity;
      }, { timeout: 5_000 })
      .toBeLessThan(0.01); // follow-me recentered the camera on the fed position

    // 4. Pause -> Resume.
    await expect(page.getByTestId('drive-pause-button')).toBeVisible();
    await page.getByTestId('drive-pause-button').click();
    await expect.poll(() => navStatus(page), { timeout: 5_000 }).toBe('paused');
    await expect(page.getByTestId('maneuver-panel')).toBeVisible(); // still shown while paused
    await expect(page.getByTestId('drive-resume-button')).toBeVisible();

    await page.getByTestId('drive-resume-button').click();
    await expect.poll(() => navStatus(page), { timeout: 5_000 }).toBe('navigating');
    await expect(page.getByTestId('drive-pause-button')).toBeVisible();

    // 5. Stop -> back to Explore mode; route stays drawn; nav/state idle
    // (destination null, per the E04-T5 plausibility requirement).
    await page.getByTestId('drive-stop-button').click();
    await expect(page.getByTestId('maneuver-panel')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByTestId('drive-controls')).toHaveCount(0);
    await expect.poll(() => navStatus(page), { timeout: 5_000 }).toBe('idle');
    const destinationAfterStop = await page.evaluate(
      () => window.__yapajaNavStore?.getState().navState?.destination,
    );
    expect(destinationAfterStop).toBeNull();

    // Explore mode: view mode restored (pitch back near 0, the prior mode).
    await expect.poll(() => readPitch(page), { timeout: 5_000 }).toBeLessThan(1);

    // The route-planning UI reappears, STILL showing the same route.
    await expect(page.getByTestId('destination-sheet')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('route-summary-panel')).toBeVisible();
    expect(
      await page.evaluate(() => Boolean(window.__yapajaMapController?.getMap()?.getLayer('route-main-accent'))),
    ).toBe(true);
    expect(await page.evaluate(() => window.__yapajaRoutingStore?.getState().activeRouteId)).toBe(ROUTE.id);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(tracker.getForeignUrls()).toEqual([]);
  });

  test('W-19: reload mid-navigation shows "Navigation fortsetzen?" and one click resumes navigating in < 3 s', async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const pageErrors = collectPageErrors(page);

    await page.goto(NAV_CONTROL_CORE_BASE_URL + '/');
    await waitForMapReady(page);

    // Start navigation directly against the Core (no live Valhalla/geocoder
    // to drive the UI flow through -- see the file-level comment; Flow 2
    // above already exercises the full UI-driven start).
    const startResponse = await page.request.post(`${NAV_CONTROL_CORE_BASE_URL}/api/v1/navigation/start`, {
      data: { route: ROUTE, destination: { latlng: ROUTE_POINTS[10], name: 'W-19 Ziel' } },
    });
    expect(startResponse.ok()).toBe(true);
    await driveTo(page, 150);
    await expect.poll(() => navStatus(page), { timeout: 5_000 }).toBe('navigating');

    // Reload: the tab crashes/reloads, the Core process (and its navigation)
    // stays alive. Time the whole recovery from reload to fully resumed.
    const reloadStart = Date.now();
    await page.reload();
    await waitForMapReady(page);

    await expect(page.getByTestId('resume-prompt')).toBeVisible({ timeout: 3_000 });
    // The Drive UI must NOT have jumped in on its own before the click.
    await expect(page.getByTestId('maneuver-panel')).toHaveCount(0);

    await page.getByTestId('resume-navigation-button').click();
    await expect(page.getByTestId('maneuver-panel')).toBeVisible({ timeout: 3_000 });
    await expect.poll(() => navStatus(page), { timeout: 3_000 }).toBe('navigating');
    const elapsedMs = Date.now() - reloadStart;
    expect(elapsedMs).toBeLessThan(3_000);

    expect(pageErrors).toEqual([]);
  });

  test('Flow 5 (prepared): changing the active profile mid-navigation does not crash the app or corrupt nav/state', async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const pageErrors = collectPageErrors(page);

    const otherProfileId = await createAndActivateProfile(page, 'E2E Flow5 Ausgangsprofil');

    await page.goto(NAV_CONTROL_CORE_BASE_URL + '/');
    await waitForMapReady(page);

    const startResponse = await page.request.post(`${NAV_CONTROL_CORE_BASE_URL}/api/v1/navigation/start`, {
      data: { route: ROUTE, destination: { latlng: ROUTE_POINTS[10], name: 'Flow5 Ziel' } },
    });
    expect(startResponse.ok()).toBe(true);
    await driveTo(page, 100);
    await expect.poll(() => navStatus(page), { timeout: 5_000 }).toBe('navigating');

    // Activate a DIFFERENT profile while navigating -- full "reroute + Warnhinweis"
    // (docs/03: profile activate during nav) is out of E04-T5's scope; this
    // just proves the app survives it and `nav/state` stays a valid status.
    const otherId = await createAndActivateProfile(page, 'E2E Flow5 Neues Profil');
    expect(otherId).not.toBe(otherProfileId);

    await driveTo(page, 150);
    const status = await navStatus(page);
    expect(['navigating', 'off_route', 'paused']).toContain(status);

    expect(pageErrors).toEqual([]);
  });
});
