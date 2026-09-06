/**
 * Eine laengere Testfahrt -- und was dabei kaputtgeht.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Und das schlimmste, nach kurzer Zeit verschwindet die gesamte Anzeige und
 * man sieht nur noch einen blanken Screen. Nur die HA Menüs sind noch da, die
 * Yapaja Oberfläche ist weg. Wenn ich auf ein anderes HA Menü wechsle und dann
 * wieder zurück zu Yapaja ist alles wieder da und ich werde gefragt ob ich die
 * Navigation fortsetzen möchte. Bei Bestätigung wird weiter navigiert aber die
 * blaue Streckenlinie fehlt jetzt."
 *
 * ─── WAS DIESE BESCHREIBUNG SCHON VERRAET ───────────────────────────────────
 * Die Oberflaeche ist nicht haengen geblieben, sie wurde ABGERAEUMT: die
 * HA-Menues aussen herum leben weiter, und ein Neuladen heilt alles. Genau das
 * tut React 18, wenn ein Fehler beim Zeichnen nach oben durchschlaegt und ihn
 * niemand auffaengt -- der ganze Baum wird entfernt. Eine Fehlergrenze gibt es
 * in dieser Anwendung nirgends.
 *
 * ─── WARUM DIESER TEST SO LANGE FAEHRT ──────────────────────────────────────
 * „Nach kurzer Zeit" heisst: nicht sofort. Ein Test, der zwei Positionen
 * schickt, saehe nichts. Hier laeuft eine echte Wiedergabe im Zeitraffer ueber
 * viele simulierte Sekunden, und jede Ausnahme im Browser wird eingesammelt.
 */

import { test, expect, type Page } from '@playwright/test';
import { SIMULATOR_UI_CORE_BASE_URL, SIMULATOR_UI_VALHALLA_PORT } from './support/constants.js';
import { startValhallaStub, type ValhallaStub } from './support/valhallaStub.js';
import { collectPageErrors } from './support/network.js';
import type { LatLon } from '../../core/src/routing/polyline.js';

const BASE_LAT = 47.4;
const BASE_LON = 9.7;
const M_PER_DEG_LAT = 111_195;

/** 60 Punkte, ~111 m auseinander -- lang genug fuer eine laengere Fahrt. */
const POINTS: LatLon[] = Array.from({ length: 60 }, (_, i) => ({
  lat: BASE_LAT + (i * (M_PER_DEG_LAT * 0.001)) / M_PER_DEG_LAT,
  lon: BASE_LON,
}));

let valhallaStub: ValhallaStub;

test.beforeAll(async () => {
  valhallaStub = await startValhallaStub(SIMULATOR_UI_VALHALLA_PORT);
});

test.afterAll(async () => {
  await valhallaStub.close();
});

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapajaMapController?.getMap?.()), undefined, {
    timeout: 15_000,
  });
}

async function planeUndFahre(page: Page): Promise<string> {
  await page.request.post(`${SIMULATOR_UI_CORE_BASE_URL}/api/v1/position/browser`, {
    data: {
      lat: POINTS[0].lat,
      lon: POINTS[0].lon,
      alt: null,
      speed: 0,
      heading: 0,
      accuracy: 5,
      fix: '3d',
      ts: new Date().toISOString(),
    },
  });

  const profileId = await page.request
    .get(`${SIMULATOR_UI_CORE_BASE_URL}/api/v1/profiles`)
    .then(async (r) => {
      const data = ((await r.json()) as { data: Array<{ id: string; is_active?: boolean }> }).data;
      return (data.find((p) => p.is_active) ?? data[0]).id;
    });

  const res = await page.request.post(`${SIMULATOR_UI_CORE_BASE_URL}/api/v1/routes`, {
    data: {
      origin: { lat: POINTS[0].lat, lon: POINTS[0].lon },
      destination: { lat: POINTS[59].lat, lon: POINTS[59].lon },
      waypoints: [],
      profile_id: profileId,
      alternatives: 0,
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const route = ((await res.json()) as { data: Array<{ id: string }> }).data[0];

  await page.evaluate((r) => {
    window.__yapajaRoutingStore?.setState({ routes: [r] as never, activeRouteId: (r as { id: string }).id });
  }, route as never);

  const start = await page.request.post(`${SIMULATOR_UI_CORE_BASE_URL}/api/v1/navigation/start`, {
    data: { route, destination: { latlng: POINTS[59], name: 'Ziel' } },
  });
  expect(start.ok(), await start.text()).toBe(true);

  return route.id;
}

test.describe('Eine laengere Testfahrt', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    // 59 Abschnitte a ~111,195 m = ~6,56 km. Die angegebene Laenge muss
    // mindestens der Luftlinie entsprechen, sonst lehnt die
    // Plausibilitaetspruefung die Route zu Recht ab (fail closed).
    valhallaStub.setNextTrip({ points: POINTS, lengthKm: 6.6, timeS: 400 });
    valhallaStub.setTraceAttributesEdges([
      { begin_shape_index: 0, end_shape_index: 59, speed_limit: 50 },
    ]);
    await page.request
      .post(`${SIMULATOR_UI_CORE_BASE_URL}/api/v1/simulator/stop`)
      .catch(() => {});
    await page.request
      .post(`${SIMULATOR_UI_CORE_BASE_URL}/api/v1/navigation/stop`)
      .catch(() => {});
  });

  test('die Oberflaeche ueberlebt sie -- kein blanker Bildschirm', async ({ page }) => {
    test.setTimeout(120_000);
    const pageErrors = collectPageErrors(page);
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(SIMULATOR_UI_CORE_BASE_URL + '/');
    await waitForMapReady(page);
    const routeId = await planeUndFahre(page);

    // Im Zeitraffer abfahren -- 32x, damit viele simulierte Sekunden in
    // wenige echte passen.
    const play = await page.request.post(`${SIMULATOR_UI_CORE_BASE_URL}/api/v1/simulator/play`, {
      data: { track: { routeId }, speed_factor: 32 },
    });
    expect(play.ok(), await play.text()).toBe(true);

    // Eine ganze Weile fahren lassen.
    await expect
      .poll(
        async () =>
          page.request
            .get(`${SIMULATOR_UI_CORE_BASE_URL}/api/v1/simulator/status`)
            .then(async (r) => ((await r.json()) as { data: { tickS: number } }).data.tickS),
        { timeout: 60_000, intervals: [1000] },
      )
      .toBeGreaterThan(120);

    // ─── DIE OBERFLAECHE MUSS NOCH DA SEIN ──────────────────────────────────
    // Der blanke Bildschirm ist ein abgeraeumter React-Baum: die Karte selbst
    // waere dann weg, nicht nur unsichtbar.
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
    await expect(page.getByTestId('map-container')).toBeVisible();

    expect(pageErrors, 'keine Ausnahme im Browser waehrend der Fahrt').toEqual([]);
    expect(consoleErrors, 'keine Fehlermeldung in der Konsole').toEqual([]);
  });
});
