/**
 * E05-T2 search UI e2e (part of docs/07 Flow 2).
 *
 * The E2E core has no live Photon/Nominatim backend (E05-T4 wires that up
 * separately, gated behind `PHOTON_URL_LIVE`, see
 * `apps/core/src/search/routes.test.ts`'s bottom comment) -- so
 * `GET /api/v1/search` is mocked in the browser with a fixed
 * `SearchResult[]` fixture via `page.route`, the same approach
 * `routing.spec.ts` already uses for `POST /api/v1/routes`. This tests the
 * UI/store/map wiring deterministically, independent of the real geocoder.
 *
 * Acceptance criteria covered here:
 * 1. Typing delivers suggestions (search-as-you-type, debounced + mocked).
 * 2. Selecting a suggestion flies the map to it and reuses the EXISTING
 *    E03-T3 destination bottom sheet, now showing the real name.
 * 3. A11y: focus stays on the input (combobox pattern, never moves into the
 *    list), `aria-live="polite"` status region is present.
 * 4. Speed-lock (>10 km/h): the field disables and shows a hint.
 * 5. Fully offline (no foreign-host requests) + no console/page errors.
 */

import { test, expect, type Page } from '@playwright/test';
import type { Position, SearchResult } from '@yapaja/shared';
import { SEARCH_CORE_BASE_URL, SEARCH_SPEEDLOCK_CORE_BASE_URL } from './support/constants.js';
import { collectPageErrors, trackRequests } from './support/network.js';

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapajaMapController?.getMap?.()), undefined, {
    timeout: 15_000,
  });
}

/**
 * Types `query` and waits for the resulting `GET /api/v1/search` RESPONSE.
 *
 * E10-T1 de-flake. Every assertion below used to be a bare
 * `expect(...).toBeVisible({ timeout: 2_000 })` straight after `fill()`,
 * which put FOUR things inside one 2 s wall-clock budget: Playwright's own
 * `fill()` round-trip, the store's 300 ms debounce timer, the mocked fetch
 * (a CDP round-trip out to the test process and back), and the React commit.
 * Measured with a probe under parallel load, that chain runs 320-920 ms
 * normally but blows straight through 2 s when eight workers share the CPU
 * with SwiftShader-rendered maps -- so the suite failed on machine load, not
 * on behaviour ("element(s) not found" with a perfectly healthy page).
 *
 * Waiting for the response first makes the wait EVENT-driven: the debounce
 * and the network hop are no longer part of any budget, and what remains to
 * assert is only "did the UI render what the backend returned", which is a
 * single React commit away. The assertions themselves are unchanged and
 * un-loosened -- they just no longer race the machine.
 */
async function fillSearchAndAwaitResponse(page: Page, query: string): Promise<void> {
  const response = page.waitForResponse(
    (res) => res.url().includes('/api/v1/search'),
    { timeout: 15_000 },
  );
  await page.getByTestId('search-input').fill(query);
  await response;
}

/**
 * Waits until the MapLibre camera has come to REST.
 *
 * E10-T1 de-flake. The "map flew to Vaduz" check used to be an
 * `expect.poll(distance).toBeLessThan(0.05)` with a 5 s budget. `flyTo` is an
 * rAF-driven animation, and under CPU contention rAF is starved, so the
 * flight simply had not finished yet when the budget expired -- the observed
 * failure was `Received: 0.142` on a flight that starts ~4.1 degrees out,
 * i.e. the camera was 96.5 % of the way there and still moving. Nothing was
 * wrong; the test was racing an animation.
 *
 * Waiting for `isMoving()` to go false is the event-driven equivalent of
 * "the flight finished", and lets the coordinate assertion afterwards be a
 * plain, exact one instead of a tolerance-within-a-deadline poll.
 */
async function waitForCameraSettled(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const map = window.__yapajaMapController?.getMap?.();
      if (!map) return false;
      return !map.isMoving();
    },
    undefined,
    { timeout: 20_000 },
  );
}

const VADUZ_RESULT: SearchResult = {
  name: 'Vaduz',
  label: 'Vaduz, Liechtenstein',
  latlng: { lat: 47.141, lon: 9.5215 },
  type: 'city',
  source: 'photon',
};

