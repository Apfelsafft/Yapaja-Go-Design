/**
 * Der Testfahrer, von der Bedienung bis zur bewegten Position.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Bitte fuege einen gps Simulator ein, der die gewaehlte route dann zum test
 * abfaehrt. Die jeweilige fahr Geschwindigkeit sollte der entsprechenden
 * Hoechstgeschwindigkeit entsprechen. Und es sollte eine Art fast forward
 * geben um die benoetigte Zeit zu verkuerzen. (2x, 4x, 8x, 16x, 32x und
 * zurueck) eventuell als schieberegler."
 *
 * ─── WARUM DIESER TEST EXISTIERT ────────────────────────────────────────────
 * Der Wiedergabe-Motor gab es laengst (E02-T4), samt Zeitraffer und
 * Abschnitts-Tempi. Er war nur von nirgendwo aus erreichbar: kein Knopf im
 * Browser, keine Ableitung aus den Tempolimits der Route -- und im Add-on
 * antwortete er auf jede Anfrage mit 403. Drei Luecken, jede fuer sich
 * unauffaellig, zusammen eine Funktion, die es auf dem Papier gab und in
 * Wirklichkeit nicht.
 *
 * Die REGELN stehen in Unit-Tests (`simulator/controls.test.ts`,
 * `routeProfile.test.ts`, `setSpeedFactor.test.ts`). Hier wird die KETTE
 * geprueft: Route planen -> Knopf druecken -> Position bewegt sich wirklich.
 *
 * ─── WARUM EIN EIGENER CORE MIT STUB-VALHALLA ───────────────────────────────
 * Der Simulator schlaegt die Route ueber ihre Kennung im Routen-
 * Zwischenspeicher DES SERVERS nach. Ein im Browser abgefangenes
 * `POST /routes` (wie in den meisten Specs hier) fuellt den nicht -- die
 * Route muss wirklich durch `RoutingService` gelaufen sein.
 */

import { test, expect, type Page } from '@playwright/test';
import { SIMULATOR_UI_CORE_BASE_URL, SIMULATOR_UI_VALHALLA_PORT } from './support/constants.js';
import { startValhallaStub, type ValhallaStub } from './support/valhallaStub.js';
import type { LatLon } from '../../core/src/routing/polyline.js';

const BASE_LAT = 47.4;
const BASE_LON = 9.7;
const M_PER_DEG_LAT = 111_195;

