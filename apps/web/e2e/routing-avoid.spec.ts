/**
 * E03-T4 acceptance criteria (avoidances & temporary lockouts):
 * 1. An avoid-chip toggle (e.g. "Maut meiden") demonstrably changes the
 *    request: the NEXT `POST /api/v1/routes` body carries `avoid_overrides`.
 * 2. "Diesen Abschnitt meiden" (contextmenu/long-press on a rendered route)
 *    produces a request with `exclude_polygons`.
 * 3. The temporary-avoidance list is manageable: adding shows it in the
 *    panel, removing it fires a reroute WITHOUT `exclude_polygons` and
 *    removes it from the DOM.
 *
 * Same harness as `routing.spec.ts`: no live Valhalla in the E2E core, so
 * `POST /api/v1/routes` is mocked in the browser and every request body is
 * captured via `page.route` for assertion (this is exactly what "Abfang-Test
 * via page.route" means for the E2E layer).
 */

import { test, expect, type Page } from '@playwright/test';
import type { Route, RouteRequest } from '@yapaja/shared';
import { CORE_BASE_URL } from './support/constants.js';
import { collectPageErrors } from './support/network.js';

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapajaMapController?.getMap?.()), undefined, {
    timeout: 15_000,
  });
}

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

// A straight line lat=50.00, lon 9.00 -> 9.05 -- generated with the same
// algorithm as `apps/core/src/routing/polyline.ts`'s `encodePolyline6`
// against `[{lat:50,lon:9},{lat:50,lon:9.05}]`. Straight (not multi-segment)
// so any point strictly between the endpoints is reliably ON the rendered
// line for the contextmenu hit-test.
const MAIN_ROUTE: Route = {
  id: 'r-main',
  distance_m: 5200,
  duration_s: 480,
  geometry: '_gwj~A_cidP?_t`B',
  legs: [],
  maneuvers: [],
  speed_limits: [],
  warnings: [],
};

/** Records every `POST /api/v1/routes` body seen, in order, and always replies with `routes`. */
async function mockRoutesEndpoint(page: Page, routes: Route[]): Promise<{ bodies: RouteRequest[] }> {
  const state = { bodies: [] as RouteRequest[] };
  await page.route('**/api/v1/routes', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    const body = route.request().postDataJSON() as RouteRequest;
    state.bodies.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: routes }),
    });
  });
  return state;
}

