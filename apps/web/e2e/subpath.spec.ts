/**
 * docs/07 §5 — FLOW 9: "Ingress-Simulation: App unter `/hassio_ingress/xyz/`
 * Sub-Pfad ⇒ alle Assets, WS und Tiles laden (Reverse-Proxy im
 * Compose-Testsetup)." (Also E01-T2 acceptance criterion #4, W-15.)
 *
 * Canonical proof for flow 9. See `e2e/FLOWS.md` for the full flow→spec table.
 *
 * DOCUMENTED DEVIATION -- "Reverse-Proxy im Compose-Testsetup": the reverse
 * proxy is `support/subpathServer.ts`, an in-process Node server, for the same
 * reason the rest of this harness boots real Core processes instead of a
 * compose stack (see `support/globalSetup.ts`). It is a genuine reverse proxy:
 * static files under the prefix, HTTP proxying of `/api` + `/tiles` including
 * Range requests, and (added in E10-T1) real WebSocket Upgrade forwarding.
 *
 * E10-T1 additions: the flow names THREE things that must load -- assets, WS
 * and tiles -- and the WS clause was previously untested (the proxy did not
 * even forward Upgrade requests). The sub-path is now also the flow's own
 * `/hassio_ingress/<token>/` shape rather than a generic prefix, and the end
 * state is asserted through the API as well as the UI.
 */

import { test, expect } from '@playwright/test';
import { CORE_PORT, SUBPATH_BASE_URL, SUBPATH_PORT, SUBPATH_PREFIX, WEB_DIST_DIR } from './support/constants.js';
import { startSubpathServer, type SubpathServerHandle } from './support/subpathServer.js';
import { trackRequests, collectPageErrors } from './support/network.js';

let handle: SubpathServerHandle;

test.beforeAll(async () => {
  handle = await startSubpathServer({
    prefix: SUBPATH_PREFIX,
    distDir: WEB_DIST_DIR,
    corePort: CORE_PORT,
    port: SUBPATH_PORT,
  });
});

test.afterAll(async () => {
  await handle.close();
});

test('[Flow 9] ingress sub-path: assets, tiles AND the WebSocket all load under /hassio_ingress/<token>/', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const tracker = await trackRequests(page, SUBPATH_BASE_URL);
  const pageErrors = collectPageErrors(page);
  const wsUrls: string[] = [];
  page.on('websocket', (ws) => wsUrls.push(ws.url()));

  await page.goto(`${SUBPATH_BASE_URL}${SUBPATH_PREFIX}/`);

  // --- UI: the app is fully up under the prefix ---------------------------
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('OpenStreetMap contributors')).toBeVisible();

  // --- WS: the position WebSocket really connected THROUGH the proxy ------
  // Asserted on the app's own connection state (the store only flips to
  // connected once the Core answers over that socket), not merely on a
  // handshake having been attempted.
  await expect
    .poll(
      () => page.evaluate(() => window.__yapajaPositionStore?.getState().isConnected ?? false),
      { timeout: 20_000 },
    )
    .toBe(true);
  expect(wsUrls.length).toBeGreaterThan(0);
  for (const url of wsUrls) {
    expect(new URL(url).pathname.startsWith(SUBPATH_PREFIX)).toBe(true);
  }

  const allUrls = tracker.getAllUrls();
  // Every asset/API/tile request must itself be scoped under the sub-path
  // (proves the app used relative URLs, not hardcoded absolute `/...` ones).
  for (const url of allUrls) {
    const pathname = new URL(url).pathname;
    expect(pathname.startsWith(SUBPATH_PREFIX)).toBe(true);
  }
  expect(allUrls.some((u) => u.includes(`${SUBPATH_PREFIX}/api/v1/map/regions`))).toBe(true);
  expect(allUrls.some((u) => u.includes(`${SUBPATH_PREFIX}/tiles/`))).toBe(true);

  // --- API through the proxy ------------------------------------------------
  // The same endpoints the UI relies on answer correctly when addressed via
  // the prefix, and report the region whose tiles the map just loaded.
  const health = await page.request.get(`${SUBPATH_BASE_URL}${SUBPATH_PREFIX}/api/v1/health`);
  expect(health.ok()).toBe(true);
  const regionsResponse = await page.request.get(
    `${SUBPATH_BASE_URL}${SUBPATH_PREFIX}/api/v1/map/regions`,
  );
  expect(regionsResponse.ok()).toBe(true);
  const regions = (await regionsResponse.json()) as { data: Array<{ region: string }> };
  expect(regions.data.length).toBeGreaterThan(0);
  expect(
    allUrls.some((u) => u.includes(`${SUBPATH_PREFIX}/tiles/${regions.data[0].region}.pmtiles`)),
  ).toBe(true);

  // A Range request through the proxy (how PMTiles is actually read) works too.
  const rangeResponse = await page.request.get(
    `${SUBPATH_BASE_URL}${SUBPATH_PREFIX}/tiles/${regions.data[0].region}.pmtiles`,
    { headers: { Range: 'bytes=0-126' } },
  );
  expect(rangeResponse.status()).toBe(206);

  expect(tracker.getForeignUrls()).toEqual([]);
  expect(pageErrors).toEqual([]);
});
