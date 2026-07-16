/**
 * E03-T3 acceptance criteria:
 * 1. Click -> destination pin + "Route hierhin" -> route appears -> tapping
 *    an alternative swaps it to be the active (highlighted) route.
 * 2. `Route.warnings` are shown as a visible (yellow) banner.
 * 3. The route layer survives a style switch (E01-T4/ADR-013).
 * 4. The displayed distance/duration equal the API's `distance_m`/`duration_s`
 *    exactly, via the app's single formatter (`formatDistance`/
 *    `formatDuration`) -- never re-computed ad hoc in the component.
 * 5. No foreign network requests, no browser console errors.
 *
 * The E2E core has no real Valhalla backend (not runnable in this
 * environment), so `POST /api/v1/routes` is mocked in the browser with a
 * fixed `Route[]` fixture (one main route + two alternatives) -- this tests
 * the UI/map wiring deterministically, independent of actual routing.
 */

import { test, expect, type Page } from '@playwright/test';
import type { Route } from '@yapaja/shared';
import { CORE_BASE_URL } from './support/constants.js';
import { collectPageErrors } from './support/network.js';
import { formatDistance, formatDuration } from '../src/routing/format.js';

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapajaMapController?.getMap?.()), undefined, {
    timeout: 15_000,
  });
}

/** Waits until the map has finished any in-flight camera animation (e.g. the
 *  auto-fit-bounds `easeTo` `RouteLayer` triggers), so a subsequent
 *  `map.project(...)` call reflects the FINAL camera, not a mid-animation one. */
async function waitForCameraIdle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const map = window.__yapajaMapController?.getMap();
      return Boolean(map) && !map!.isMoving();
    },
    undefined,
    { timeout: 5_000 },
  );
}

// Geometries are polyline6 (1e6 precision), generated with the same
// algorithm as `apps/core/src/routing/polyline.ts`'s `encodePolyline6`
// against the known coordinate lists in the comments below -- all three
// routes share the same origin/destination (a realistic "alternatives"
// shape) so a single auto-fit-bounds call keeps all of them on screen.
const MAIN_ROUTE: Route = {
  id: 'r-main',
  distance_m: 5200,
  duration_s: 480,
  // [50.00,9.00] -> [50.01,9.02] -> [50.00,9.05]
  geometry: '_gwj~A_cidP_pR_af@~oR_ry@',
  legs: [],
  maneuvers: [],
  speed_limits: [],
  warnings: [{ code: 'NARROW_ROAD', message: 'Schmale Straße auf einem Teilstück der Route.' }],
};
const ALT_ROUTE_1: Route = {
  id: 'r-alt-1',
  distance_m: 5400,
  duration_s: 510,
  // [50.00,9.00] -> [49.99,9.02] -> [50.00,9.05]
  geometry: '_gwj~A_cidP~oR_af@_pR_ry@',
  legs: [],
  maneuvers: [],
  speed_limits: [],
  warnings: [],
};
const ALT_ROUTE_2: Route = {
  id: 'r-alt-2',
  distance_m: 5300,
  duration_s: 495,
  // [50.00,9.00] -> [50.005,9.025] -> [50.00,9.05]
  geometry: '_gwj~A_cidPowHoyo@nwHoyo@',
  legs: [],
  maneuvers: [],
  speed_limits: [],
  warnings: [],
};
// Several points along ALT_ROUTE_1's geometry to click precisely via
// `map.project(...)`. Multiple candidates (rather than a single midpoint)
// because `RoutingPanel`'s own bottom sheet can cover part of the map once a
// route is shown -- the test picks whichever candidate is actually
// unobstructed instead of guessing one. Deliberately excludes the shared
// origin/destination vertices ([9,50] and [9.05,50]) -- ALL THREE routes
// pass through those exact points, so a click there can hit whichever route
// happens to be queried first, not necessarily this one. Everything below is
// strictly interior to alt-1's own path, well clear of where the routes
// visually diverge.
const ALT_ROUTE_1_CANDIDATES: [number, number][] = [
  [9.005, 49.9975],
  [9.01, 49.995],
  [9.015, 49.9925],
  [9.02, 49.99],
  [9.0275, 49.9925],
  [9.035, 49.995],
  [9.0425, 49.9975],
];

async function mockRoutesEndpoint(page: Page, routes: Route[]): Promise<void> {
  await page.route('**/api/v1/routes', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: routes }),
    });
  });
}

/** Creates and activates a vehicle profile directly via the API (faster and
 *  less flaky than driving the profile editor UI, which `profiles.spec.ts`
 *  already covers end-to-end). Any active profile is sufficient here --
 *  `RoutingPanel` only checks `activeProfile !== null`, not its identity. */
