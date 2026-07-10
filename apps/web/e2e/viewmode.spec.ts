/**
 * View Mode E2E Tests (E01-T3)
 *
 * Acceptance criteria:
 * 1. Three modes switchable: 2d-north, 2d-course, 3d-course
 * 2. View mode persists across reload (localStorage)
 * 3. Compass FAB appears on rotation, disappears on return to north
 * 4. Compass click returns to north and switches to 2d-north mode
 * 5. 2d-north locks bearing to 0 (ignores heading/rotation updates)
 * 6. Follow-Me pause after manual pan, Re-Center button appears
 * 7. Fully offline / no foreign hosts
 *
 * All waits are condition-based (`expect.poll` / `toPass` / `waitForFunction`)
 * so the assertions reflect REAL behavior rather than fixed sleeps.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { test, expect, type Page } from '@playwright/test';
import { CORE_BASE_URL } from './support/constants.js';
import { trackRequests, collectPageErrors } from './support/network.js';

/** Read the live map bearing via the E2E debug hook. */
function readBearing(page: Page): Promise<number | null> {
  return page.evaluate(
    () => (window as any).__yapajaMapController?.getMap()?.getBearing?.() ?? null
  );
}

/** Read the live map pitch via the E2E debug hook. */
function readPitch(page: Page): Promise<number | null> {
  return page.evaluate(
    () => (window as any).__yapajaMapController?.getMap()?.getPitch?.() ?? null
  );
}

/** Rotate the map programmatically (simulates a 2-finger rotate / heading turn). */
async function setBearing(page: Page, deg: number): Promise<void> {
  await page.evaluate((d) => {
    const map = (window as any).__yapajaMapController?.getMap?.();
    map?.setBearing(d);
  }, deg);
}

/** Wait until the map instance is registered and interactive. */
async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(
    () => Boolean((window as any).__yapajaMapController?.getMap?.()),
    undefined,
    { timeout: 15_000 }
  );
}

test('view modes: cycle through 2d-north, 2d-course, 3d-course', async ({ page }) => {
  const tracker = await trackRequests(page, CORE_BASE_URL);
  const pageErrors = collectPageErrors(page);

  await page.goto(CORE_BASE_URL + '/');
  await waitForMapReady(page);

  const viewModeBtn = page.locator('[data-testid="viewmode-button"]');
  await expect(viewModeBtn).toBeVisible({ timeout: 5_000 });

  // Start in 2d-north (pitch 0).
  await expect.poll(() => readPitch(page)).toBeLessThan(1);

  // Click -> 2d-course (still pitch 0).
  await viewModeBtn.click();
  await expect.poll(() => readPitch(page)).toBeLessThan(1);

  // Click -> 3d-course (pitch ~55).
  await viewModeBtn.click();
  await expect.poll(() => readPitch(page), { timeout: 5_000 }).toBeGreaterThan(50);

  // Click -> back to 2d-north (pitch 0, bearing 0).
  await viewModeBtn.click();
  await expect.poll(() => readPitch(page), { timeout: 5_000 }).toBeLessThan(1);
  await expect.poll(() => readBearing(page), { timeout: 5_000 }).toBeCloseTo(0, 0);

  expect(pageErrors).toEqual([]);
  expect(tracker.getForeignUrls()).toEqual([]);
});

test('view mode persists across reload', async ({ page }) => {
  const tracker = await trackRequests(page, CORE_BASE_URL);

  await page.goto(CORE_BASE_URL + '/');
  await waitForMapReady(page);

  // Cycle to 3d-course (2 clicks: north -> course -> 3d-course).
  const viewModeBtn = page.locator('[data-testid="viewmode-button"]');
  await viewModeBtn.click();
  await viewModeBtn.click();
  await expect.poll(() => readPitch(page), { timeout: 5_000 }).toBeGreaterThan(50);

  // Persisted value should be in localStorage.
  const stored = await page.evaluate(() => window.localStorage.getItem('yapaja.viewMode'));
  expect(stored).toBe('3d-course');

  // Reload: the persisted mode must be re-applied once the map is ready.
  await page.reload();
  await waitForMapReady(page);
  await expect.poll(() => readPitch(page), { timeout: 10_000 }).toBeGreaterThan(50);

  expect(tracker.getForeignUrls()).toEqual([]);
});

