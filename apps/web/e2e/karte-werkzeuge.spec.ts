/**
 * 0.22: POI-Chips, Zwischenziel-Pins, Übersicht-Knopf.
 *
 * Gewünscht:
 *  - „Marker … damit die als Chips wie bei Maps in der Kopfzeile sichtbar
 *    sind. Wenn man auf einen Chip klickt … werden nur die POIs der
 *    aktivierten Chips angezeigt."
 *  - „Kannst du die Zwischenziele auch auf der Karte sichtbar machen … Ein
 *    Pin für das Zwischenziel #1, #2 usw."
 *  - „Ein Button, der zwischen aktueller Position und der gesamten Route
 *    wechselt … direkt auf dem Screen."
 */

import { test, expect, type Page } from '@playwright/test';
import type { Route } from '@yapaia/shared';
import { encodePolyline6, type LatLon } from '../../core/src/routing/polyline.js';
import { CORE_BASE_URL } from './support/constants.js';
import { oeffneEinstellung } from './support/einstellungen.js';

test.use({ serviceWorkers: 'block' });

const BASE_LAT = 47.14;
const BASE_LON = 9.52;
const PUNKTE: LatLon[] = Array.from({ length: 11 }, (_, i) => ({ lat: BASE_LAT + i * 0.002, lon: BASE_LON }));
const ROUTE: Route = {
  id: 'werkzeuge-route',
  distance_m: 2200,
  duration_s: 200,
  geometry: encodePolyline6(PUNKTE),
  legs: [{ index: 0, distance_m: 2200, duration_s: 200 }],
  maneuvers: [],
  speed_limits: [],
  warnings: [],
} as unknown as Route;

async function bereit(page: Page): Promise<void> {
  await page.goto(CORE_BASE_URL + '/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapaiaMapController?.getMap?.()?.isStyleLoaded()));
}

test('ein Chip filtert die Karte auf seine Kategorie -- und wieder zurück', async ({ page }) => {
  const stilAbrufe: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/map/styles/')) stilAbrufe.push(r.url());
  });
  await bereit(page);

  await expect(page.getByTestId('poi-chips')).toBeVisible();
  const chip = page.getByTestId('poi-chip-poi-tanken');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');

  // Der neue Stil lässt alles AUSSER Tankstellen weg.
  await expect
    .poll(() => {
      const letzte = stilAbrufe.at(-1) ?? '';
      const aus = new URL(letzte).searchParams.get('poiAus') ?? '';
      return aus.includes('poi-wohnmobil') && !aus.includes('poi-tanken');
    })
    .toBe(true);

  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => new URL(stilAbrufe.at(-1) ?? 'http://x/').searchParams.get('poiAus')).toBeNull();
});

test('das 📌 in den Einstellungen legt fest, welche Chips oben stehen', async ({ page }) => {
  await bereit(page);
  await expect(page.getByTestId('poi-chip-poi-dusche')).toHaveCount(0);

  await oeffneEinstellung(page, 'style-panel-toggle');
  await page.getByTestId('panel-abschnitt-schalter-sonderziele').click();
  await page.getByTestId('poi-chip-markierung-poi-dusche').click();
  await expect(page.getByTestId('poi-chip-poi-dusche')).toBeVisible();

  await page.getByTestId('poi-chip-markierung-poi-dusche').click();
  await expect(page.getByTestId('poi-chip-poi-dusche')).toHaveCount(0);
});

test('Zwischenziele erscheinen als nummerierte Pins', async ({ page }) => {
  await bereit(page);
  await page.evaluate(
    ({ route, wps }) => {
      window.__yapaiaRoutingStore?.setState({
        routes: [route as never],
        activeRouteId: (route as { id: string }).id,
        waypoints: wps as never,
      });
    },
    {
      route: ROUTE,
      wps: [
        { id: 'w1', latlng: PUNKTE[3], name: 'Erster' },
        { id: 'w2', latlng: PUNKTE[7], name: 'Zweiter' },
      ],
    },
  );

  await expect
    .poll(() =>
      page.evaluate(() => {
        const map = window.__yapaiaMapController?.getMap();
        const src = map?.getSource('route-markers-source') as { serialize?: () => { data?: unknown } } | undefined;
        const daten = src?.serialize?.().data as { features?: Array<{ properties: { kind: string; nummer?: number } }> } | undefined;
        return (daten?.features ?? []).filter((f) => f.properties.kind === 'waypoint').map((f) => f.properties.nummer);
      }),
    )
    .toEqual([1, 2]);
  expect(await page.evaluate(() => Boolean(window.__yapaiaMapController?.getMap()?.getLayer('route-waypoint-label')))).toBe(true);
});

test('der Übersicht-Knopf wechselt zwischen ganzer Route und Position', async ({ page }) => {
  await bereit(page);
  // Ohne Route kein Knopf.
  await expect(page.getByTestId('uebersicht-button')).toHaveCount(0);

  await page.evaluate(() => {
    window.__yapaiaPositionStore?.getState().setPosition({
      lat: 47.14, lon: 9.52, alt: null, speed: 0, heading: null, accuracy: 5, source: 'browser', fix: '3d',
      ts: new Date().toISOString(),
    });
  });
  await page.evaluate((route) => {
    window.__yapaiaRoutingStore?.setState({ routes: [route as never], activeRouteId: (route as { id: string }).id });
  }, ROUTE);
  const knopf = page.getByTestId('uebersicht-button');
  await expect(knopf).toBeVisible();

  // Erst weit hineinzoomen, dann Übersicht: die ganze Route muss ins Bild.
  await page.evaluate(() => window.__yapaiaMapController?.getMap()?.jumpTo({ center: [9.52, 47.14], zoom: 18 }));
  await knopf.click();
  await expect(knopf).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const b = window.__yapaiaMapController?.getMap()?.getBounds();
        return b ? b.contains([9.52, 47.14]) && b.contains([9.52, 47.16]) : false;
      }),
      { timeout: 5_000 },
    )
    .toBe(true);
  // Die Übersicht hält -- kein Zurückspringen nach 10 s.
  expect(await page.evaluate(() => window.__yapaiaFollowMeStore?.getState().isPaused)).toBe(true);

  await knopf.click();
  await expect(knopf).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.__yapaiaFollowMeStore?.getState().isPaused)).toBe(false);
});