/** Mocks `GET /api/v1/search`: any query containing "vad" (case-insensitive)
 *  returns the Vaduz fixture, everything else returns an empty result set --
 *  mirrors how a real geocoder would behave for an unmatched query. */
async function mockSearchEndpoint(page: Page): Promise<void> {
  await page.route('**/api/v1/search*', async (route) => {
    const url = new URL(route.request().url());
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const data = q.includes('vad') ? [VADUZ_RESULT] : [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data }),
    });
  });
}

function browserFixBody(overrides: Partial<Omit<Position, 'source'>> = {}): Omit<Position, 'source'> {
  return {
    lat: 47.0,
    lon: 9.5,
    alt: null,
    speed: 0,
    heading: null,
    accuracy: 5,
    fix: '3d',
    ts: new Date().toISOString(),
    ...overrides,
  };
}

/** Directly POSTs a position fix to the Core (bypassing real browser
 *  geolocation, same approach `routing.spec.ts` uses for profiles) so the
 *  test can set an exact `speed` value -- Playwright's own
 *  `context.setGeolocation` has no `speed` field. Geolocation permission is
 *  deliberately left ungranted for these tests so `browserSource`'s own
 *  `watchPosition` never fires and overwrites this with a real (speed-less)
 *  fix. */
async function postPosition(page: Page, overrides: Partial<Omit<Position, 'source'>>): Promise<void> {
  const response = await page.request.post(
    `${SEARCH_SPEEDLOCK_CORE_BASE_URL}/api/v1/position/browser`,
    { data: browserFixBody(overrides) },
  );
  expect(response.ok()).toBe(true);
}

test('type "Vad" -> suggestions appear -> select -> map flies + bottom sheet shows the real name', async ({
  page,
}) => {
  const tracker = await trackRequests(page, SEARCH_CORE_BASE_URL);
  const pageErrors = collectPageErrors(page);
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  await mockSearchEndpoint(page);

  await page.goto(SEARCH_CORE_BASE_URL + '/');
  await waitForMapReady(page);

  const input = page.getByTestId('search-input');
  await fillSearchAndAwaitResponse(page, 'Vad');

  // aria-live status region exists and is wired up correctly (present in
  // the DOM regardless of visibility -- it's `sr-only`, not `display:none`).
  const status = page.getByTestId('search-status');
  await expect(status).toHaveAttribute('aria-live', 'polite');

  // 1. Suggestions appear once the (debounced) search response has landed.
  const firstResult = page.getByTestId('search-result-0');
  await expect(firstResult).toBeVisible();
  await expect(firstResult).toContainText('Vaduz');
  await expect(status).toHaveText(/1 Ergebnis/);

  // 3. A11y: focus stays on the input (ARIA 1.2 combobox pattern) even
  // while navigating the list with the keyboard -- the "virtual focus" is
  // communicated via aria-activedescendant, not real DOM focus.
  await expect(input).toBeFocused();
  await input.press('ArrowDown');
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('aria-activedescendant', 'search-option-0');
  await expect(firstResult).toHaveAttribute('aria-selected', 'true');

  // 2. Select the result (mouse/tap) -> map flies there + the EXISTING
  // E03-T3 bottom sheet appears, now with the real name instead of
  // coordinates.
  await firstResult.click();

  await expect(page.getByTestId('destination-sheet')).toBeVisible();
  await expect(page.getByTestId('destination-title')).toHaveText('Vaduz');
  // The coordinates line is still there too (E03-T3 behavior, untouched).
  await expect(page.getByTestId('destination-coords')).toHaveText(/^-?\d+\.\d{5}, -?\d+\.\d{5}$/);

  // The map actually flew to (near) Vaduz's coordinates. Wait for the flight
  // to END (event-driven, see `waitForCameraSettled`) and only then measure --
  // so this is an exact assertion on the final camera, not a race against an
  // rAF-driven animation.
  await waitForCameraSettled(page);
  const distanceToVaduz = await page.evaluate(
    ({ lng, lat }) => {
      const map = window.__yapajaMapController?.getMap();
      if (!map) return null;
      const c = map.getCenter();
      return Math.hypot(c.lng - lng, c.lat - lat);
    },
    { lng: VADUZ_RESULT.latlng.lon, lat: VADUZ_RESULT.latlng.lat },
  );
  expect(distanceToVaduz).not.toBeNull();
  expect(distanceToVaduz ?? Number.POSITIVE_INFINITY).toBeLessThan(0.05);

  // The search field itself resets/closes after a selection.
  await expect(page.getByTestId('search-panel')).not.toBeVisible();

  // 5. Fully offline + no errors.
  expect(tracker.getForeignUrls()).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('0 hits shows a helpful empty state, not a silent blank list', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await mockSearchEndpoint(page);

  await page.goto(SEARCH_CORE_BASE_URL + '/');
  await waitForMapReady(page);

  await fillSearchAndAwaitResponse(page, 'Nirgendwo');

  await expect(page.getByTestId('search-empty')).toBeVisible();
  await expect(page.getByTestId('search-empty')).toContainText('Nichts gefunden');

  expect(pageErrors).toEqual([]);
});

test('backend error is shown cleanly, not as a crash', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await page.route('**/api/v1/search*', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNKNOWN', message: 'boom' } }),
    });
  });

  await page.goto(SEARCH_CORE_BASE_URL + '/');
  await waitForMapReady(page);

  await fillSearchAndAwaitResponse(page, 'Vad');

  await expect(page.getByTestId('search-error')).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('lite-source results show the "vereinfachte Suche aktiv" hint (E05-T5, W-12)', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await page.route('**/api/v1/search*', async (route) => {
    const url = new URL(route.request().url());
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const data: SearchResult[] = q.includes('vad')
      ? [{ ...VADUZ_RESULT, source: 'lite' }]
      : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
  });

  await page.goto(SEARCH_CORE_BASE_URL + '/');
  await waitForMapReady(page);

  await fillSearchAndAwaitResponse(page, 'Vad');

  await expect(page.getByTestId('search-result-0')).toBeVisible();
  await expect(page.getByTestId('search-lite-hint')).toBeVisible();
  await expect(page.getByTestId('search-lite-hint')).toContainText('Vereinfachte Suche aktiv');

  expect(pageErrors).toEqual([]);
});

