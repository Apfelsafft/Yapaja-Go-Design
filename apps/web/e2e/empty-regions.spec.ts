/**
 * E01-T2 acceptance criterion #5: when no region is installed
 * (`GET /api/v1/map/regions` returns an empty list), MapView must show a
 * friendly "no map installed" state instead of crashing or initializing a
 * broken map.
 */

import { test, expect } from '@playwright/test';
import { EMPTY_CORE_BASE_URL } from './support/constants.js';
import { trackRequests, collectPageErrors } from './support/network.js';

test('shows a friendly "no map installed" state and never crashes when no regions exist', async ({
  page,
}) => {
  const tracker = await trackRequests(page, EMPTY_CORE_BASE_URL);
  const pageErrors = collectPageErrors(page);

  await page.goto(EMPTY_CORE_BASE_URL + '/');

  await expect(page.getByTestId('map-no-region')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Keine Karte installiert')).toBeVisible();

  // No MapLibre canvas should ever have been created.
  await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(0);

  expect(tracker.getForeignUrls()).toEqual([]);
  expect(pageErrors).toEqual([]);
});
