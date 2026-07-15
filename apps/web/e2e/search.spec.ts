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
import { SEARCH_CORE_BASE_URL } from './support/constants.js';
import { collectPageErrors, trackRequests } from './support/network.js';

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapajaMapController?.getMap?.()), undefined, {
    timeout: 15_000,
  });
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
  const response = await page.request.post(`${SEARCH_CORE_BASE_URL}/api/v1/position/browser`, {
    data: browserFixBody(overrides),
  });
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
  await input.fill('Vad');

  // aria-live status region exists and is wired up correctly (present in
  // the DOM regardless of visibility -- it's `sr-only`, not `display:none`).
  const status = page.getByTestId('search-status');
  await expect(status).toHaveAttribute('aria-live', 'polite');

  // 1. Suggestions appear (debounced 300ms + mocked network -- comfortably
  // under the "< 500ms" acceptance bound once the debounce elapses).
  const firstResult = page.getByTestId('search-result-0');
  await expect(firstResult).toBeVisible({ timeout: 2_000 });
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

  // The map actually flew to (near) Vaduz's coordinates -- a plain distance
  // check rather than relying on a specific asymmetric-matcher API.
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ lng, lat }) => {
            const map = window.__yapajaMapController?.getMap();
            if (!map) return null;
            const c = map.getCenter();
            return Math.hypot(c.lng - lng, c.lat - lat);
          },
          { lng: VADUZ_RESULT.latlng.lon, lat: VADUZ_RESULT.latlng.lat },
        ),
      { timeout: 5_000 },
    )
    .toBeLessThan(0.05);

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

  await page.getByTestId('search-input').fill('Nirgendwo');

  await expect(page.getByTestId('search-empty')).toBeVisible({ timeout: 2_000 });
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

  await page.getByTestId('search-input').fill('Vad');

  await expect(page.getByTestId('search-error')).toBeVisible({ timeout: 2_000 });

  expect(pageErrors).toEqual([]);
});

test('speed-lock: search field disables above 10 km/h and re-enables once slow again', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await mockSearchEndpoint(page);

  await page.goto(SEARCH_CORE_BASE_URL + '/');
  await waitForMapReady(page);

  const input = page.getByTestId('search-input');
  await expect(input).toBeEnabled();

  // 18 km/h (5 m/s) -- above the fixed 10 km/h threshold.
  await postPosition(page, { speed: 5 });
  await expect(input).toBeDisabled({ timeout: 5_000 });
  await expect(page.getByTestId('search-speed-lock-hint')).toBeVisible();
  await expect(page.getByTestId('search-speed-lock-hint')).toContainText('10 km/h');

  // Slow back down -> re-enabled.
  await postPosition(page, { speed: 0 });
  await expect(input).toBeEnabled({ timeout: 5_000 });
  await expect(page.getByTestId('search-speed-lock-hint')).not.toBeVisible();

  expect(pageErrors).toEqual([]);
});
