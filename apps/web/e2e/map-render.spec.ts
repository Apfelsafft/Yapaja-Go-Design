/**
 * E01-T2 acceptance criteria #1 and #6: the map initializes and renders
 * (canvas visible) against the fixture region while fully offline, and the
 * OSM attribution is visible.
 */

import { test, expect } from '@playwright/test';
import { CORE_BASE_URL } from './support/constants.js';
import { trackRequests, collectPageErrors } from './support/network.js';

test('map canvas renders against the fixture region, fully offline', async ({ page }) => {
  const tracker = await trackRequests(page, CORE_BASE_URL);
  const pageErrors = collectPageErrors(page);

  await page.goto(CORE_BASE_URL + '/');

  await expect(page.getByTestId('map-container')).toBeVisible();
  const canvas = page.locator('canvas.maplibregl-canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });

  // Attribution (ADR-003 / ODbL requirement, UI guideline §6).
  await expect(page.getByText('OpenStreetMap contributors')).toBeVisible();

  // Zoom controls present (ADR-002 base gestures requirement).
  await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeVisible();

  expect(tracker.getForeignUrls()).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('start viewport is inside the installed region bounds (never [0, 0])', async ({ page }) => {
  await page.goto(CORE_BASE_URL + '/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

  const center = await page.evaluate(() => window.__yapajaMapController?.getMap()?.getCenter());
  expect(center).toBeTruthy();
  // Fixture bounds (see apps/core/src/map/__fixtures__/pmtiles-fixture.ts
  // FIXTURE_BOUNDS): roughly western/central Europe, nowhere near [0, 0].
  expect(center!.lng).toBeGreaterThan(1);
  expect(center!.lat).toBeGreaterThan(40);
});