/** Same helper as `routing.spec.ts`: create + activate a profile directly via the API. */
async function createAndActivateProfile(page: Page): Promise<void> {
  const createResponse = await page.request.post(`${CORE_BASE_URL}/api/v1/profiles`, {
    data: {
      name: 'E2E Avoid Test-Fahrzeug',
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
  if (!box) throw new Error('Canvas has no bounding box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Finds a page-space point that projects onto a point strictly between MAIN_ROUTE's two endpoints AND isn't covered by another DOM element (e.g. the bottom sheet). */
async function findPointOnMainRoute(page: Page): Promise<{ x: number; y: number }> {
  const canvasBox = await page.locator('canvas.maplibregl-canvas').boundingBox();
  if (!canvasBox) throw new Error('Canvas has no bounding box');

  // Several candidates along the straight line lat=50, lon 9.00..9.05,
  // excluding the exact endpoints (start/destination markers sit there).
  const candidates: [number, number][] = [
    [9.01, 50],
    [9.015, 50],
    [9.02, 50],
    [9.025, 50],
    [9.03, 50],
    [9.035, 50],
    [9.04, 50],
  ];

  for (const candidate of candidates) {
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
  throw new Error('No candidate point on MAIN_ROUTE is on an unobstructed part of the map canvas');
}

test.describe('E03-T4 avoid-chip toggle', () => {
  test('toggling "Maut meiden" sends a new /routes request with avoid_overrides.toll = true', async ({
    page,
  }) => {
    const pageErrors = collectPageErrors(page);
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const captured = await mockRoutesEndpoint(page, [MAIN_ROUTE]);
    await createAndActivateProfile(page);

    await page.goto(CORE_BASE_URL + '/');
    await waitForMapReady(page);

    await clickMapCenter(page);
    await expect(page.getByTestId('destination-sheet')).toBeVisible();
    await expect(page.getByTestId('route-here-button')).toBeEnabled({ timeout: 10_000 });

    // Baseline route request (no avoidances yet).
    await page.getByTestId('route-here-button').click();
    await expect(page.getByTestId('route-summary-panel')).toBeVisible({ timeout: 10_000 });
    expect(captured.bodies).toHaveLength(1);
    expect(captured.bodies[0].avoid_overrides).toBeUndefined();

    // The 4 avoid chips are visible, initially reflecting the profile
    // default (all false -> aria-pressed="false").
    await expect(page.getByTestId('avoid-chip-toll')).toBeVisible();
    await expect(page.getByTestId('avoid-chip-toll')).toHaveAttribute('aria-pressed', 'false');

    // Toggle "Maut meiden" -> immediately fires a NEW /routes request.
    await page.getByTestId('avoid-chip-toll').click();
    await expect
      .poll(() => captured.bodies.length)
      .toBe(2);
    expect(captured.bodies[1].avoid_overrides).toEqual({ toll: true });
    // The rest of the payload is unchanged (still no exclude_polygons).
    expect(captured.bodies[1].exclude_polygons).toBeUndefined();
    await expect(page.getByTestId('avoid-chip-toll')).toHaveAttribute('aria-pressed', 'true');

    // Toggling back flips the override back to false and reroutes again.
    await page.getByTestId('avoid-chip-toll').click();
    await expect
      .poll(() => captured.bodies.length)
      .toBe(3);
    expect(captured.bodies[2].avoid_overrides).toEqual({ toll: false });
    await expect(page.getByTestId('avoid-chip-toll')).toHaveAttribute('aria-pressed', 'false');

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

test.describe('E03-T4 "Diesen Abschnitt meiden"', () => {
  test('contextmenu on the rendered route adds an exclude_polygon and reroutes; the avoidance is listed and removable', async ({
    page,
  }) => {
    const pageErrors = collectPageErrors(page);
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const captured = await mockRoutesEndpoint(page, [MAIN_ROUTE]);
    await createAndActivateProfile(page);

    await page.goto(CORE_BASE_URL + '/');
    await waitForMapReady(page);

    await clickMapCenter(page);
    await expect(page.getByTestId('route-here-button')).toBeEnabled({ timeout: 10_000 });
    await page.getByTestId('route-here-button').click();
    await expect(page.getByTestId('route-summary-panel')).toBeVisible({ timeout: 10_000 });
    expect(captured.bodies).toHaveLength(1);

    // Wait for the route layer's auto-fit-bounds animation to finish so the
    // subsequent `map.project(...)` reflects the FINAL camera.
    await page.waitForTimeout(800);
    await waitForCameraIdle(page);

    // No avoidance list yet.
    await expect(page.getByTestId('avoid-list')).not.toBeVisible();

    // Right-click (contextmenu) directly on the rendered route line.
    const point = await findPointOnMainRoute(page);
    await page.mouse.click(point.x, point.y, { button: 'right' });

    // -> a new /routes request with exclude_polygons: one ring of >= 3 points.
    await expect.poll(() => captured.bodies.length).toBe(2);
    const secondBody = captured.bodies[1];
    expect(secondBody.exclude_polygons).toBeDefined();
    expect(secondBody.exclude_polygons).toHaveLength(1);
    expect(secondBody.exclude_polygons![0].length).toBeGreaterThanOrEqual(3);
    // Every ring point is a valid LatLng object (app-internal order; the
    // Core does the lon/lat swap for Valhalla, not the browser).
    for (const p of secondBody.exclude_polygons![0]) {
      expect(typeof p.lat).toBe('number');
      expect(typeof p.lon).toBe('number');
    }

    // The avoidance list becomes visible with exactly one entry.
    await expect(page.getByTestId('avoid-list')).toBeVisible();
    const items = page.locator('[data-testid^="avoid-list-item-"]');
    await expect(items).toHaveCount(1);

    // Removing it fires a reroute WITHOUT exclude_polygons and clears the list.
    await page.locator('[data-testid^="avoid-list-remove-"]').first().click();
    await expect.poll(() => captured.bodies.length).toBe(3);
    expect(captured.bodies[2].exclude_polygons).toBeUndefined();
    await expect(page.getByTestId('avoid-list')).not.toBeVisible();

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
