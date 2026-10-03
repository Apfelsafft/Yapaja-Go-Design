/**
 * 0.28: Bildschirm anpassen -- Elemente verschieben und vergrößern.
 *
 * Gewünscht: „… eine Funktion, in der der User sich die Screens (Ruhemodus,
 * Navigation usw.) selber konfigurieren kann? Also er kann die einzelnen
 * Objekte an gewünschte Stellen auf dem Screen verschieben und vielleicht
 * auch in der Größe ändern."
 */

import { test, expect, type Page } from '@playwright/test';
import { ANKER_CORE_BASE_URL, CORE_BASE_URL } from './support/constants.js';
import { oeffneEinstellung } from './support/einstellungen.js';

test.use({ serviceWorkers: 'block' });

async function bereit(page: Page, basis = CORE_BASE_URL): Promise<void> {
  await page.goto(basis + '/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => localStorage.removeItem('yapaja.anordnung'));
  await page.reload();
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
}

async function ziehe(page: Page, testId: string, dx: number, dy: number): Promise<void> {
  const box = (await page.getByTestId(testId).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

test('ein Knopf lässt sich verschieben und vergrößern, bleibt nach dem Neuladen und lässt sich zurücksetzen', async ({
  page,
}) => {
  await bereit(page);
  const knopf = page.getByTestId('viewmode-button');
  const vorher = (await knopf.boundingBox())!;

  await oeffneEinstellung(page, 'anordnung-starten');
  await expect(page.getByTestId('anordnung-leiste')).toBeVisible();
  await expect(page.getByTestId('einstellungen-menue')).toHaveCount(0);

  // 0.37: Die Leiste lässt sich wegziehen -- sie lag über Suche und Chips.
  const leisteVorher = (await page.getByTestId('anordnung-leiste').boundingBox())!;
  await ziehe(page, 'anordnung-leiste-griff', 0, 300);
  const leisteNachher = (await page.getByTestId('anordnung-leiste').boundingBox())!;
  expect(leisteNachher.y - leisteVorher.y).toBeGreaterThan(250);

  // Verschieben: 150 nach links/rechts zur Mitte hin, 100 nach oben.
  const richtung = vorher.x > page.viewportSize()!.width / 2 ? -1 : 1;
  await ziehe(page, 'anordnung-griff-ansicht', 150 * richtung, -100);
  const nachher = (await knopf.boundingBox())!;
  expect(Math.round((nachher.x - vorher.x) * richtung)).toBeGreaterThan(130);
  expect(Math.round(vorher.y - nachher.y)).toBeGreaterThan(80);

  // Vergrößern über den Punkt an der Ecke.
  await ziehe(page, 'anordnung-groesse-ansicht', 100, 100);
  const gross = (await knopf.boundingBox())!;
  expect(gross.width).toBeGreaterThan(nachher.width * 1.2);

  await page.getByTestId('anordnung-fertig').click();
  await expect(page.getByTestId('anordnung-leiste')).toHaveCount(0);
  await expect(page.getByTestId('anordnung-griff-ansicht')).toHaveCount(0);

  // Nach dem Neuladen noch da.
  await page.reload();
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  const gespeichert = (await knopf.boundingBox())!;
  expect(Math.abs(gespeichert.x - gross.x)).toBeLessThan(3);
  expect(Math.abs(gespeichert.width - gross.width)).toBeLessThan(3);

  // Zurücksetzen bringt den Standardplatz zurück.
  await oeffneEinstellung(page, 'anordnung-starten');
  await page.getByTestId('anordnung-zuruecksetzen').click();
  await page.getByTestId('anordnung-fertig').click();
  const zurueck = (await knopf.boundingBox())!;
  expect(Math.abs(zurueck.x - vorher.x)).toBeLessThan(3);
  expect(Math.abs(zurueck.width - vorher.width)).toBeLessThan(3);
});

test('ein weit hinausgeschobenes Element bleibt im sichtbaren Bereich', async ({ page }) => {
  await bereit(page);
  await page.evaluate(() => {
    localStorage.setItem('yapaja.anordnung', JSON.stringify({ ruhe: { ansicht: { dx: 5000, dy: -5000, s: 1 } }, fahrt: {} }));
  });
  await page.reload();
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  const box = (await page.getByTestId('viewmode-button').boundingBox())!;
  const fenster = page.viewportSize()!;
  expect(box.x).toBeLessThan(fenster.width);
  expect(box.x + box.width).toBeGreaterThan(0);
  expect(box.y).toBeLessThan(fenster.height);
  expect(box.y + box.height).toBeGreaterThan(0);
});

test('0.36: beim ersten Laden heran an die Position; im Anpassen lässt sich die Position verschieben', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['geolocation']);
  // Innerhalb der Fixture-Region [5,8–15,1 °O, 47,2–55,1 °N] -- außerhalb
  // bleibt die Übersicht (gewollt, `MapView`).
  await context.setGeolocation({ latitude: 50.0, longitude: 8.27, accuracy: 10 });
  // Eigener Core: eine Position in der Region liesse sonst alle anderen
  // Specs am gemeinsamen Core beim Laden heranzoomen (ANKER_CORE_PORT).
  await bereit(page, ANKER_CORE_BASE_URL);
  await page.waitForFunction(() => Boolean(window.__yapaiaMapController?.getMap?.()), undefined, { timeout: 15_000 });

  // Wie „Zentrieren": mindestens Stufe 15 statt der ganzen Region.
  await expect
    .poll(() => page.evaluate(() => window.__yapaiaMapController!.getMap()!.getZoom()), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(14.9);

  const raender = () => page.evaluate(() => window.__yapaiaMapController!.getMap()!.getPadding());
  expect(await raender()).toMatchObject({ top: 0, bottom: 0, left: 0, right: 0 });

  await oeffneEinstellung(page, 'anordnung-starten');
  await expect(page.getByTestId('anordnung-anker')).toBeVisible();
  // Nach links unten ziehen: Ränder oben und rechts schieben die Mitte dorthin.
  await ziehe(page, 'anordnung-anker', -200, 150);
  await expect.poll(async () => (await raender()).top).toBeGreaterThan(100);
  expect((await raender()).right).toBeGreaterThan(100);
  expect((await raender()).bottom).toBe(0);
  await page.getByTestId('anordnung-fertig').click();
  await expect(page.getByTestId('anordnung-anker')).toHaveCount(0);

  // Bleibt nach dem Neuladen; Zurücksetzen holt die Mitte zurück.
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__yapaiaMapController?.getMap?.()), undefined, { timeout: 15_000 });
  await expect.poll(async () => (await raender()).top).toBeGreaterThan(100);
  await oeffneEinstellung(page, 'anordnung-starten');
  await page.getByTestId('anordnung-zuruecksetzen').click();
  await expect.poll(async () => (await raender()).top).toBe(0);
  expect(await raender()).toMatchObject({ bottom: 0, left: 0, right: 0 });
});
