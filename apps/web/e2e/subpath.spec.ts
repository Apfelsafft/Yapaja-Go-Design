/**
 * E01-T2 acceptance criterion #4: the app works when served under an
 * arbitrary ingress sub-path (W-15). See support/subpathServer.ts for why a
 * dedicated test-only server is used here instead of the core (which always
 * serves at `/`, and changing that is out of this task's scope).
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

test('app loads, and assets/tiles resolve correctly, under a URL sub-path prefix', async ({
  page,
}) => {
  const tracker = await trackRequests(page, SUBPATH_BASE_URL);
  const pageErrors = collectPageErrors(page);

  await page.goto(`${SUBPATH_BASE_URL}${SUBPATH_PREFIX}/`);

  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('OpenStreetMap contributors')).toBeVisible();

  const allUrls = tracker.getAllUrls();
  // Every asset/API/tile request must itself be scoped under the sub-path
  // (proves the app used relative URLs, not hardcoded absolute `/...` ones).
  for (const url of allUrls) {
    const pathname = new URL(url).pathname;
    expect(pathname.startsWith(SUBPATH_PREFIX)).toBe(true);
  }
  expect(allUrls.some((u) => u.includes(`${SUBPATH_PREFIX}/api/v1/map/regions`))).toBe(true);
  expect(allUrls.some((u) => u.includes(`${SUBPATH_PREFIX}/tiles/`))).toBe(true);

  expect(tracker.getForeignUrls()).toEqual([]);
  expect(pageErrors).toEqual([]);
});
