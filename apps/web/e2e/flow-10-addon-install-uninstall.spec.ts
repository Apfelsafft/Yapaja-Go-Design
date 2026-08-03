/**
 * docs/07 §5 — FLOW 10: "Add-on: Referenz-POI-Add-on installieren (lokaler
 * Registry-Fixture) ⇒ Layer sichtbar ⇒ deinstallieren ⇒ rückstandsfrei
 * (Layer weg, Storage weg)."
 *
 * Canonical proof for flow 10. See `e2e/FLOWS.md` for the full flow→spec table.
 *
 * WHAT WAS MISSING BEFORE E10-T1 — the flow's three halves existed, but never
 * joined up, and the last one not at all:
 *  - `store.spec.ts` (E09-T7) installs from a local registry fixture, but with
 *    synthetic throwaway tarballs, and never uninstalls.
 *  - `addon-examples-poi.spec.ts` (E09-T5) installs the REAL reference POI
 *    add-on and proves its map layer renders, but via UPLOAD, not a registry,
 *    and it never uninstalls either.
 *  - `addon-ui.spec.ts` proves DISABLE tears the UI down — which is not the
 *    same thing as uninstall being residue-free.
 * Nothing anywhere asserted "rückstandsfrei". This spec walks the whole flow:
 * REAL reference add-on, REAL local registry fixture, real map layer, real
 * uninstall, and residue checked on disk.
 *
 * END STATE ASSERTED BOTH WAYS:
 *  - UI: the sandboxed add-on iframe and its MapLibre layer are on the live
 *    map after install, and both are gone after uninstall.
 *  - API/filesystem: `GET /api/v1/addons` lists it enabled, then no longer
 *    lists it at all; and its code directory AND its `storage.own` directory
 *    are both gone from disk — the strongest available reading of
 *    "rückstandsfrei", and the half no UI assertion can reach.
 */

import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import {
  FLOW10_ADDONS_DIR,
  FLOW10_CORE_BASE_URL,
  FLOW10_REGISTRY_PORT,
  FLOW10_STORAGE_DIR,
  REPO_ROOT,
} from './support/constants.js';
import { collectPageErrors, trackRequests } from './support/network.js';
import { startRegistryStub, type RegistryStub } from './support/registryStub.js';

// Same rationale as addon-ui.spec.ts / addon-examples-poi.spec.ts: the default
// `serviceWorkers: 'block'` instrumentation touches `navigator.serviceWorker`
// inside the opaque-origin sandboxed add-on iframe, where it throws.
test.use({ serviceWorkers: 'allow' });

const ADDON_ID = 'com.yapaja.poi-campsites';
const ADDON_DIR = join(REPO_ROOT, 'addons-examples', 'poi-campsites');
const MAP_LAYER_ID = `addon:${ADDON_ID}:campsites`;

let registryStub: RegistryStub;
let tarball: Buffer;

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapajaMapController?.getMap?.()), undefined, {
    timeout: 15_000,
  });
}

interface AddonListReply {
  data: Array<{ id: string; enabled?: boolean; status?: string }>;
}

async function listAddons(page: Page): Promise<AddonListReply['data']> {
  const response = await page.request.get(`${FLOW10_CORE_BASE_URL}/api/v1/addons`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as AddonListReply).data;
}

/** Is the add-on's map layer currently on the live map? */
async function hasMapLayer(page: Page): Promise<boolean> {
  return page.evaluate((layerId) => {
    const map = window.__yapajaMapController?.getMap?.();
    return Boolean(map && map.getLayer(layerId));
  }, MAP_LAYER_ID);
}