test('photon-source results do NOT show the lite hint', async ({ page }) => {
  await mockSearchEndpoint(page);

  await page.goto(SEARCH_CORE_BASE_URL + '/');
  await waitForMapReady(page);

  await fillSearchAndAwaitResponse(page, 'Vad');

  // The results ARE on screen (so the negative assertion below can never be
  // vacuously true just because nothing rendered yet), and no lite hint is
  // among them.
  await expect(page.getByTestId('search-result-0')).toBeVisible();
  await expect(page.getByTestId('search-lite-hint')).toHaveCount(0);
});

test('speed-lock (E07-T4): search field collapses to favorites-only quick-select above 10 km/h and expands again once slow', async ({
  page,
}) => {
  const pageErrors = collectPageErrors(page);
  await mockSearchEndpoint(page);

  // Runs against its OWN core (E10-T1): a position fix is broadcast to every
  // page connected to a core, so posting `speed: 5` to the shared search core
  // speed-locked -- and `resetSearch()`-ed -- the sibling search tests running
  // in parallel. See the SEARCH_SPEEDLOCK_CORE_PORT comment in constants.ts.
  await page.goto(SEARCH_SPEEDLOCK_CORE_BASE_URL + '/');
  await waitForMapReady(page);

  const input = page.getByTestId('search-input');
  await expect(input).toBeEnabled();
  await expect(page.getByTestId('search-favorites-quickselect')).toHaveCount(0);

  // 18 km/h (5 m/s) -- above the default 10 km/h threshold: the full search
  // field is replaced ENTIRELY by the favorites-only quick-select (docs/06
  // §4 "nur Favoriten-Schnellwahl"), not merely disabled in place.
  await postPosition(page, { speed: 5 });
  await expect(page.getByTestId('search-favorites-quickselect')).toBeVisible({ timeout: 5_000 });
  await expect(input).toHaveCount(0);
  await expect(page.getByTestId('search-speed-lock-hint')).toBeVisible();
  await expect(page.getByTestId('search-speed-lock-hint')).toContainText('10 km/h');

  // Slow back down -> the full search field reappears, quick-select is gone.
  await postPosition(page, { speed: 0 });
  await expect(page.getByTestId('search-input')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('search-favorites-quickselect')).toHaveCount(0);

  expect(pageErrors).toEqual([]);
});