test('compass FAB: appears on rotation, disappears at north', async ({ page }) => {
  const tracker = await trackRequests(page, CORE_BASE_URL);

  await page.goto(CORE_BASE_URL + '/');
  await waitForMapReady(page);

  const compassBtn = page.locator('[data-testid="compass-button"]');
  const viewModeBtn = page.locator('[data-testid="viewmode-button"]');

  // Compass hidden at north.
  await expect(compassBtn).toBeHidden();

  // Switch to a course mode (3d-course) — 2d-north would hard-lock the bearing
  // back to 0, so rotation is only meaningful in a course mode.
  await viewModeBtn.click(); // 2d-course
  await viewModeBtn.click(); // 3d-course
  await expect.poll(() => readPitch(page), { timeout: 5_000 }).toBeGreaterThan(50);

  // Rotate the map -> compass appears.
  await setBearing(page, 45);
  await expect(compassBtn).toBeVisible({ timeout: 5_000 });

  // Click compass -> returns to north -> compass disappears.
  await compassBtn.click();
  await expect.poll(() => readBearing(page), { timeout: 5_000 }).toBeCloseTo(0, 0);
  await expect(compassBtn).toBeHidden({ timeout: 5_000 });

  expect(tracker.getForeignUrls()).toEqual([]);
});

test('compass FAB: click sets mode to 2d-north', async ({ page }) => {
  const tracker = await trackRequests(page, CORE_BASE_URL);

  await page.goto(CORE_BASE_URL + '/');
  await waitForMapReady(page);

  const compassBtn = page.locator('[data-testid="compass-button"]');
  const viewModeBtn = page.locator('[data-testid="viewmode-button"]');

  // Go to 3d-course (pitch ~55), then rotate so the compass appears.
  await viewModeBtn.click(); // 2d-course
  await viewModeBtn.click(); // 3d-course
  await expect.poll(() => readPitch(page), { timeout: 5_000 }).toBeGreaterThan(50);

  await setBearing(page, 60);
  await expect(compassBtn).toBeVisible({ timeout: 5_000 });

  // Click compass -> mode becomes 2d-north -> pitch resets to 0.
  await compassBtn.click();
  await expect.poll(() => readPitch(page), { timeout: 5_000 }).toBeLessThan(1);

  // And 2d-north now locks bearing: a further rotation is reset to 0.
  await setBearing(page, 40);
  await expect
    .poll(async () => Math.abs((await readBearing(page)) ?? 999), { timeout: 5_000 })
    .toBeLessThan(1);

  expect(tracker.getForeignUrls()).toEqual([]);
});

test('2d-north: bearing stays locked at 0 despite rotation', async ({ page }) => {
  const tracker = await trackRequests(page, CORE_BASE_URL);

  await page.goto(CORE_BASE_URL + '/');
  await waitForMapReady(page);

  // Default mode is 2d-north. Confirm bearing 0.
  await expect.poll(() => readBearing(page)).toBeCloseTo(0, 0);

  // Try to rotate programmatically several times — the 2d-north lock must
  // reset each rotation back to 0.
  for (const deg of [30, 90, 200]) {
    await setBearing(page, deg);
    await expect
      .poll(async () => Math.abs((await readBearing(page)) ?? 999), { timeout: 5_000 })
      .toBeLessThan(1);
  }

  expect(tracker.getForeignUrls()).toEqual([]);
});

test('follow-me: manual pan pauses follow, re-center resumes', async ({ page }) => {
  const tracker = await trackRequests(page, CORE_BASE_URL);

  await page.goto(CORE_BASE_URL + '/');
  await waitForMapReady(page);

  const reCenterBtn = page.locator('[data-testid="recenter-button"]');
  const mapCanvas = page.locator('canvas.maplibregl-canvas');

  // Not paused initially -> re-center hidden.
  await expect(reCenterBtn).toBeHidden();

  // Simulate a real user pan (mouse drag) -> fires dragstart with originalEvent.
  const box = await mapCanvas.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 80, cy + 80, { steps: 8 });
    await page.mouse.up();
  }

  // Follow pauses -> re-center button appears.
  await expect(reCenterBtn).toBeVisible({ timeout: 5_000 });

  // Click re-center -> resumes -> button disappears.
  await reCenterBtn.click();
  await expect(reCenterBtn).toBeHidden({ timeout: 5_000 });

  expect(tracker.getForeignUrls()).toEqual([]);
});

test('fully offline, no foreign requests', async ({ page }) => {
  const tracker = await trackRequests(page, CORE_BASE_URL);
  const pageErrors = collectPageErrors(page);

  await page.goto(CORE_BASE_URL + '/');
  await waitForMapReady(page);

  // Exercise the view-mode button through all three modes.
  const viewModeBtn = page.locator('[data-testid="viewmode-button"]');
  await viewModeBtn.click();
  await viewModeBtn.click();
  await viewModeBtn.click();

  expect(tracker.getForeignUrls()).toEqual([]);
  expect(pageErrors).toEqual([]);
});
