/**
 * 0.24: Pins antippbar, Ortskarte mit Route, Favorit und Online-Infos.
 *
 * Gewünscht: „Das meiste passiert, wenn man auf Suche klickt oder einen Pin
 * auf der Karte … Wenn man ein Ziel ausgewählt hat, kann man die Route
 * suchen … Oder auch nur die Infos (Internet vorausgesetzt) … lesen."
 *
 * Der Pin wird direkt in die Sonderziel-Quelle gelegt: so hängt der Test
 * nicht davon ab, welche POIs die Testkachel bei welcher Zoomstufe zeigt.
 */

import { test, expect, type Page } from '@playwright/test';
import { CORE_BASE_URL } from './support/constants.js';

test.use({ serviceWorkers: 'block' });

const PIN = { lat: 47.141, lon: 9.521 };
// 1×1 PNG -- der Kern liefert Bilder als data:-Adressen (CSP: img-src data:).
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function bereitMitPin(page: Page): Promise<{ x: number; y: number }> {
  await page.goto(CORE_BASE_URL + '/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapaiaMapController?.getMap?.()?.isStyleLoaded()));

  // Den Pin legen, bis er gezeichnet ist (der eigene Abruf der Sonderziele
  // könnte die Quelle kurz danach noch einmal überschreiben).
  await expect
    .poll(
      () =>
        page.evaluate((pin) => {
          const map = window.__yapaiaMapController!.getMap()!;
          map.jumpTo({ center: [pin.lon, pin.lat], zoom: 15 });
          const quelle = map.getSource('yapaja-sonderziele') as unknown as { setData: (d: unknown) => void } | undefined;
          if (!quelle) return 0;
          quelle.setData({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [pin.lon, pin.lat] },
                properties: {
                  name: 'Stellplatz am Rhein',
                  kategorie: 'caravan_site',
                  bezeichnung: 'Wohnmobilstellplatz',
                  symbol: 'poi-wohnmobil',
                  rang: 1,
                  ort: 'Vaduz',
                },
              },
            ],
          });
          const p = map.project([pin.lon, pin.lat]);
          return map.queryRenderedFeatures([p.x, p.y], { layers: ['yapaja-sonderziele-marken'] }).length;
        }, PIN),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);

  return page.evaluate((pin) => {
    const map = window.__yapaiaMapController!.getMap()!;
    const p = map.project([pin.lon, pin.lat]);
    const r = map.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, PIN);
}

test('Tipp auf einen Pin zeigt die Ortskarte mit Online-Infos; Route setzt das Ziel', async ({ page }) => {
  const anfragen: unknown[] = [];
  await page.route('**/api/v1/online/ort', async (route) => {
    anfragen.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          osm: {
            website: 'stellplatz.example',
            telefon: '+423 123 45 67',
            oeffnungszeiten: 'Mo-So 08:00-20:00',
            merkmale: ['Strom', 'Frischwasser'],
          },
          wikipedia: { titel: 'Vaduz', auszug: 'Vaduz ist der Hauptort.', url: 'https://de.wikipedia.org/wiki/Vaduz' },
          bilder: [{ daten: PNG, quelle: 'https://commons.wikimedia.org/wiki/File:X.jpg', art: 'umgebung' }],
        },
      }),
    });
  });

  const pin = await bereitMitPin(page);
  await page.mouse.click(pin.x, pin.y);

  const karte = page.getByTestId('ort-karte');
  await expect(karte).toBeVisible();
  await expect(page.getByTestId('ort-name')).toHaveText('Stellplatz am Rhein');
  await expect(page.getByTestId('ort-kategorie')).toHaveText('Wohnmobilstellplatz');
  await expect(page.getByTestId('ort-osm')).toContainText('Mo-So 08:00-20:00');
  await expect(page.getByTestId('ort-osm').getByRole('link', { name: 'stellplatz.example' })).toHaveAttribute(
    'href',
    'https://stellplatz.example/',
  );
  await expect(page.getByTestId('ort-merkmale')).toContainText('Strom');
  await expect(page.getByTestId('ort-wikipedia')).toContainText('Vaduz ist der Hauptort.');
  await expect(page.getByTestId('ort-bilder').locator('img')).toHaveCount(1);
  await expect(page.getByTestId('ort-bilder')).toContainText('in der Nähe');
  expect(anfragen[0]).toMatchObject({ name: 'Stellplatz am Rhein' });

  // Die Karte liegt im Seitenpanel und innerhalb des sichtbaren Bereichs.
  const kasten = await karte.boundingBox();
  const fenster = page.viewportSize()!;
  expect(kasten!.x).toBeGreaterThanOrEqual(0);
  expect(kasten!.x + kasten!.width).toBeLessThanOrEqual(fenster.width);

  await page.getByTestId('ort-route').click();
  await expect(karte).toHaveCount(0);
  const ziel = await page.evaluate(() => {
    const s = window.__yapaiaRoutingStore!.getState();
    return { ziel: s.destination, name: s.destinationName };
  });
  expect(ziel.name).toBe('Stellplatz am Rhein');
  expect(ziel.ziel!.lat).toBeCloseTo(PIN.lat, 4);
  expect(ziel.ziel!.lon).toBeCloseTo(PIN.lon, 4);
});

test('ohne Online-Teil sagt die Karte, wie es mehr Infos gibt; Tipp ins Leere schließt sie', async ({ page }) => {
  await page.route('**/api/v1/online/ort', (route) =>
    route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":{"code":"ONLINE_DISABLED"}}' }),
  );
  const pin = await bereitMitPin(page);
  await page.mouse.click(pin.x, pin.y);
  await expect(page.getByTestId('ort-karte')).toBeVisible();
  await expect(page.getByTestId('ort-online-aus')).toBeVisible();

  // Weit weg vom Pin, aber noch auf der Karte (Seite gegenüber dem Panel).
  const fenster = page.viewportSize()!;
  await page.mouse.click(fenster.width - 120, fenster.height - 160);
  await expect(page.getByTestId('ort-karte')).toHaveCount(0);
  // Kein Ziel gesetzt -- ein Tipper ist kein langer Druck.
  expect(await page.evaluate(() => window.__yapaiaRoutingStore!.getState().destination)).toBeNull();
});
