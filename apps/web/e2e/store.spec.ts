/**
 * E09-T7 acceptance criteria (Add-on Store UI), Playwright coverage:
 *
 *  1. E2E flow against a local FIXTURE REGISTRY (this whole file): a real
 *     HTTP stub (`support/registryStub.ts`) the dedicated `STORE_CORE_PORT`
 *     core is pre-pointed at via `ADDONS_REGISTRY_URL`.
 *  2. An incompatible-`core_api` entry renders a BLOCKING NOTICE instead of
 *     an install button (Wargame W-11) -- `store-flows online` below.
 *  3. Registry unreachable -> the Store stays usable with cache + upload
 *     (Wargame W-13) -- `store flows offline` below.
 *  4. sha256 from the registry index is enforced -- a lying entry (well-
 *     formed sha256 that doesn't match its own tarball) is rejected at
 *     install, driven through the REAL UI, not just the REST layer
 *     (`registryRoutes.test.ts` already covers the same case at the
 *     integration level -- this proves the UI wires it through unchanged).
 *
 * Both tests below share ONE dedicated core + ONE registry stub (started/
 * stopped in `test.beforeAll`/`afterAll`) and run `describe.serial` so the
 * "online" test's installs are still in place (and the registry state it
 * left behind) when the "offline" test runs next -- exactly what's needed
 * to prove "a PREVIOUSLY cached catalog survives the registry going
 * unreachable", not just "the store never synced".
 */

import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { Buffer } from 'node:buffer';
import { STORE_CORE_BASE_URL, STORE_REGISTRY_PORT } from './support/constants.js';
import { collectPageErrors, trackRequests } from './support/network.js';
import { startRegistryStub, type RegistryStub } from './support/registryStub.js';
import { buildValidAddonTarball } from '../../core/src/addons/__fixtures__/buildTarball.js';
import { readPackageVersion } from '../../core/src/version.js';

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function incompatibleCoreApiRange(version: string): string {
  const major = parseInt(version.split('.')[0] ?? '0', 10);
  return `^${major + 1}.0.0`;
}

