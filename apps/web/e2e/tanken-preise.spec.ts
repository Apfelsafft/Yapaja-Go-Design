/**
 * Spritpreise in der Tankstellensuche (0.42.0, Tankerkönig).
 *
 * Gewünscht: Preis gleich in der Trefferliste, nach Spritsorte des Profils,
 * Farbe nach Aktualität -- und ohne Tankerkönig-Verbindung KEIN Preis.
 *
 * Suche und Preise sind im Browser nachgestellt (wie in `search.spec.ts`):
 * der E2E-Kern hat weder Suchindex noch Tankerkönig-Schlüssel.
 */
import { test, expect, type Page } from '@playwright/test';
import type { SearchResult } from '@yapaia/shared';
import { SEARCH_CORE_BASE_URL } from './support/constants.js';
import { collectPageErrors, trackRequests } from './support/network.js';

const ARAL: SearchResult = {
  name: 'Aral Landau',
  label: 'Aral Landau, Landau',
  latlng: { lat: 49.2, lon: 8.1 },
  type: 'fuel',
  source: 'lite',
  locality: 'Landau',
};
const SHELL: SearchResult = { ...ARAL, name: 'Shell Nord', label: 'Shell Nord', latlng: { lat: 49.2, lon: 8.114 } };
const REWE: SearchResult = { ...ARAL, name: 'REWE', label: 'REWE', type: 'supermarket', latlng: { lat: 49.2, lon: 8.1 } };

async function bereit(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapaiaMapController?.getMap?.()), undefined, { timeout: 15_000 });
}

async function sucheNachgestellt(page: Page): Promise<void> {
  await page.route('**/api/v1/search*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [ARAL, SHELL, REWE] }) }),
  );
}

async function spritsorte(page: Page, sorte: string | null): Promise<void> {
  await page.evaluate((s) => {
    const store = window.__yapaiaProfileStore!;
    const p = store.getState().activeProfile ?? ({ id: 'e2e', name: 'E2E' } as never);
    store.setState({ activeProfile: { ...p, fuel_type: s } as never });
  }, sorte);
}

async function suche(page: Page): Promise<void> {
  const antwort = page.waitForResponse((r) => r.url().includes('/api/v1/search'), { timeout: 15_000 });
  await page.getByTestId('search-input').fill('Tankstelle');
  await antwort;
  await expect(page.getByTestId('search-result-0')).toBeVisible();
}

test('Diesel-Profil: Preis an der Tankstelle, grün wenn frisch; Supermarkt ohne Preis', async ({ page }) => {
  const tracker = await trackRequests(page, SEARCH_CORE_BASE_URL);
  const fehler = collectPageErrors(page);
  await sucheNachgestellt(page);
  const preisRufe: string[] = [];
  await page.route('**/api/v1/tanken/preise*', (route) => {
    preisRufe.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          abgerufen: new Date().toISOString(),
          stationen: [
            { id: 'a', name: 'Aral', marke: 'ARAL', lat: 49.2003, lon: 8.1002, diesel: 1.659, e5: 1.799, e10: 1.739, offen: true },
            { id: 's', name: 'Shell', marke: 'Shell', lat: 49.2, lon: 8.114, diesel: 1.689, e5: 1.819, e10: 1.759, offen: false },
          ],
        },
      }),
    });
  });

  await page.goto(SEARCH_CORE_BASE_URL + '/');
  await bereit(page);
  await spritsorte(page, 'diesel');
  await suche(page);

  const zeilen = page.getByTestId('search-results');
  const preisIn = (name: string) =>
    zeilen.getByRole('option').filter({ hasText: name }).getByTestId(/search-result-preis-/);
  const aral = preisIn('Aral Landau');
  await expect(aral).toHaveText('Diesel 1,65⁹ €');
  await expect(aral).toHaveAttribute('data-frische', 'frisch');
  await expect(preisIn('Shell Nord')).toHaveAttribute('data-frische', 'zu');
  await expect(preisIn('REWE')).toHaveCount(0);
  // Nur zwei Preise: der REWE bekommt keinen.
  await expect(zeilen.getByTestId(/search-result-preis-/)).toHaveCount(2);
  // Beide Tankstellen liegen in derselben Gegend: EINE Abfrage.
  expect(preisRufe).toHaveLength(1);
  await page.screenshot({ path: 'test-results/tanken-preise-diesel.png' });

  // Benzin: E5 und E10.
  await spritsorte(page, 'benzin');
  await expect(aral).toHaveText('E5 1,79⁹ · E10 1,73⁹ €');

  // Strom: Tankerkönig kennt keinen Preis -- nichts.
  await spritsorte(page, 'elektro');
  await expect(zeilen.getByTestId(/search-result-preis-/)).toHaveCount(0);

  expect(tracker.getForeignUrls()).toEqual([]);
  expect(fehler).toEqual([]);
});

test('ohne Tankerkönig-Verbindung (409 vom Kern): kein Preis, keine Meldung', async ({ page }) => {
  await sucheNachgestellt(page);
  // Kein Mock für /tanken/preise: der echte E2E-Kern hat Online aus und
  // keinen Schlüssel und antwortet 409.
  const antwort = page.waitForResponse((r) => r.url().includes('/api/v1/tanken/preise'), { timeout: 15_000 });
  await page.goto(SEARCH_CORE_BASE_URL + '/');
  await bereit(page);
  await spritsorte(page, 'diesel');
  await suche(page);
  expect((await antwort).status()).toBe(409);
  await expect(page.getByTestId('search-result-0')).toContainText('Aral Landau');
  await expect(page.getByTestId('search-results').getByTestId(/search-result-preis-/)).toHaveCount(0);
});
