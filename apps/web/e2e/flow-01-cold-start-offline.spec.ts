/**
 * docs/07 §5 — FLOW 1: "Kaltstart offline (Netzwerk-Block via Playwright-Route)
 * ⇒ Karte interaktiv < 5 s."
 *
 * Canonical proof for flow 1. See `e2e/FLOWS.md` for the full flow→spec table.
 *
 * "Offline" here is the project's definition throughout (docs/00, E01-T2): the
 * appliance has NO internet, only its own Core on localhost. The network block
 * is therefore a Playwright route that HARD-ABORTS every non-same-origin
 * request (`support/network.ts`), which is exactly the wording of the flow.
 * `pwa.spec.ts` covers the complementary case (Service-Worker cold start with
 * `context.setOffline(true)`, i.e. the Core unreachable too).
 *
 * End state is asserted BOTH ways, per the task's plausibility requirement:
 *  - API: `GET /api/v1/health` is `ok` and `GET /api/v1/map/regions` reports
 *    the installed region; the bounds the map actually initialised itself with
 *    must be that region's bounds (so "the map is up" is tied to real backend
 *    state, not just to a canvas existing).
 *  - UI: the MapLibre canvas is on screen, the OSM attribution is rendered,
 *    and the map genuinely REACTS to a user gesture (a real mouse drag moves
 *    the camera) — "interaktiv", not merely "painted".
 */

import { test, expect } from '@playwright/test';
import { CORE_BASE_URL } from './support/constants.js';
import { collectPageErrors, trackRequests } from './support/network.js';

/** docs/07 §5 Flow 1 budget. */
const INTERACTIVE_BUDGET_MS = 5_000;

interface RegionsReply {
  data: Array<{ region: string; bounds: [number, number, number, number] }>;
}

test('[Flow 1] cold start with the network blocked: map is interactive in < 5 s', async ({
  page,
}) => {
  const tracker = await trackRequests(page, CORE_BASE_URL);
  const pageErrors = collectPageErrors(page);
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // --- API side (before): what the backend says is installed ---------------
  const healthResponse = await page.request.get(`${CORE_BASE_URL}/api/v1/health`);
  expect(healthResponse.ok()).toBe(true);
  const regionsResponse = await page.request.get(`${CORE_BASE_URL}/api/v1/map/regions`);
  expect(regionsResponse.ok()).toBe(true);
  const regions = (await regionsResponse.json()) as RegionsReply;
  expect(regions.data.length).toBeGreaterThan(0);
  const installedRegion = regions.data[0];

  // --- the cold start itself ------------------------------------------------
  const startedAt = Date.now();
  await page.goto(CORE_BASE_URL + '/');

  // "Interactive" = the canvas is on screen AND the Map instance exists AND
  // its style is far enough along to answer camera queries. All three are
  // event-driven waits, no sleeps.
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: INTERACTIVE_BUDGET_MS });
  await page.waitForFunction(
    () => {
      const map = window.__yapajaMapController?.getMap?.();
      if (!map) return false;
      const center = map.getCenter();
      return Number.isFinite(center.lng) && Number.isFinite(center.lat);
    },
    undefined,
    { timeout: INTERACTIVE_BUDGET_MS },
  );
  const interactiveAfterMs = Date.now() - startedAt;

  // The budget itself. Deliberately asserted here rather than only measured:
  // it is flow 1's stated acceptance criterion. (The THROTTLED N100-profile
  // measurement of the same budget is E10-T2's job, in `e2e/perf/`.)
  expect(interactiveAfterMs).toBeLessThan(INTERACTIVE_BUDGET_MS);

  // --- UI side: the map genuinely responds to a user gesture ---------------
  const centerBefore = await page.evaluate(() => {
    const c = window.__yapajaMapController?.getMap?.()?.getCenter();
    return c ? { lng: c.lng, lat: c.lat } : null;
  });
  expect(centerBefore).not.toBeNull();

  const canvas = page.locator('canvas.maplibregl-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const bounds = box as NonNullable<typeof box>;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 - 120, bounds.y + bounds.height / 2 - 80, {
    steps: 10,
  });
  await page.mouse.up();

  // Event-driven: wait for the drag-induced camera movement to settle, then
  // assert the camera actually moved (a painted-but-dead canvas would not).
  await page.waitForFunction(
    () => {
      const map = window.__yapajaMapController?.getMap?.();
      return Boolean(map) && !map!.isMoving();
    },
    undefined,
    { timeout: 10_000 },
  );
  const centerAfter = await page.evaluate(() => {
    const c = window.__yapajaMapController?.getMap?.()?.getCenter();
    return c ? { lng: c.lng, lat: c.lat } : null;
  });
  expect(centerAfter).not.toBeNull();
  expect(
    Math.hypot(
      (centerAfter?.lng ?? 0) - (centerBefore?.lng ?? 0),
      (centerAfter?.lat ?? 0) - (centerBefore?.lat ?? 0),
    ),
  ).toBeGreaterThan(0);

  // Attribution is a hard legal requirement (docs/00 Rechtliches), and a
  // convenient proof that the map chrome rendered, not just the GL canvas.
  await expect(page.getByText('OpenStreetMap contributors')).toBeVisible();

  // --- API side (after): the map is bound to the REAL installed region -----
  // Ties the UI assertion above to backend state: the initial viewport was
  // fitted to the region the regions API reports (MapView's `bounds:
  // region.bounds`), so the camera must sit inside those bounds.
  const cameraCenter = centerBefore as NonNullable<typeof centerBefore>;
  const [minLon, minLat, maxLon, maxLat] = installedRegion.bounds;
  expect(cameraCenter.lng).toBeGreaterThanOrEqual(minLon);
  expect(cameraCenter.lng).toBeLessThanOrEqual(maxLon);
  expect(cameraCenter.lat).toBeGreaterThanOrEqual(minLat);
  expect(cameraCenter.lat).toBeLessThanOrEqual(maxLat);

  // The tiles the map fetched came from that same region, same-origin only.
  const allUrls = tracker.getAllUrls();
  expect(allUrls.some((u) => u.includes(`/tiles/${installedRegion.region}.pmtiles`))).toBe(true);
  expect(allUrls.some((u) => u.includes('/api/v1/map/regions'))).toBe(true);

  // --- the network block held ----------------------------------------------
  expect(tracker.getForeignUrls()).toEqual([]);
  for (const url of allUrls) {
    expect(new URL(url).origin).toBe(CORE_BASE_URL);
  }

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
