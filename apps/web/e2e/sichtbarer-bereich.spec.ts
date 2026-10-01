/**
 * Die Oberfläche bleibt im sichtbaren Teil -- auch wenn der Rahmen, in dem
 * Home Assistant Yapaia zeigt, über den Bildschirm hinausragt.
 *
 * Gemeldet (iPad, Home Assistant): Kopfzeile oben halb weg, Zoom-Knopf weg,
 * Zahnrad unten angeschnitten. „Kannst du bitte die Anzeige so bauen, dass
 * sie immer in den verfügbaren Platz passt?"
 *
 * Nachgebaut wird genau das: eine Hülle unter DERSELBEN Adresse (wie die
 * Ingress-Seite von Home Assistant), darin ein Rahmen, der 150 px höher ist
 * als der Bildschirm, und die Hülle ist 60 px nach unten gescrollt. Oben
 * fehlen dann 60 px, unten 90 px.
 */

import { test, expect, type Frame } from '@playwright/test';
import { CORE_BASE_URL } from './support/constants.js';

test.use({ viewport: { width: 1000, height: 700 }, serviceWorkers: 'block' });

const RAHMEN_HOEHE = 850;
const GESCROLLT = 60;

async function sichtbarImRahmen(frame: Frame, selector: string) {
  return frame.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { oben: r.top, unten: r.bottom };
  });
}

test('Kopfzeile und untere Knöpfe liegen im sichtbaren Teil des Rahmens', async ({ page }) => {
  const huelle = `${CORE_BASE_URL}/__test-huelle.html`;
  await page.route(huelle, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body style="margin:0">
        <iframe id="r" src="${CORE_BASE_URL}/" style="display:block;border:0;width:100%;height:${RAHMEN_HOEHE}px"></iframe>
        <div style="height:400px"></div>
      </body></html>`,
    }),
  );
  await page.goto(huelle);
  await page.evaluate((y) => window.scrollTo(0, y), GESCROLLT);

  const frame = page.frameLocator('#r');
  await expect(frame.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  const f = page.frame({ url: /\/$/ })!;

  // Verdeckt sind oben 60 px und unten 850 - 60 - 700 = 90 px.
  const verdecktUnten = RAHMEN_HOEHE - GESCROLLT - 700;
  await expect
    .poll(() => f.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sicht-oben').trim()))
    .toBe(`${GESCROLLT}px`);
  await expect
    .poll(() => f.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sicht-unten').trim()))
    .toBe(`${verdecktUnten}px`);

  const kopf = await sichtbarImRahmen(f, '[data-testid="top-bar"]');
  expect(kopf.oben).toBeGreaterThanOrEqual(GESCROLLT);

  const zahnrad = await sichtbarImRahmen(f, '[data-testid="style-panel-toggle"]');
  expect(zahnrad.unten).toBeLessThanOrEqual(RAHMEN_HOEHE - verdecktUnten);

  // Scrollt die Hülle zurück, folgt die Oberfläche.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect
    .poll(() => f.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sicht-oben').trim()))
    .toBe('0px');
});

test('direkt im Browser bleibt alles, wie es war', async ({ page }) => {
  await page.goto(CORE_BASE_URL + '/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  const kasten = await page.locator('#yapaia-sicht').evaluate((el) => el.getBoundingClientRect().toJSON());
  expect(kasten).toMatchObject({ top: 0, left: 0, width: 1000, height: 700 });
});