async function createAndActivateProfile(page: Page): Promise<void> {
  const createResponse = await page.request.post(`${CORE_BASE_URL}/api/v1/profiles`, {
    data: {
      name: 'E2E Routing Test-Fahrzeug',
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
    `${CORE_BASE_URL}/api/v1/profiles/${created.data.id}/activate`,
  );
  expect(activateResponse.ok()).toBe(true);
}

async function clickMapCenter(page: Page): Promise<void> {
  const box = await page.locator('canvas.maplibregl-canvas').boundingBox();
  if (!box) {
    throw new Error('Canvas has no bounding box');
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * Finds a page-space point over the map canvas that (a) projects onto one of
 * `lngLatCandidates` and (b) isn't covered by another DOM element (e.g.
 * `RoutingPanel`'s own bottom sheet) -- i.e. an actually clickable point.
 */
async function findClickableCanvasPoint(
  page: Page,
  lngLatCandidates: [number, number][],
): Promise<{ x: number; y: number }> {
  const canvasBox = await page.locator('canvas.maplibregl-canvas').boundingBox();
  if (!canvasBox) {
    throw new Error('Canvas has no bounding box');
  }

  for (const candidate of lngLatCandidates) {
    const result = await page.evaluate(
      ({ candidate, boxX, boxY }) => {
        const map = window.__yapajaMapController?.getMap();
        if (!map) return null;
        const p = map.project(candidate as [number, number]);
        const pageX = boxX + p.x;
        const pageY = boxY + p.y;
        const el = document.elementFromPoint(pageX, pageY);
        return { pageX, pageY, isCanvas: el?.tagName === 'CANVAS' };
      },
      { candidate, boxX: canvasBox.x, boxY: canvasBox.y },
    );
    if (result?.isCanvas) {
      return { x: result.pageX, y: result.pageY };
    }
  }
  throw new Error('No candidate point is on an unobstructed part of the map canvas');
}

test('click destination -> request route -> tap alternative -> style switch survives', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  await mockRoutesEndpoint(page, [MAIN_ROUTE, ALT_ROUTE_1, ALT_ROUTE_2]);
  await createAndActivateProfile(page);

  await page.goto(CORE_BASE_URL + '/');
  await waitForMapReady(page);

  // 1. Click on the map -> destination pin + bottom sheet with "Route hierhin".
  await clickMapCenter(page);
  await expect(page.getByTestId('destination-sheet')).toBeVisible();
  await expect(page.getByTestId('destination-coords')).toBeVisible();
  // Coordinates are shown with 5 decimals, e.g. "49.12345, 8.12345".
  await expect(page.getByTestId('destination-coords')).toHaveText(/^-?\d+\.\d{5}, -?\d+\.\d{5}$/);

  // The "Route hierhin" button only becomes enabled once an active profile
  // is known (RoutingInitializer fetches profiles proactively on mount).
  await expect(page.getByTestId('route-here-button')).toBeEnabled({ timeout: 10_000 });

  // 2. Request the route.
  await page.getByTestId('route-here-button').click();
  await expect(page.getByTestId('route-summary-panel')).toBeVisible({ timeout: 10_000 });

  // 3. Displayed distance/duration equal the API values EXACTLY, via the
  // app's single formatter (plausibility requirement).
  await expect(page.getByTestId('route-distance')).toHaveText(formatDistance(MAIN_ROUTE.distance_m));
  await expect(page.getByTestId('route-duration')).toHaveText(formatDuration(MAIN_ROUTE.duration_s));

  // 4. Warnings are visible as a banner.
  await expect(page.getByTestId('route-warnings')).toBeVisible();
  await expect(page.getByTestId(`route-warning-${MAIN_ROUTE.warnings[0].code}`)).toContainText(
    MAIN_ROUTE.warnings[0].message,
  );

  // "Navigation starten" is present and enabled (E04-T5) -- not clicked here,
  // this spec only exercises the routing/UI plumbing; the full nav-start ->
  // drive-mode -> stop flow is nav-control.spec.ts's job (Flow 2).
  await expect(page.getByTestId('start-navigation-button')).toBeEnabled();

  // 5. The route layer is actually on the map, and the store's active route
  // is the main route.
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__yapajaMapController?.getMap()?.getLayer('route-main-accent'))))
    .toBe(true);
  expect(await page.evaluate(() => window.__yapajaRoutingStore?.getState().activeRouteId)).toBe(MAIN_ROUTE.id);

  // 6. Tap the alternative route on the map (clicked at its EXACT projected
  // screen position, not a guessed pixel) -> it becomes the active route.
  // `RouteLayer`'s auto-fit-bounds `easeTo` (500ms) starts asynchronously
  // after the route data lands, so `isMoving()` can read `false` for an
  // instant BEFORE the animation kicks in too -- wait it out first, then
  // confirm idle, so the projection below reflects the FINAL camera.
  await page.waitForTimeout(800);
  await waitForCameraIdle(page);
  const clickPoint = await findClickableCanvasPoint(page, ALT_ROUTE_1_CANDIDATES);
  await page.mouse.click(clickPoint.x, clickPoint.y);

  await expect
    .poll(() => page.evaluate(() => window.__yapajaRoutingStore?.getState().activeRouteId))
    .toBe(ALT_ROUTE_1.id);

  // The previously-active route is now a gray alternative; the tapped one is
  // active -- summary panel reflects the swap (distance/duration update).
  await expect(page.getByTestId('route-distance')).toHaveText(formatDistance(ALT_ROUTE_1.distance_m));
  await expect(page.getByTestId('route-duration')).toHaveText(formatDuration(ALT_ROUTE_1.duration_s));

  // 7. Style-switch survival (acceptance #3): switch to the dark style, and
  // the route source/layer (and the routing store's state) must survive --
  // same pattern as the E01-T4 "dummy layer survives a switch" test.
  await page.locator('[data-testid="style-panel-toggle"]').click();
  await expect(page.locator('[data-testid="style-panel"]')).toBeVisible();
  await page.locator('[data-testid="style-option-yapaja-dark"]').click();

  await expect
    .poll(() => page.evaluate(() => Boolean(window.__yapajaMapController?.getMap()?.getLayer('route-main-accent'))))
    .toBe(true);
  expect(
    await page.evaluate(() => Boolean(window.__yapajaMapController?.getMap()?.getSource('route-main-source'))),
  ).toBe(true);
  expect(
    await page.evaluate(() => Boolean(window.__yapajaMapController?.getMap()?.getLayer('route-alt-layer'))),
  ).toBe(true);
  // The routing store's own state (which route is active) is untouched by a
  // style switch -- it never depended on the style in the first place.
  expect(await page.evaluate(() => window.__yapajaRoutingStore?.getState().activeRouteId)).toBe(ALT_ROUTE_1.id);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('destination pin appears even before the route is requested, and "Abbrechen" clears it', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await mockRoutesEndpoint(page, [MAIN_ROUTE]);

  await page.goto(CORE_BASE_URL + '/');
  await waitForMapReady(page);

  await clickMapCenter(page);
  await expect(page.getByTestId('destination-sheet')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__yapajaMapController?.getMap()?.getLayer('route-dest-marker'))))
    .toBe(true);

  await page.getByTestId('destination-cancel-button').click();
  await expect(page.getByTestId('destination-sheet')).not.toBeVisible();
  expect(await page.evaluate(() => window.__yapajaRoutingStore?.getState().destination)).toBeNull();

  expect(pageErrors).toEqual([]);
});