test.describe.serial('docs/07 §5 Flow 10 (add-on install from registry -> uninstall)', () => {
  test.beforeAll(async () => {
    registryStub = await startRegistryStub(FLOW10_REGISTRY_PORT);
    // The REAL reference add-on, built by its OWN build script -- exactly what
    // `addon-examples-poi.spec.ts` does, so the flow genuinely exercises the
    // shipped artefact rather than a hand-rolled test fixture.
    execFileSync('node', ['build.mjs'], { cwd: ADDON_DIR, stdio: 'inherit' });
    tarball = readFileSync(join(ADDON_DIR, 'dist', 'poi-campsites.tgz'));
  });

  test.afterAll(async () => {
    await registryStub.close();
  });

  test('[Flow 10] install the reference POI add-on from a local registry fixture -> layer visible -> uninstall -> residue-free', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const tracker = await trackRequests(page, FLOW10_CORE_BASE_URL);
    const pageErrors = collectPageErrors(page);

    // --- the local registry fixture ----------------------------------------
    const downloadUrl = registryStub.setTarball('poi-campsites.tgz', tarball);
    registryStub.setIndexEntries([
      {
        id: ADDON_ID,
        name: 'Stellplätze-Overlay',
        version: '1.0.0',
        description: 'Referenz-POI-Add-on (docs/05 §6.1) aus lokalem Registry-Fixture',
        download_url: downloadUrl,
        sha256: sha256(tarball),
        scopes: ['map.layer.write', 'widget.register', 'route.propose'],
        core_api: '*',
        screenshots: [],
      },
    ]);

    await page.goto(FLOW10_CORE_BASE_URL + '/');
    await waitForMapReady(page);

    // Nothing installed yet -- so every "gone after uninstall" assertion below
    // is measured against a real change, not against a no-op.
    expect(await listAddons(page)).toEqual([]);
    expect(await hasMapLayer(page)).toBe(false);

    // --- install THROUGH THE STORE UI, from the registry --------------------
    await page.getByTestId('store-panel-toggle').click();
    await expect(page.getByTestId('store-panel')).toBeVisible();
    await page.getByTestId('store-sync-button').click();
    await expect(page.getByTestId(`catalog-entry-${ADDON_ID}`)).toBeVisible({ timeout: 15_000 });

    await page.getByTestId(`install-button-${ADDON_ID}`).click();
    const confirmDialog = page.getByTestId('scope-confirm-dialog');
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog.getByTestId('scope-badge-map.layer.write')).toBeVisible();
    await page.getByTestId('scope-confirm-confirm-button').click();
    await expect(page.getByTestId('install-success')).toBeVisible({ timeout: 30_000 });

    // API: the Core really has it installed now.
    await expect
      .poll(async () => (await listAddons(page)).map((a) => a.id), { timeout: 15_000 })
      .toContain(ADDON_ID);

    // Filesystem: the code landed in this core's own add-ons dir.
    const codeDir = join(FLOW10_ADDONS_DIR, ADDON_ID);
    expect(existsSync(codeDir)).toBe(true);

    // --- enable it ----------------------------------------------------------
    const enableResponse = await page.request.post(
      `${FLOW10_CORE_BASE_URL}/api/v1/addons/${ADDON_ID}/enable`,
    );
    expect(enableResponse.status()).toBe(200);
    await page.evaluate(async () => {
      await window.__yapajaRefreshAddons?.();
    });

    // API: enabled.
    const enabledRecord = (await listAddons(page)).find((a) => a.id === ADDON_ID);
    expect(enabledRecord).toBeDefined();
    expect(enabledRecord?.enabled ?? enabledRecord?.status === 'enabled').toBeTruthy();

    // --- UI: "Layer sichtbar" ------------------------------------------------
    await expect(page.getByTestId(`addon-frame-${ADDON_ID}`)).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => hasMapLayer(page), { timeout: 20_000 }).toBe(true);
    // ...and it really carries the add-on's bundled POIs, not an empty shell:
    // the add-on's own UI reports the count it pushed onto the layer (same
    // signal `addon-examples-poi.spec.ts` uses).
    const addonFrame = page.frameLocator(`iframe[data-testid="addon-frame-${ADDON_ID}"]`);
    await expect(addonFrame.getByTestId('poi-count')).toHaveText('200', { timeout: 20_000 });

    // --- seed `storage.own` so "Storage weg" is a REAL assertion -------------
    // The reference POI add-on does not declare the `storage.own` permission,
    // so it never writes this directory itself. Uninstall is nevertheless
    // contractually required to wipe it (`installService.ts#uninstall`:
    // "Removes code + BOTH storages"), and that guarantee had no e2e proof.
    // Seeding it here makes the residue check below assert something that
    // genuinely exists first, instead of passing on an absent directory.
    const storageDir = join(FLOW10_STORAGE_DIR, ADDON_ID);
    mkdirSync(storageDir, { recursive: true });
    writeFileSync(join(storageDir, 'state.json'), JSON.stringify({ lastViewedPoi: 42 }));
    expect(existsSync(join(storageDir, 'state.json'))).toBe(true);

    // --- uninstall -----------------------------------------------------------
    const uninstallResponse = await page.request.delete(
      `${FLOW10_CORE_BASE_URL}/api/v1/addons/${ADDON_ID}`,
    );
    expect(uninstallResponse.status()).toBe(204);
    await page.evaluate(async () => {
      await window.__yapajaRefreshAddons?.();
    });

    // --- rückstandsfrei: UI ---------------------------------------------------
    // "Layer weg": both the sandboxed iframe and the map layer are gone.
    await expect(page.getByTestId(`addon-frame-${ADDON_ID}`)).toHaveCount(0, { timeout: 20_000 });
    await expect.poll(() => hasMapLayer(page), { timeout: 20_000 }).toBe(false);
    // ...and its widget with it.
    await expect(page.getByTestId(`addon-widget-text-${ADDON_ID}/poi-detail`)).toHaveCount(0);

    // --- rückstandsfrei: API + filesystem ------------------------------------
    expect((await listAddons(page)).map((a) => a.id)).not.toContain(ADDON_ID);
    // "Storage weg" -- BOTH directories, code and storage.own.
    expect(existsSync(codeDir)).toBe(false);
    expect(existsSync(storageDir)).toBe(false);

    // A full reload must not resurrect anything either (no client-side
    // leftovers masking a server-side one, or vice versa).
    await page.reload();
    await waitForMapReady(page);
    expect(await hasMapLayer(page)).toBe(false);
    expect((await listAddons(page)).map((a) => a.id)).not.toContain(ADDON_ID);

    expect(tracker.getForeignUrls()).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
