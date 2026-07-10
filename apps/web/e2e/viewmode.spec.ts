/**
 * View Mode E2E Tests (E01-T3)
 *
 * Acceptance criteria:
 * 1. Three modes switchable: 2d-north, 2d-course, 3d-course
 * 2. View mode persists across reload (localStorage)
 * 3. Compass FAB appears on rotation, disappears on return to north
 * 4. Compass click returns to north and switches to 2d-north mode
 * 5. 2d-north locks bearing to 0 (ignores heading updates)
 * 6. Follow-Me pause after manual pan, Re-Center button appears
 * 7. Fully offline / no foreign hosts
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

import { test, expect } from '@playwright/test';
import { CORE_BASE_URL } from './support/constants.js';
import { trackRequests, collectPageErrors } from './support/network.js';

test('view modes: cycle through 2d-north, 2d-course, 3d-course', async ({ page }) => {
  const tracker = await trackRequests(page, CORE_BASE_URL);
  const pageErrors = collectPageErrors(page);

  await page.goto(CORE_BASE_URL + '/');

  // Wait for map to render
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

  // ViewModeButton should be visible
  const viewModeBtn = page.locator('[data-testid="viewmode-button"]');
  await expect(viewModeBtn).toBeVisible({ timeout: 5_000 });

  // Initial state should be 2d-north
  // Click ViewModeButton to cycle to 2d-course
  await viewModeBtn.click();
  await page.waitForTimeout(500); // Wait for animation

  // Click again to go to 3d-course
  await viewModeBtn.click();
  await page.waitForTimeout(500);

  const pitch = await page.evaluate(() => {
    return (window as any).__yapajaMapController?.getMap()?.getPitch?.() ?? null;
  });

  // In 3d-course mode, pitch should be ~55
  expect(pitch).toBeGreaterThan(50);

  // Back to 2d-north
  await viewModeBtn.click();
  await page.waitForTimeout(500);

  const bearing2 = await page.evaluate(() => {
    return (window as any).__yapajaMapController?.getMap()?.getBearing?.() ?? null;
  });

  expect(bearing2).toBe(0); // Should be north

  // Verify no console errors and no foreign requests
  expect(pageErrors).toEqual([]);
  expect(tracker.getForeignUrls()).toEqual([]);
});

test('view mode persists across reload', async ({ page, context }) => {
  const tracker = await trackRequests(page, CORE_BASE_URL);

  await page.goto(CORE_BASE_URL + '/');

  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

  // Set view mode to 3d-course
  const viewModeBtn = page.locator('[data-testid="viewmode-button"]');
  await viewModeBtn.click();
  await page.waitForTimeout(300); // Animation

  await viewModeBtn.click();
  await page.waitForTimeout(300); // Should now be in 3d-course

  // Verify it's in 3d-course
  let pitch = await page.evaluate(() => {
    return (window as any).__yapajaMapController?.getMap()?.getPitch?.() ?? null;
  });
  expect(pitch).toBeGreaterThan(50);

  // Reload
  await page.reload();
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1000); // Wait for init

  // Should still be in 3d-course
  pitch = await page.evaluate(() => {
    return (window as any).__yapajaMapController?.getMap()?.getPitch?.() ?? null;
  });
  expect(pitch).toBeGreaterThan(50);

  expect(tracker.getForeignUrls()).toEqual([]);
});

test('compass FAB: appears on rotation, disappears at north', async ({ page }) => {
  const tracker = await trackRequests(page, CORE_BASE_URL);

  await page.goto(CORE_BASE_URL + '/');

  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

  // Compass should not be visible initially (at north)
  let compassBtn = page.locator('[data-testid="compass-button"]');
  await expect(compassBtn).not.toBeVisible({ timeout: 1_000 });

  // Rotate map via 2d-course mode (which reads heading if available)
  // For now, simulate by rotating via mapController
  await page.evaluate(() => {
    const map = (window as any).__yapajaMapController?.getMap?.();
    if (map) {
      map.setBearing(45); // Rotate 45 degrees
    }
  });

  await page.waitForTimeout(500);

  // Compass should appear
  await expect(compassBtn).toBeVisible({ timeout: 3_000 });

  // Click compass to return to north
  await compassBtn.click();
  await page.waitForTimeout(500); // Animation

  // Compass should disappear again
  await expect(compassBtn).not.toBeVisible({ timeout: 2_000 });

  // Bearing should be 0
  const bearing = await page.evaluate(() => {
    return (window as any).__yapajaMapController?.getMap()?.getBearing?.() ?? null;
  });
  expect(bearing).toBe(0);

  // Should be in 2d-north mode (after compass click)
  // Verify by rotating again and checking if bearing locks to 0
  await page.evaluate(() => {
    const map = (window as any).__yapajaMapController?.getMap?.();
    if (map) {
      map.setBearing(30);
    }
  });

  await page.waitForTimeout(300);

  // In 2d-north, bearing should remain 0 (or close to it)
  const bearingAfterRotate = await page.evaluate(() => {
    return (window as any).__yapajaMapController?.getMap()?.getBearing?.() ?? null;
  });
  expect(Math.abs(bearingAfterRotate)).toBeLessThan(5); // Allow small tolerance

  expect(tracker.getForeignUrls()).toEqual([]);
});

test('compass FAB: click sets mode to 2d-north', async ({ page }) => {
  await page.goto(CORE_BASE_URL + '/');

  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

  // Switch to 3d-course
  const viewModeBtn = page.locator('[data-testid="viewmode-button"]');
  await viewModeBtn.click();
  await page.waitForTimeout(300);
  await viewModeBtn.click();
  await page.waitForTimeout(300);

  // Rotate map
  await page.evaluate(() => {
    const map = (window as any).__yapajaMapController?.getMap?.();
    if (map) {
      map.setBearing(60);
    }
  });

  await page.waitForTimeout(500);

  // Click compass
  const compassBtn = page.locator('[data-testid="compass-button"]');
  await compassBtn.click();
  await page.waitForTimeout(500);

  // Check pitch (should be 0 for 2d-north, not 55 for 3d-course)
  const pitch = await page.evaluate(() => {
    return (window as any).__yapajaMapController?.getMap()?.getPitch?.() ?? null;
  });

  expect(pitch).toBe(0); // 2d-north pitch
});

test('follow-me: manual pan pauses, re-center resumes', async ({ page }) => {
  const tracker = await trackRequests(page, CORE_BASE_URL);

  await page.goto(CORE_BASE_URL + '/');

  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

  const mapCanvas = page.locator('canvas.maplibregl-canvas');

  // Re-Center button should not be visible initially
  let reCenterBtn = page.locator('[data-testid="recenter-button"]');
  await expect(reCenterBtn).not.toBeVisible({ timeout: 1_000 });

  // Simulate manual pan (drag on map)
  const boundingBox = await mapCanvas.boundingBox();
  if (boundingBox) {
    await page.mouse.move(boundingBox.x + boundingBox.width / 2, boundingBox.y + boundingBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(boundingBox.x + boundingBox.width / 2 + 50, boundingBox.y + boundingBox.height / 2 + 50, {
      steps: 5,
    });
    await page.mouse.up();

    await page.waitForTimeout(500);

    // Re-Center button should appear
    await expect(reCenterBtn).toBeVisible({ timeout: 3_000 });

    // Click Re-Center
    await reCenterBtn.click();
    await page.waitForTimeout(500);

    // Re-Center button should disappear
    await expect(reCenterBtn).not.toBeVisible({ timeout: 2_000 });
  }

  expect(tracker.getForeignUrls()).toEqual([]);
});

test('2d-north: bearing locked to 0 despite heading updates', async ({ page }) => {
  const tracker = await trackRequests(page, CORE_BASE_URL);

  await page.goto(CORE_BASE_URL + '/');

  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

  // Ensure in 2d-north mode
  const viewModeBtn = page.locator('[data-testid="viewmode-button"]');
  const bearing0 = await page.evaluate(() => {
    return (window as any).__yapajaMapController?.getMap()?.getBearing?.() ?? null;
  });

  if (bearing0 !== 0) {
    // Cycle to 2d-north
    if (bearing0 > 0) {
      await viewModeBtn.click();
      await page.waitForTimeout(300);
      await viewModeBtn.click();
      await page.waitForTimeout(300);
      await viewModeBtn.click();
      await page.waitForTimeout(300);
    }
  }

  // Try to rotate map (simulate via setBearing)
  await page.evaluate(() => {
    const map = (window as any).__yapajaMapController?.getMap?.();
    if (map) {
      map.setBearing(30); // Try to rotate
    }
  });

  await page.waitForTimeout(500);

  // In 2d-north, bearing should stay ~0 (with small tolerance)
  const bearing = await page.evaluate(() => {
    return (window as any).__yapajaMapController?.getMap()?.getBearing?.() ?? null;
  });

  // Allow small tolerance (< 5°) due to animation/async
  expect(Math.abs(bearing)).toBeLessThan(5);

  expect(tracker.getForeignUrls()).toEqual([]);
});

test('fully offline, no foreign requests', async ({ page }) => {
  const tracker = await trackRequests(page, CORE_BASE_URL);
  const pageErrors = collectPageErrors(page);

  await page.goto(CORE_BASE_URL + '/');

  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

  // Interact with all buttons
  const viewModeBtn = page.locator('[data-testid="viewmode-button"]');
  if (await viewModeBtn.isVisible()) {
    await viewModeBtn.click();
    await page.waitForTimeout(300);
  }

  const compassBtn = page.locator('[data-testid="compass-button"]');
  if (await compassBtn.isVisible()) {
    await compassBtn.click();
    await page.waitForTimeout(300);
  }

  const reCenterBtn = page.locator('[data-testid="recenter-button"]');
  if (await reCenterBtn.isVisible()) {
    await reCenterBtn.click();
    await page.waitForTimeout(300);
  }

  await page.waitForTimeout(500);

  // All requests must be same-origin
  expect(tracker.getForeignUrls()).toEqual([]);

  // No console errors
  expect(pageErrors).toEqual([]);
});
