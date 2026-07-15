/**
 * E05-T3 Favoriten & Verlauf e2e -- docs/07 "Flow 6": anlegen -> Reload ->
 * Route via Favorit.
 *
 * The E2E core has no live Valhalla backend, so `POST /api/v1/routes` is
 * mocked in the browser with a fixed `Route[]` fixture, exactly the same
 * approach `routing.spec.ts`/`search.spec.ts` already use. Favorites/history
 * themselves ARE real: they go through the actual Core (SQLite, in-memory
 * for this dedicated test process, see `FAVORITES_CORE_PORT`), which is
 * exactly what proves persistence across the reload in step 2 below.
 *
 * Acceptance criteria covered here (docs/03 §2, E05-T3):
 * 1. Flow 6 itself: create a favorite via "Als Favorit speichern" in the
 *    destination bottom-sheet -> reload the page -> the favorite survived
 *    the reload -> tapping its chip starts a route.
 * 2. The CRITICAL "always current active profile" invariant, at the e2e
 *    level: activate a DIFFERENT profile AFTER creating the favorite, then
 *    tap it -- the route request must use the profile active at TAP time.
 * 3. Verlauf: a search selection is recorded, is tappable, and individually
 *    deletable.
 * 5. Fully offline + no console/page errors.
 */
import { test, expect, type Page } from '@playwright/test';
import type { Route, SearchResult } from '@yapaja/shared';
import { FAVORITES_CORE_BASE_URL } from './support/constants.js';
import { collectPageErrors, trackRequests } from './support/network.js';

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapajaMapController?.getMap?.()), undefined, {
    timeout: 15_000,
  });
}

const MAIN_ROUTE: Route = {
  id: 'r-fav-main',
  distance_m: 4200,
  duration_s: 360,
  geometry: '_gwj~A_cidP_pR_af@',
  legs: [],
  maneuvers: [],
  speed_limits: [],
  warnings: [],
};

/** Mocks `POST /api/v1/routes`, and (for the invariant test) records every
 *  request's JSON body into `capturedRequests` so the test can assert on
 *  exactly which `profile_id` a given tap sent -- Node-side, not a
 *  `window.*` debug hook, since this is about verifying wire traffic, not
 *  store state. */
async function mockRoutesEndpoint(
  page: Page,
  capturedRequests: Array<{ profile_id?: string }> = [],
): Promise<void> {
  await page.route('**/api/v1/routes', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    capturedRequests.push(route.request().postDataJSON() as { profile_id?: string });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [MAIN_ROUTE] }),
    });
  });
}

interface ProfileFixture {
  name: string;
  height_m: number;
  width_m: number;
  length_m: number;
  weight_t: number;
  avg_speed_kmh: number;
  hazmat: boolean;
  avoid: { motorway: boolean; toll: boolean; ferry: boolean; unpaved: boolean };
}

/** Creates + activates a vehicle profile directly via the API (faster/less
 *  flaky than the profile editor UI, same approach `routing.spec.ts` uses).
 *  Returns the created profile's id. */
async function createAndActivateProfile(page: Page, overrides: Partial<ProfileFixture> = {}): Promise<string> {
  const payload: ProfileFixture = {
    name: 'E2E Favoriten Test-Fahrzeug',
    height_m: 2.5,
    width_m: 2.1,
    length_m: 6.5,
    weight_t: 3.5,
    avg_speed_kmh: 80,
    hazmat: false,
    avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
    ...overrides,
  };
  const createResponse = await page.request.post(`${FAVORITES_CORE_BASE_URL}/api/v1/profiles`, {
    data: payload,
  });
  expect(createResponse.ok()).toBe(true);
  const created = (await createResponse.json()) as { data: { id: string } };

  const activateResponse = await page.request.put(
    `${FAVORITES_CORE_BASE_URL}/api/v1/profiles/${created.data.id}/activate`,
  );
  expect(activateResponse.ok()).toBe(true);
  return created.data.id;
}

