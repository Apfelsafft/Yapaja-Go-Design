/**
 * E01-T2 acceptance criterion #3: no request ever leaves the app's own
 * origin. Every non-same-origin request is hard-blocked at the network
 * layer (see support/network.ts) and this test asserts nothing was blocked
 * — i.e. the app genuinely never tried to reach a foreign host — and that
 * real, same-origin traffic (tiles + regions API) still happened.
 */

import { test, expect } from '@playwright/test';
import { CORE_BASE_URL } from './support/constants.js';
import { trackRequests, collectPageErrors } from './support/network.js';

test('every request stays same-origin; the map still loads fully offline', async ({ page }) => {
  const tracker = await trackRequests(page, CORE_BASE_URL);
  const pageErrors = collectPageErrors(page);

  await page.goto(CORE_BASE_URL + '/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

  // Give in-flight tile/style requests a moment to settle.
  await page.waitForTimeout(500);

  const allUrls = tracker.getAllUrls();
  expect(allUrls.length).toBeGreaterThan(0);
  for (const url of allUrls) {
    expect(new URL(url).origin).toBe(CORE_BASE_URL);
  }
  expect(tracker.getForeignUrls()).toEqual([]);

  // Sanity: the app actually exercised the real endpoints under test, not
  // just the HTML shell.
  expect(allUrls.some((u) => u.includes('/api/v1/map/regions'))).toBe(true);
  expect(allUrls.some((u) => u.includes('/tiles/'))).toBe(true);

  expect(pageErrors).toEqual([]);
});
