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
 * list rendering here.
 *
 * ─── GEÄNDERT IN `feat/gui-install-path` ────────────────────────────────
 * Diese Spec behauptete vorher, jeder Katalogeintrag habe „a working
 * download button". Der Knopf war da, aber er funktionierte NICHT: die
 * Katalogeinträge nannten Geofabrik-`.pmtiles`-URLs, die es nie gab (404).
 * Die Spec hat das nie gemerkt, weil sie den Download nie ausgelöst hat --
 * sie hat die ANWESENHEIT eines Knopfes geprüft und daraus auf seine
 * Funktion geschlossen.
 *
 * Jetzt gilt: die mitgelieferten Regionen werden GEBAUT, nicht geladen, und
 * bekommen deshalb keinen Download-Knopf, sondern die Bau-Erklärung. Damit
 * das nicht bloß eine gestrichene Prüfung ist, weist der dritte Test die
 * Gegenrichtung nach -- ein Katalogeintrag MIT `url` bekommt sehr wohl
 * einen Download-Knopf.
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
  // as installed. Sie haben KEINE fertige Datei zum Herunterladen, also
  // steht dort die Bau-Erklärung statt eines Knopfes, der sicher scheitert.
  await expect(page.getByTestId('catalog-region-liechtenstein')).toBeVisible();
  await expect(page.getByTestId('download-button-liechtenstein')).toHaveCount(0);
  await expect(page.getByTestId('build-only-badge-liechtenstein')).toBeVisible();

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
  await expect(page.getByTestId('download-button-liechtenstein')).toHaveCount(0);
  await expect(page.getByTestId('build-hint-liechtenstein')).toBeVisible();

  await page.waitForTimeout(300);
  for (const url of tracker.getAllUrls()) {
    expect(new URL(url).origin).toBe(EMPTY_CORE_BASE_URL);
  }
  expect(tracker.getForeignUrls()).toEqual([]);
  expect(pageErrors).toEqual([]);
});

// Die Gegenprobe zu den beiden Tests oben. Ohne sie hätte ich nur eine
// Prüfung gestrichen: „kein Download-Knopf" wäre auch dann grün, wenn die
// Oberfläche NIE einen Download-Knopf zeigen könnte. Der Katalog wird hier
// abgefangen und um einen Eintrag MIT `url` ergänzt -- der bekommt einen
// Knopf, der danebenstehende ohne `url` nicht.
test('ein Katalogeintrag MIT Download-Quelle bekommt weiterhin einen Download-Knopf', async ({
  page,
}) => {
  await page.route('**/api/v1/map/regions/catalog', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            id: 'mitquelle',
            name: 'Mit eigener Quelle',
            url: 'http://127.0.0.1:9/mitquelle.pmtiles',
            sizeBytes: 1024,
            bounds: [0, 0, 1, 1],
            installed: false,
          },
          {
            id: 'ohnequelle',
            name: 'Ohne Quelle',
            pbfUrl: 'http://127.0.0.1:9/ohnequelle.osm.pbf',
            sizeBytes: 1024,
            bounds: [0, 0, 1, 1],
            buildEffort: 'small',
            installed: false,
          },
        ],
      }),
    });
  });

  await page.goto(EMPTY_CORE_BASE_URL + '/');
  await expect(page.getByTestId('map-no-region')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('regions-panel-toggle').click();
  await expect(page.getByTestId('regions-panel')).toBeVisible();

  await expect(page.getByTestId('download-button-mitquelle')).toBeVisible();
  await expect(page.getByTestId('build-only-badge-mitquelle')).toHaveCount(0);

  await expect(page.getByTestId('download-button-ohnequelle')).toHaveCount(0);
  await expect(page.getByTestId('build-only-badge-ohnequelle')).toBeVisible();
});