async function openStorePanel(page: Page): Promise<void> {
  await page.goto(STORE_CORE_BASE_URL + '/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('store-panel-toggle').click();
  await expect(page.getByTestId('store-panel')).toBeVisible();
}

let registryStub: RegistryStub;
let coreVersion: string;
let compatibleTarball: Buffer;
let incompatibleTarball: Buffer;
let uploadTarball: Buffer;
let lyingTarball: Buffer;

const COMPATIBLE_ID = 'com.example.store-compatible';
const INCOMPATIBLE_ID = 'com.example.store-incompatible';
const UPLOAD_ID = 'com.example.store-upload';
const LYING_ID = 'com.example.store-lying';

test.describe.serial('Add-on Store (E09-T7)', () => {
  test.beforeAll(async () => {
    coreVersion = await readPackageVersion();
    registryStub = await startRegistryStub(STORE_REGISTRY_PORT);

    compatibleTarball = (
      await buildValidAddonTarball({
        manifest: {
          id: COMPATIBLE_ID,
          name: 'Store-Test kompatibel',
          core_api: coreVersion,
          // `events.publish` included (E09-T8) so the "In Home Assistant
          // verfügbar" toggle actually renders once this add-on is
          // installed -- see the toggle assertions in the online test below.
          permissions: ['pos.read', 'map.layer.write', 'events.publish'],
        },
      })
    ).bytes;
    incompatibleTarball = (
      await buildValidAddonTarball({
        manifest: { id: INCOMPATIBLE_ID, name: 'Store-Test inkompatibel', core_api: '^0.0.1' },
      })
    ).bytes;
    uploadTarball = (
      await buildValidAddonTarball({
        manifest: { id: UPLOAD_ID, name: 'Store-Test Upload', core_api: coreVersion },
      })
    ).bytes;
    lyingTarball = (
      await buildValidAddonTarball({
        manifest: { id: LYING_ID, name: 'Store-Test Lügen-Hash', core_api: coreVersion },
      })
    ).bytes;
  });

  test.afterAll(async () => {
    await registryStub.close();
  });

  test('store flows online: sync a fixture registry, incompatible entry blocks install, compatible entry installs', async ({
    page,
  }) => {
    const compatibleUrl = registryStub.setTarball('compatible.tar.gz', compatibleTarball);
    const incompatibleUrl = registryStub.setTarball('incompatible.tar.gz', incompatibleTarball);
    const lyingUrl = registryStub.setTarball('lying.tar.gz', lyingTarball);
    registryStub.setIndexEntries([
      {
        id: COMPATIBLE_ID,
        name: 'Store-Test kompatibel',
        version: '1.0.0',
        description: 'E2E-Fixture, mit dieser Core-Version kompatibel',
        download_url: compatibleUrl,
        sha256: sha256(compatibleTarball),
        scopes: ['pos.read', 'map.layer.write', 'events.publish'],
        core_api: coreVersion,
        screenshots: [],
      },
      {
        id: INCOMPATIBLE_ID,
        name: 'Store-Test inkompatibel',
        version: '1.0.0',
        description: 'E2E-Fixture, core_api passt NICHT zu dieser Core-Version',
        download_url: incompatibleUrl,
        sha256: sha256(incompatibleTarball),
        scopes: [],
        core_api: incompatibleCoreApiRange(coreVersion),
        screenshots: [],
      },
      // Acceptance 4 (sha256 enforcement): well-FORMED but WRONG digest --
      // does not match `lyingTarball`'s real bytes.
      {
        id: LYING_ID,
        name: 'Store-Test Lügen-Hash',
        version: '1.0.0',
        description: 'E2E-Fixture mit falschem sha256 im Index',
        download_url: lyingUrl,
        sha256: sha256(Buffer.from('this does not match the real tarball')),
        scopes: [],
        core_api: coreVersion,
        screenshots: [],
      },
    ]);

    const tracker = await trackRequests(page, STORE_CORE_BASE_URL);
    const pageErrors = collectPageErrors(page);

    await openStorePanel(page);

    // Never synced yet -- cache status reflects that, catalog is empty.
    await expect(page.getByTestId('store-cache-status')).toContainText('noch nie synchronisiert');

    await page.getByTestId('store-sync-button').click();
    await expect(page.getByTestId(`catalog-entry-${COMPATIBLE_ID}`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(`catalog-entry-${INCOMPATIBLE_ID}`)).toBeVisible();
    await expect(page.getByTestId(`catalog-entry-${LYING_ID}`)).toBeVisible();
    await expect(page.getByTestId('store-cache-status')).not.toContainText('noch nie synchronisiert');

    // Acceptance 2: the incompatible entry shows a BLOCKING NOTICE, never an
    // install button.
    await expect(page.getByTestId(`incompatible-notice-${INCOMPATIBLE_ID}`)).toBeVisible();
    await expect(page.getByTestId(`install-button-${INCOMPATIBLE_ID}`)).toHaveCount(0);

    // The compatible entry DOES get an install button -- full scope-confirm
    // -> job-progress flow.
    await page.getByTestId(`install-button-${COMPATIBLE_ID}`).click();
    const confirmDialog = page.getByTestId('scope-confirm-dialog');
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog.getByTestId('scope-badge-pos.read')).toBeVisible();
    await expect(confirmDialog.getByTestId('scope-badge-map.layer.write')).toBeVisible();
    await page.getByTestId('scope-confirm-confirm-button').click();
    await expect(page.getByTestId('install-success')).toBeVisible({ timeout: 10_000 });

    // Acceptance 4: the LYING entry's install is rejected -- sha256 from the
    // index was passed straight through to the REAL install pipeline, which
    // downloaded the actual tarball and caught the mismatch.
    await page.getByTestId(`install-button-${LYING_ID}`).click();
    await expect(page.getByTestId('install-error')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('install-error')).toContainText(/sha256|mismatch/i);
    await page.getByTestId('install-flow-dismiss').click();

    // The now-installed add-on disappears from the catalog and shows up
    // under "Installierte Add-ons" (Updates tab).
    await expect(page.getByTestId(`catalog-entry-${COMPATIBLE_ID}`)).toHaveCount(0);
    await page.getByTestId('store-tab-updates').click();
    await expect(page.getByTestId(`installed-addon-${COMPATIBLE_ID}`)).toBeVisible();

    // E09-T8 acceptance 3: the "In Home Assistant verfügbar" toggle is
    // offered (this add-on declares `events.publish`), defaults to ON, and
    // flipping it round-trips through the real REST endpoint + refresh --
    // the server-side "takes effect immediately, no restart" half of this
    // acceptance criterion is proven separately, against a real broker, in
    // `apps/core/src/mqtt/addonEvents.integration.test.ts` (this dedicated
    // E2E core has no MQTT broker configured).
    const mqttToggle = page.getByTestId(`toggle-mqtt-${COMPATIBLE_ID}`);
    await expect(mqttToggle).toBeVisible();
    await expect(mqttToggle).toHaveText('In Home Assistant verfügbar ✓');
    await mqttToggle.click();
    await expect(mqttToggle).toHaveText('In Home Assistant verfügbar');
    await page.reload();
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('store-panel-toggle').click();
    await page.getByTestId('store-tab-updates').click();
    // Persisted server-side, still off after a full page reload.
    await expect(page.getByTestId(`toggle-mqtt-${COMPATIBLE_ID}`)).toHaveText('In Home Assistant verfügbar');
    await page.getByTestId(`toggle-mqtt-${COMPATIBLE_ID}`).click();
    await expect(page.getByTestId(`toggle-mqtt-${COMPATIBLE_ID}`)).toHaveText('In Home Assistant verfügbar ✓');

    await page.waitForTimeout(300);
    for (const url of tracker.getAllUrls()) {
      expect(new URL(url).origin).toBe(STORE_CORE_BASE_URL);
    }
    expect(tracker.getForeignUrls()).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('store flows offline (W-13): registry unreachable -> cache from the previous sync still renders, upload-install still works', async ({
    page,
  }) => {
    // The registry host goes down -- a real ECONNREFUSED, not a simulated
    // error response.
    await registryStub.goOffline();

    const tracker = await trackRequests(page, STORE_CORE_BASE_URL);
    const pageErrors = collectPageErrors(page);

    await openStorePanel(page);

    // The catalog from the PREVIOUS (online) test's sync is still visible --
    // this is the actual content of "Store nutzbar mit Cache", not merely
    // "the page doesn't crash".
    await expect(page.getByTestId(`catalog-entry-${INCOMPATIBLE_ID}`)).toBeVisible();
    await expect(page.getByTestId('store-cache-status')).not.toContainText('noch nie synchronisiert');

    // A manual sync attempt fails cleanly and visibly, WITHOUT wiping what's
    // already shown.
    await page.getByTestId('store-sync-button').click();
    await expect(page.getByTestId('store-sync-error')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(`catalog-entry-${INCOMPATIBLE_ID}`)).toBeVisible();

    // Upload-install is prominently offered and fully independent of the
    // registry -- prove it actually installs an add-on right here, offline.
    await expect(page.getByTestId('store-upload-section')).toContainText('Registry nicht erreichbar');
    await page.getByTestId('store-upload-input').setInputFiles({
      name: 'store-upload.tar.gz',
      mimeType: 'application/gzip',
      buffer: uploadTarball,
    });
    await expect(page.getByTestId('scope-confirm-dialog')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('scope-confirm-confirm-button').click();
    await expect(page.getByTestId('install-success')).toBeVisible({ timeout: 10_000 });

    await page.waitForTimeout(300);
    for (const url of tracker.getAllUrls()) {
      expect(new URL(url).origin).toBe(STORE_CORE_BASE_URL);
    }
    expect(tracker.getForeignUrls()).toEqual([]);
    expect(pageErrors).toEqual([]);

    // Bring the stub back so any LATER spec run against this same core
    // (there is none today, but a re-run of this file shares the core
    // process across both tests) never leaves a dangling "offline" state.
    await registryStub.goOnline();
  });
});
