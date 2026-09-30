/**
 * Bordhinweise in der App (Idee 4, Stufe 1).
 *
 * Die Antwort des Kerns (`GET /api/v1/bord`) wird hier im Browser ersetzt:
 * der Test-Kern hat kein Home Assistant und damit keine Sensoren. Was der
 * Kern entscheidet, prüft `apps/core/src/bord/bord.test.ts`; hier geht es nur
 * darum, was die Oberfläche daraus macht.
 */

import { test, expect, type Page } from '@playwright/test';
import { CORE_BASE_URL } from './support/constants.js';

const STATION = { name: 'Entsorgung Musterhof', lat: 47.2, lon: 9.6, voraus_m: null, abseits_m: 3200 };

async function bordAntwort(page: Page, hinweise: unknown[]): Promise<void> {
  await page.route('**/api/v1/bord', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { eingerichtet: true, hinweise, stand: new Date().toISOString() } }),
    }),
  );
}

test.describe('Bordhinweis', () => {
  test('zeigt Tank und Station -- und „Später" blendet ihn aus', async ({ page }) => {
    await bordAntwort(page, [{ art: 'grauwasser', wert: 86, text: 'Grauwasser bei 86 %.', station: STATION }]);
    await page.goto(CORE_BASE_URL + '/');

    const hinweis = page.getByTestId('bord-hinweis-grauwasser');
    await expect(hinweis).toContainText('Grauwasser bei 86 %.');
    await expect(page.getByTestId('bord-station-grauwasser')).toHaveText('Entsorgung Musterhof — 3,2 km entfernt');

    await page.getByTestId('bord-spaeter-grauwasser').click();
    await expect(hinweis).toHaveCount(0);
  });

  test('ohne Station gibt es keinen Knopf „Als nächsten Halt"', async ({ page }) => {
    await bordAntwort(page, [
      { art: 'frost', wert: 0.5, text: 'Außen 0,5 °C — Frostschutz für die Wasseranlage prüfen.', station: null },
    ]);
    await page.goto(CORE_BASE_URL + '/');
    await expect(page.getByTestId('bord-hinweis-frost')).toBeVisible();
    await expect(page.getByTestId('bord-halt-frost')).toHaveCount(0);
  });

  test('ohne Hinweise: nichts im Bild', async ({ page }) => {
    await bordAntwort(page, []);
    await page.goto(CORE_BASE_URL + '/');
    await page.waitForFunction(() => Boolean(window.__yapaiaMapController?.getMap?.()));
    await expect(page.getByTestId('bord-hinweise')).toHaveCount(0);
  });
});