test('OUT_OF_COVERAGE error (E03-T6): shows coverage message + "Regionen verwalten" button', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      // Ignore network error logs from mocked 422 responses (expected)
      const text = msg.text();
      if (!text.includes('Failed to load resource')) {
        consoleErrors.push(text);
      }
    }
  });

  // Mock the routing endpoint to return 422 OUT_OF_COVERAGE
  await page.route('**/api/v1/routes', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'OUT_OF_COVERAGE',
          message: 'destination liegt außerhalb der installierten Kartenabdeckung.',
          missing_region_hint: 'Österreich (at)',
        },
      }),
    });
  });

  await createAndActivateProfile(page);
  await page.goto(CORE_BASE_URL + '/');
  await waitForMapReady(page);

  // Click on the map to set a destination
  await clickMapCenter(page);
  await expect(page.getByTestId('destination-sheet')).toBeVisible();

  // Request the route
  await page.getByTestId('route-here-button').click();

  // Expect the OUT_OF_COVERAGE error message
  await expect(page.getByTestId('route-error')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('route-error')).toContainText('Ziel liegt außerhalb der installierten Kartenabdeckung');

  // Expect the "Regionen verwalten" button (not "Erneut versuchen")
  await expect(page.getByTestId('route-open-regions-button')).toBeVisible();
  await expect(page.getByTestId('route-retry-button')).not.toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('NO_ROUTE error (E03-T6): shows different message than OUT_OF_COVERAGE', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      // Ignore network error logs from mocked 400 responses (expected)
      const text = msg.text();
      if (!text.includes('Failed to load resource')) {
        consoleErrors.push(text);
      }
    }
  });

  // Mock the routing endpoint to return 400 NO_ROUTE with honest vehicle message
  await page.route('**/api/v1/routes', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'NO_ROUTE',
          message: 'Keine für dein Fahrzeug befahrbare Route gefunden. Überprüfe Fahrzeugabmessungen (Höhe, Breite) und Vermeidungseinstellungen.',
        },
      }),
    });
  });

  await createAndActivateProfile(page);
  await page.goto(CORE_BASE_URL + '/');
  await waitForMapReady(page);

  // Click on the map to set a destination
  await clickMapCenter(page);
  await expect(page.getByTestId('destination-sheet')).toBeVisible();

  // Request the route
  await page.getByTestId('route-here-button').click();

  // Expect the NO_ROUTE error message (DIFFERENT from OUT_OF_COVERAGE)
  await expect(page.getByTestId('route-error')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('route-error')).toContainText('Keine für dein Fahrzeug befahrbare Route gefunden');

  // Expect the "Erneut versuchen" button (not "Regionen verwalten")
  await expect(page.getByTestId('route-retry-button')).toBeVisible();
  await expect(page.getByTestId('route-open-regions-button')).not.toBeVisible();

  // Error message must NOT contain "Kartenabdeckung" (that's OUT_OF_COVERAGE only)
  const errorText = await page.getByTestId('route-error').textContent();
  expect(errorText).not.toContain('Kartenabdeckung');

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
