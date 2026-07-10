/**
 * E01-T5 web acceptance criteria (regions manager UI):
 *
 * The full resumable-download flow (abort/resume, sha256, disk-full) is
 * already covered end-to-end by core integration tests
 * (apps/core/src/map/regions/routes.test.ts, disk-check.routes.test.ts)
 * against a local mock HTTP server -- per the task spec's explicit choice,
 * this Playwright suite instead exercises the parts a browser adds on top:
 * the panel opening, installed regions + the downloadable-regions catalog
 * both rendering from the real (built) core, deleting the only installed
 * region being refused with a plain-language 409 message, and that opening/
 * using the panel never issues a request to a foreign host (reusing the
 * same offline-network harness as the other E01 specs).
 *
 * Both e2e cores serve the bundled default regions-catalog.json (no
 * override configured in globalSetup) -- its entries never match either
 * core's installed region ("fixture"), so they always render as
 * not-installed, which is exactly what's needed to exercise the catalog
 * list + download button rendering here.
 */

import { test, expect } from '@playwright/test';
import { CORE_BASE_URL, EMPTY_CORE_BASE_URL, FIXTURE_REGION } from './support/constants.js';
import { trackRequests, collectPageErrors } from './support/network.js';

test('regions panel shows the installed region and refuses to delete the last one (409)', async ({
  page,
}) => {
  const tracker = await trackRequests(page, CORE_BASE_URL);
  const pageErrors = collectPageErrors(page);

  await page.goto(CORE_BASE_URL + '/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('regions-panel-toggle').click();
  await expect(page.getByTestId('regions-panel')).toBeVisible();

  const installedEntry = page.getByTestId(`installed-region-${FIXTURE_REGION}`);
  await expect(installedEntry).toBeVisible();
  await expect(installedEntry).toContainText(FIXTURE_REGION);

  // Catalog entries (from the bundled default catalog) render, not marked
  // as installed, each with a working download button.
  await expect(page.getByTestId('catalog-region-liechtenstein')).toBeVisible();
  await expect(page.getByTestId('download-button-liechtenstein')).toBeVisible();

  // Deleting the only installed region must be refused (W-18-adjacent
  // "never half/zero map" rule) with a plain-language message, not a raw
  // error code.
  await page.getByTestId(`delete-button-${FIXTURE_REGION}`).click();
  const errorText = page.getByTestId(`region-error-${FIXTURE_REGION}`);
  await expect(errorText).toBeVisible();
  await expect(errorText).toContainText('letzte installierte Region');
  await expect(errorText).not.toContainText('LAST_REGION');

  // The region must still be installed after the refused delete.
  await expect(page.getByTestId(`installed-region-${FIXTURE_REGION}`)).toBeVisible();

  await page.waitForTimeout(300);
  for (const url of tracker.getAllUrls()) {
    expect(new URL(url).origin).toBe(CORE_BASE_URL);
  }
  expect(tracker.getForeignUrls()).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('regions panel is reachable and shows the catalog even with no map installed', async ({ page }) => {
  const tracker = await trackRequests(page, EMPTY_CORE_BASE_URL);
  const pageErrors = collectPageErrors(page);

  await page.goto(EMPTY_CORE_BASE_URL + '/');
  await expect(page.getByTestId('map-no-region')).toBeVisible({ timeout: 10_000 });

  await page.getByTestId('regions-panel-toggle').click();
  await expect(page.getByTestId('regions-panel')).toBeVisible();
  await expect(page.getByTestId('regions-installed-empty')).toBeVisible();
  await expect(page.getByTestId('catalog-region-liechtenstein')).toBeVisible();
  await expect(page.getByTestId('download-button-liechtenstein')).toBeVisible();

  await page.waitForTimeout(300);
  for (const url of tracker.getAllUrls()) {
    expect(new URL(url).origin).toBe(EMPTY_CORE_BASE_URL);
  }
  expect(tracker.getForeignUrls()).toEqual([]);
  expect(pageErrors).toEqual([]);
});