/** Elf Punkte, ~111 m auseinander, schnurgerade nach Norden (~1112 m). */
const POINTS: LatLon[] = Array.from({ length: 11 }, (_, i) => ({
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

/**
 * Plant eine echte Route ueber den Core und traegt sie in den Routen-Speicher
 * des Browsers ein. Liefert die Routen-Kennung.
 */
async function planRoute(page: Page): Promise<string> {
  // Das aktive Fahrzeugprofil -- `profile_id` ist Pflicht in `RouteRequest`.
  const profiles = await page.request
    .get(`${SIMULATOR_UI_CORE_BASE_URL}/api/v1/profiles`)
    .then(async (r) => ((await r.json()) as { data: Array<{ id: string; is_active?: boolean }> }).data);
  const profileId = (profiles.find((p) => p.is_active) ?? profiles[0]).id;

  const response = await page.request.post(`${SIMULATOR_UI_CORE_BASE_URL}/api/v1/routes`, {
    data: {
      origin: { lat: POINTS[0].lat, lon: POINTS[0].lon },
      destination: { lat: POINTS[10].lat, lon: POINTS[10].lon },
      waypoints: [],
      profile_id: profileId,
      alternatives: 0,
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const body = (await response.json()) as { data: Array<{ id: string }> };
  const routes = body.data;
  expect(routes.length).toBeGreaterThan(0);

  // Der Browser kennt diese Route noch nicht -- sie wurde per REST geplant,
  // nicht ueber „Route hierhin". Derselbe Kunstgriff wie in drive.spec.ts.
  await page.evaluate((routeData) => {
    window.__yapajaRoutingStore?.setState({
      routes: routeData as never,
      activeRouteId: (routeData as Array<{ id: string }>)[0].id,
    });
  }, routes as never);

  return routes[0].id;
}

async function openPanel(page: Page): Promise<void> {
  await expect(page.getByTestId('simulator-panel-toggle')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('simulator-panel-toggle').click();
  await expect(page.getByTestId('simulator-panel')).toBeVisible();
}

/** Die aktuell im Browser bekannte Position (oder `null`). */
async function currentLat(page: Page): Promise<number | null> {
  return page.evaluate(() => window.__yapajaPositionStore?.getState().position?.lat ?? null);
}

test.describe('Der Testfahrer', () => {
  test.describe.configure({ mode: 'serial' }); // ein Core, eine Wiedergabe

  test.beforeEach(() => {
    valhallaStub.setNextTrip({ points: POINTS, lengthKm: 1.112, timeS: 90 });
    // Tempolimits fuer die ganze Strecke -- damit die Fahrt mit ECHTEN
    // Limits laeuft und nicht mit dem Ersatztempo.
    valhallaStub.setTraceAttributesEdges([
      { begin_shape_index: 0, end_shape_index: 10, speed_limit: 60 },
    ]);
  });

  test.afterEach(async ({ page }) => {
    await page
      .request.post(`${SIMULATOR_UI_CORE_BASE_URL}/api/v1/simulator/stop`)
      .catch(() => {
        // Aufraeumen nach bestem Vermoegen.
      });
  });

  test('faehrt die geplante Route ab und bewegt die Position wirklich', async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto(SIMULATOR_UI_CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await planRoute(page);
    await openPanel(page);

    const vorher = await currentLat(page);

    // ─── DIE KETTE ──────────────────────────────────────────────────────────
    // Zeitraffer hoch, damit der Test nicht in Echtzeit warten muss -- genau
    // der Zweck, den der Betreiber genannt hat.
    await page.getByTestId('simulator-play').click();
    await expect(page.getByTestId('simulator-track')).toBeVisible({ timeout: 10_000 });

    // Die Strecke ist als abgefahrene ROUTE erkennbar, samt der Angabe, wie
    // viele Abschnitte ohne bekanntes Limit gefahren werden. Hier: keiner --
    // der Stub liefert Limits fuer die ganze Strecke.
    await expect(page.getByTestId('simulator-track')).toContainText('route:');
    await expect(page.getByTestId('simulator-track')).toContainText('0/10');

    // Und jetzt der eigentliche Beweis: die Position bewegt sich.
    await expect
      .poll(() => currentLat(page), { timeout: 20_000 })
      .not.toBe(vorher);
    const unterwegs = await currentLat(page);
    expect(unterwegs).not.toBeNull();
    expect(unterwegs!).toBeGreaterThan(POINTS[0].lat - 1e-6);
  });

  test('Pause haelt an, Weiter macht weiter, Stopp beendet', async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto(SIMULATOR_UI_CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await planRoute(page);
    await openPanel(page);

    await page.getByTestId('simulator-play').click();
    await expect(page.getByTestId('simulator-track')).toBeVisible({ timeout: 10_000 });

    // Pause: der „Weiter"-Knopf tritt an die Stelle des Pause-Knopfes.
    await page.getByTestId('simulator-pause').click();
    await expect(page.getByTestId('simulator-resume')).toBeVisible({ timeout: 5_000 });

    // Die simulierte Zeit steht wirklich still -- nicht nur die Beschriftung.
    const stand = await page.request
      .get(`${SIMULATOR_UI_CORE_BASE_URL}/api/v1/simulator/status`)
      .then(async (r) => ((await r.json()) as { data: { tickS: number } }).data.tickS);
    await page.waitForTimeout(1_500);
    const immerNoch = await page.request
      .get(`${SIMULATOR_UI_CORE_BASE_URL}/api/v1/simulator/status`)
      .then(async (r) => ((await r.json()) as { data: { tickS: number } }).data.tickS);
    expect(immerNoch).toBe(stand);

    await page.getByTestId('simulator-resume').click();
    await expect(page.getByTestId('simulator-pause')).toBeVisible({ timeout: 5_000 });

    await page.getByTestId('simulator-stop').click();
    await expect
      .poll(
        async () =>
          page.request
            .get(`${SIMULATOR_UI_CORE_BASE_URL}/api/v1/simulator/status`)
            .then(async (r) => ((await r.json()) as { data: { state: string } }).data.state),
        { timeout: 10_000 },
      )
      .toBe('stopped');
  });

  test('der Zeitraffer laesst sich waehrend der Fahrt umstellen, ohne von vorn zu beginnen', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await page.goto(SIMULATOR_UI_CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await planRoute(page);
    await openPanel(page);

    await page.getByTestId('simulator-play').click();
    await expect(page.getByTestId('simulator-track')).toBeVisible({ timeout: 10_000 });

    // Etwas Strecke sammeln, damit ein Ruecksprung auf 0 auffiele.
    await expect
      .poll(
        async () =>
          page.request
            .get(`${SIMULATOR_UI_CORE_BASE_URL}/api/v1/simulator/status`)
            .then(async (r) => ((await r.json()) as { data: { tickS: number } }).data.tickS),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);

    const vorUmschaltung = await page.request
      .get(`${SIMULATOR_UI_CORE_BASE_URL}/api/v1/simulator/status`)
      .then(async (r) => ((await r.json()) as { data: { tickS: number } }).data.tickS);

    // Regler auf die letzte Stufe (32x) -- der gemeldete Hoechstwert.
    await page.getByTestId('simulator-speed').fill('5');
    await expect(page.getByTestId('simulator-speed-value')).toHaveText('32×');

    const nachUmschaltung = await page.request
      .get(`${SIMULATOR_UI_CORE_BASE_URL}/api/v1/simulator/status`)
      .then(
        async (r) =>
          ((await r.json()) as { data: { tickS: number; speedFactor: number } }).data,
      );

    // DAS ist der Punkt: der Server faehrt schneller weiter, aber an
    // derselben Stelle. Ueber `play` mit neuem Faktor waere hier 0
    // herausgekommen -- die halbe Teststrecke noch einmal.
    expect(nachUmschaltung.speedFactor).toBe(32);
    expect(nachUmschaltung.tickS).toBeGreaterThanOrEqual(vorUmschaltung);

    // Und zurueck.
    await page.getByTestId('simulator-speed').fill('0');
    await expect(page.getByTestId('simulator-speed-value')).toHaveText('1×');
  });

  test('ohne geplante Route sagt das Panel, was fehlt, statt einen toten Knopf anzubieten', async ({
    page,
  }) => {
    test.setTimeout(30_000);

    await page.goto(SIMULATOR_UI_CORE_BASE_URL + '/');
    await waitForMapReady(page);
    // Bewusst KEINE Route planen.
    await page.evaluate(() => {
      window.__yapajaRoutingStore?.setState({ routes: [], activeRouteId: null });
    });
    await openPanel(page);

    await expect(page.getByTestId('simulator-no-route')).toBeVisible();
    await expect(page.getByTestId('simulator-play')).toBeDisabled();
  });

  test('ohne bekannte Tempolimits wird das offen ausgewiesen, nicht stillschweigend geraten', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    // Der Stub liefert diesmal keine Limits -- genau der Fall, den Valhalla
    // in der Praxis regelmaessig produziert.
    valhallaStub.setTraceAttributesEdges(null);

    await page.goto(SIMULATOR_UI_CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await planRoute(page);
    await openPanel(page);

    await page.getByTestId('simulator-play').click();
    await expect(page.getByTestId('simulator-track')).toBeVisible({ timeout: 10_000 });

    // Alle zehn Abschnitte ohne Limit -- und das steht da. Ohne diese Angabe
    // saehe eine halb geratene Fahrt genauso aus wie eine belegte.
    await expect(page.getByTestId('simulator-track')).toContainText('10/10');
  });
});
