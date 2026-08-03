/**
 * E2E for the "Stellplätze-Overlay" reference add-on (E09-T5, docs/05 §6.1).
 * Installs the REAL, esbuild-built tarball produced by
 * `addons-examples/poi-campsites/build.mjs` (not a hand-rolled fixture) via
 * the real two-step install API, enables it, and proves the acceptance flow:
 *
 *   1. The map layer + POI markers land on the live MapLibre map.
 *   2. Clicking a POI (in the add-on's own iframe list -- see the add-on's
 *      README for why the click target is the iframe's own list rather than
 *      a real map-marker click, a documented platform gap) shows a detail
 *      view AND updates the host-rendered `poi-detail` side-panel widget.
 *   3. "Route hierhin" only ever raises the host's confirmation banner
 *      (W-10) -- `/api/v1/navigation/destination` fires ZERO times until the
 *      user clicks "Übernehmen", exactly once after.
 *
 * Runs against its own dedicated core (`ADDON_EXAMPLES_CORE_BASE_URL`), same
 * "an unrelated parallel spec must never share install state" rationale
 * every other dedicated-port spec in this harness documents.
 */

import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADDON_EXAMPLES_CORE_BASE_URL, REPO_ROOT } from './support/constants.js';
import { collectPageErrors, trackRequests } from './support/network.js';

// Same rationale as addon-ui.spec.ts: the default `serviceWorkers: 'block'`
// instrumentation script touches `navigator.serviceWorker` inside every
// frame, including this spec's opaque-origin sandboxed add-on iframe, which
// throws a SecurityError there and would otherwise surface as an unrelated
// uncaught pageerror.
test.use({ serviceWorkers: 'allow' });

const ADDON_ID = 'com.yapaja.poi-campsites';
const ADDON_DIR = join(REPO_ROOT, 'addons-examples', 'poi-campsites');
const MAP_LAYER_ID = `addon:${ADDON_ID}:campsites`;
const WIDGET_TEXT_TESTID = `addon-widget-text-${ADDON_ID}/poi-detail`;

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapajaMapController?.getMap?.()), undefined, {
    timeout: 15_000,
  });
}

/** Builds the REAL tarball via the add-on's own `build.mjs` (proves the
 *  build script this task requires actually produces an installable
 *  package), then installs (two-step) + enables it against the dedicated core. */
async function buildInstallAndEnable(page: Page): Promise<void> {
  execFileSync('node', ['build.mjs'], { cwd: ADDON_DIR, stdio: 'inherit' });
  const tarball = readFileSync(join(ADDON_DIR, 'dist', 'poi-campsites.tgz'));

  const beginResponse = await page.request.post(`${ADDON_EXAMPLES_CORE_BASE_URL}/api/v1/addons/install`, {
    data: { source: 'upload', data: tarball.toString('base64') },
  });
  expect(beginResponse.status()).toBe(202);
  const begin = (await beginResponse.json()) as { data: { pending_id: string } };

  const confirmResponse = await page.request.post(
    `${ADDON_EXAMPLES_CORE_BASE_URL}/api/v1/addons/install/${begin.data.pending_id}/confirm`,
  );
  expect(confirmResponse.status()).toBe(201);

  const enableResponse = await page.request.post(`${ADDON_EXAMPLES_CORE_BASE_URL}/api/v1/addons/${ADDON_ID}/enable`);
  expect(enableResponse.status()).toBe(200);

  await page.evaluate(async () => {
    await window.__yapajaRefreshAddons?.();
  });
}

test.describe('POI-Overlay "Stellplätze" reference add-on (E09-T5, docs/05 §6.1)', () => {
  test.describe.configure({ mode: 'serial' });

  test('install from the built tarball -> layer+markers appear -> click a POI -> detail widget -> route.propose stays inert until confirmed', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const tracker = await trackRequests(page, ADDON_EXAMPLES_CORE_BASE_URL);
    const pageErrors = collectPageErrors(page);

    let destinationRequests = 0;
    await page.route('**/api/v1/navigation/destination', async (route) => {
      destinationRequests += 1;
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: '{"error":{"code":"E2E_STUB","message":"no routing backend in this harness"}}',
      });
    });

    await page.goto(ADDON_EXAMPLES_CORE_BASE_URL);
    await waitForMapReady(page);

    await buildInstallAndEnable(page);

    // --- the sandboxed iframe renders --------------------------------------
    const frame = page.getByTestId(`addon-frame-${ADDON_ID}`);
    await expect(frame).toBeVisible({ timeout: 10_000 });

    // --- criterion 1: the real map layer + markers land on the live map ----
    await expect
      .poll(
        async () =>
          page.evaluate((layerId) => {
            const map = window.__yapajaMapController?.getMap?.();
            return Boolean(map && map.getSource(layerId) && map.getLayer(layerId));
          }, MAP_LAYER_ID),
        { timeout: 10_000 },
      )
      .toBe(true);

    const addonFrame = page.frameLocator(`iframe[data-testid="addon-frame-${ADDON_ID}"]`);

    // The bundled fixture has 200 POIs -- the list renders all of them by
    // default (all categories start active).
    await expect(addonFrame.getByTestId('poi-count')).toHaveText('200', { timeout: 10_000 });

    // --- criterion 2: click a POI -> detail view + host widget update ------
    const firstItem = addonFrame.getByTestId('poi-item-poi-001');
    await expect(firstItem).toBeVisible();
    await firstItem.click();

    const routeButton = addonFrame.getByTestId('poi-route-button');
    await expect(routeButton).toBeVisible({ timeout: 5_000 });

    const widgetText = page.getByTestId(WIDGET_TEXT_TESTID);
    await expect(widgetText).toBeVisible({ timeout: 10_000 });
    await expect(widgetText).not.toHaveText('Kein Stellplatz ausgewählt');

    // --- category filter: unchecking every category empties the list -------
    const settingsToggle = addonFrame.getByTestId('poi-settings-toggle');
    await settingsToggle.click();
    const categoryCheckboxes = addonFrame.locator('#poi-settings-panel input[type="checkbox"]');
    const count = await categoryCheckboxes.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await categoryCheckboxes.nth(i).uncheck();
    }
    await expect(addonFrame.getByTestId('poi-count')).toHaveText('0');
    // Re-check them all so the rest of the flow (map layer still populated)
    // is unaffected by this sub-check.
    for (let i = 0; i < count; i++) {
      await categoryCheckboxes.nth(i).check();
    }
    await expect(addonFrame.getByTestId('poi-count')).toHaveText('200');

    // --- criterion 3: route.propose is inert until the user confirms (W-10) -
    await firstItem.click();
    await addonFrame.getByTestId('poi-route-button').click();

    const proposal = page.getByTestId('addon-route-proposal');
    await expect(proposal).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('addon-route-proposal-reason')).toContainText('Route zu');
    expect(destinationRequests).toBe(0);

    await page.getByTestId('addon-route-accept').click();
    await expect.poll(() => destinationRequests, { timeout: 5_000 }).toBe(1);
    await expect(proposal).toHaveCount(0);

    expect(pageErrors).toEqual([]);
    expect(tracker.getForeignUrls()).toEqual([]);
  });
});