async function clickMapCenter(page: Page): Promise<void> {
  const box = await page.locator('canvas.maplibregl-canvas').boundingBox();
  if (!box) {
    throw new Error('Canvas has no bounding box');
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * Opens the favorites drawer (if not already open) and switches to `tab`.
 * `FavoritesDrawer`'s `isOpen`/`tab` are plain component state that
 * SURVIVES the drawer being hidden and shown again (it's unconditionally
 * mounted in `App.tsx` -- hiding it while a destination is active is just
 * this component's own render returning `null`, not an unmount/remount) --
 * so a blind, unconditional toggle click would sometimes CLOSE an
 * already-open drawer instead of opening it. Checking `aria-expanded` first
 * makes this robust regardless of that internal state.
 */
async function ensureFavoritesDrawerOnTab(page: Page, tab: 'favorites' | 'history'): Promise<void> {
  const toggle = page.getByTestId('favorites-drawer-toggle');
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
  await page.getByTestId(`favorites-tab-${tab}`).click();
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  // Each test in this file gets a clean slate on the shared dedicated core
  // (favorites/history/profiles all persist across tests in the process
  // otherwise, since it's one long-lived in-memory DB for the whole file).
  await page.request.delete(`${FAVORITES_CORE_BASE_URL}/api/v1/history`);
  const favoritesRes = await page.request.get(`${FAVORITES_CORE_BASE_URL}/api/v1/favorites`);
  const favorites = (await favoritesRes.json()) as { data: { id: string }[] };
  for (const fav of favorites.data) {
    await page.request.delete(`${FAVORITES_CORE_BASE_URL}/api/v1/favorites/${fav.id}`);
  }
});

test('Flow 6: create favorite via destination sheet -> reload -> route via the favorite chip', async ({
  page,
}) => {
  const pageErrors = collectPageErrors(page);
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  const tracker = await trackRequests(page, FAVORITES_CORE_BASE_URL);
  await mockRoutesEndpoint(page);
  await createAndActivateProfile(page);

  await page.goto(FAVORITES_CORE_BASE_URL + '/');
  await waitForMapReady(page);

  // No destination yet -> the favorites drawer (not the destination sheet)
  // occupies the bottom-center footprint.
  await expect(page.getByTestId('favorites-drawer-toggle')).toBeVisible();
  await expect(page.getByTestId('destination-sheet')).not.toBeVisible();

  // 1. Pick a destination (map click, E03-T3 flow) -> "Als Favorit speichern".
  await clickMapCenter(page);
  await expect(page.getByTestId('destination-sheet')).toBeVisible();

  await page.getByTestId('save-as-favorite-button').click();
  await expect(page.getByTestId('save-favorite-form')).toBeVisible();
  await page.getByTestId('save-favorite-name-input').fill('Mein Lieblingsplatz');
  await page.getByTestId('save-favorite-category-select').selectOption('campsite');
  await page.getByTestId('save-favorite-confirm-button').click();

  await expect(page.getByTestId('save-favorite-success')).toBeVisible({ timeout: 5_000 });

  // Clear the destination so the favorites drawer becomes visible again.
  await page.getByTestId('destination-cancel-button').click();
  await expect(page.getByTestId('destination-sheet')).not.toBeVisible();

  // 2. RELOAD -- the favorite must have survived (it's in the Core's SQLite,
  // not just in-memory React state).
  await page.reload();
  await waitForMapReady(page);

  await ensureFavoritesDrawerOnTab(page, 'favorites');
  await expect(page.getByTestId('favorites-panel')).toBeVisible();

  const chipButton = page.locator('[data-testid^="favorite-chip-button-"]').filter({
    hasText: 'Mein Lieblingsplatz',
  });
  await expect(chipButton).toBeVisible({ timeout: 5_000 });
  await expect(chipButton).toContainText('⛺'); // campsite icon (icons.ts)

  // 3. Tap the chip -> a route is requested immediately, no extra dialog.
  await chipButton.click();

  await expect(page.getByTestId('destination-sheet')).toBeVisible();
  await expect(page.getByTestId('destination-title')).toHaveText('Mein Lieblingsplatz');
  await expect(page.getByTestId('route-summary-panel')).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => window.__yapajaRoutingStore?.getState().activeRouteId)).toBe(
    MAIN_ROUTE.id,
  );

  // 5. Fully offline + no errors.
  expect(tracker.getForeignUrls()).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('active-profile invariant (e2e): tapping a favorite uses the profile active AT TAP TIME, not at creation', async ({
  page,
}) => {
  const pageErrors = collectPageErrors(page);
  const capturedRouteRequests: Array<{ profile_id?: string }> = [];
  await mockRoutesEndpoint(page, capturedRouteRequests);

  const profileAId = await createAndActivateProfile(page, { name: 'Profil A (bei Anlage aktiv)' });

  await page.goto(FAVORITES_CORE_BASE_URL + '/');
  await waitForMapReady(page);

  // Create the favorite while Profile A is active.
  await clickMapCenter(page);
  await page.getByTestId('save-as-favorite-button').click();
  await page.getByTestId('save-favorite-name-input').fill('Invarianten-Favorit');
  await page.getByTestId('save-favorite-confirm-button').click();
  await expect(page.getByTestId('save-favorite-success')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId('destination-cancel-button').click();

  // Now activate a DIFFERENT profile B -- nothing about the favorite itself
  // changes or references any profile.
  const profileBId = await createAndActivateProfile(page, { name: 'Profil B (bei Tap aktiv)' });
  expect(profileBId).not.toBe(profileAId);

  // Wait for the app's own profile store to observe the activation (it
  // polls/fetches profiles on mount; re-fetch explicitly here to avoid a
  // race against that background refresh).
  await page.evaluate(async () => {
    await window.__yapajaProfileStore?.getState().fetchProfiles();
  });
  await expect
    .poll(() => page.evaluate(() => window.__yapajaProfileStore?.getState().activeProfile?.id))
    .toBe(profileBId);

  await ensureFavoritesDrawerOnTab(page, 'favorites');
  const chipButton = page.locator('[data-testid^="favorite-chip-button-"]').filter({
    hasText: 'Invarianten-Favorit',
  });
  await expect(chipButton).toBeVisible();
  await chipButton.click();

  await expect(page.getByTestId('route-summary-panel')).toBeVisible({ timeout: 10_000 });

  // The route request that just fired must have carried Profile B's id, NOT
  // Profile A's (the one active when the favorite was created).
  expect(capturedRouteRequests.length).toBeGreaterThan(0);
  const lastRouteRequestProfileId = capturedRouteRequests.at(-1)?.profile_id;
  expect(lastRouteRequestProfileId).toBe(profileBId);
  expect(lastRouteRequestProfileId).not.toBe(profileAId);

  expect(pageErrors).toEqual([]);
});

test('Verlauf: a search selection is recorded, tappable, and individually deletable', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await mockRoutesEndpoint(page);
  await createAndActivateProfile(page);

  const VADUZ: SearchResult = {
    name: 'Vaduz',
    label: 'Vaduz, Liechtenstein',
    latlng: { lat: 47.141, lon: 9.5215 },
    type: 'city',
    source: 'photon',
  };
  await page.route('**/api/v1/search*', async (route) => {
    const url = new URL(route.request().url());
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: q.includes('vad') ? [VADUZ] : [] }),
    });
  });

  await page.goto(FAVORITES_CORE_BASE_URL + '/');
  await waitForMapReady(page);

  await page.getByTestId('search-input').fill('Vad');
  const firstResult = page.getByTestId('search-result-0');
  await expect(firstResult).toBeVisible({ timeout: 2_000 });
  await firstResult.click();

  await expect(page.getByTestId('destination-sheet')).toBeVisible();
  await page.getByTestId('destination-cancel-button').click();

  await ensureFavoritesDrawerOnTab(page, 'history');

  const historyButton = page.locator('[data-testid^="history-item-button-"]').filter({ hasText: 'Vaduz' });
  await expect(historyButton).toBeVisible({ timeout: 5_000 });

  // Tapping the entry re-navigates.
  await historyButton.click();
  await expect(page.getByTestId('destination-sheet')).toBeVisible();
  await expect(page.getByTestId('destination-title')).toHaveText('Vaduz');
  await page.getByTestId('destination-cancel-button').click();

  // Individually deletable.
  await ensureFavoritesDrawerOnTab(page, 'history');
  const deleteButton = page.locator('[data-testid^="history-delete-"]').first();
  await deleteButton.click();
  await expect(page.getByTestId('history-empty')).toBeVisible({ timeout: 5_000 });

  expect(pageErrors).toEqual([]);
});
