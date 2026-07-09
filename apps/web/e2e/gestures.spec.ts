/**
 * E01-T2 acceptance criterion #2: base gestures work — zoom via
 * double-tap/buttons and pan both change the live map state, verified
 * through the MapController (`window.__yapajaMapController`), exactly the
 * way other future modules (position, routing) are meant to read it.
 */

import { test, expect } from '@playwright/test';
import { CORE_BASE_URL } from './support/constants.js';

test.beforeEach(async ({ page }) => {
  await page.goto(CORE_BASE_URL + '/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
});

async function getZoom(page: import('@playwright/test').Page): Promise<number> {
  const zoom = await page.evaluate(() => window.__yapajaMapController?.getMap()?.getZoom());
  if (typeof zoom !== 'number') {
    throw new Error('MapController did not return a live map/zoom');
  }
  return zoom;
}

async function getCenter(
  page: import('@playwright/test').Page,
): Promise<{ lng: number; lat: number }> {
  const center = await page.evaluate(() => {
    const c = window.__yapajaMapController?.getMap()?.getCenter();
    return c ? { lng: c.lng, lat: c.lat } : null;
  });
  if (!center) {
    throw new Error('MapController did not return a live map/center');
  }
  return center;
}

test('NavigationControl zoom-in button increases the zoom level', async ({ page }) => {
  const initialZoom = await getZoom(page);

  await page.locator('.maplibregl-ctrl-zoom-in').click();

  await expect
    .poll(() => getZoom(page), { timeout: 5_000 })
    .toBeGreaterThan(initialZoom);
});

test('double-click on the map (double-tap gesture) zooms in', async ({ page }) => {
  const initialZoom = await getZoom(page);

  const box = await page.locator('canvas.maplibregl-canvas').boundingBox();
  if (!box) {
    throw new Error('Canvas has no bounding box');
  }
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);

  await expect
    .poll(() => getZoom(page), { timeout: 5_000 })
    .toBeGreaterThan(initialZoom);
});

test('dragging the map (pan gesture) moves the center', async ({ page }) => {
  const initialCenter = await getCenter(page);

  const box = await page.locator('canvas.maplibregl-canvas').boundingBox();
  if (!box) {
    throw new Error('Canvas has no bounding box');
  }
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 180, cy - 120, { steps: 15 });
  await page.mouse.up();

  await expect
    .poll(
      async () => {
        const center = await getCenter(page);
        return Math.abs(center.lng - initialCenter.lng) + Math.abs(center.lat - initialCenter.lat);
      },
      { timeout: 5_000 },
    )
    .toBeGreaterThan(0.001);
});

test('MapController.setCamera moves the camera (used by other modules like position/routing)', async ({
  page,
}) => {
  const initialZoom = await getZoom(page);
  const targetZoom = initialZoom + 2;

  await page.evaluate((zoom) => {
    window.__yapajaMapController?.setCamera({ zoom });
  }, targetZoom);

  await expect.poll(() => getZoom(page), { timeout: 5_000 }).toBeCloseTo(targetZoom, 1);
});
