/**
 * Zwischenziele -- von der Liste bis zur wirklich angefragten Strecke.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Bitte fuege die Moeglichkeit von Zwischenzielen ein. Bei Routenplanung
 * bzw. auch waehrend aktiver Navigation soll man Zwischenziele einfuegen und
 * in der Reihenfolge sortieren koennen."
 *
 * ─── WARUM AN DER ANFRAGE GEPRUEFT WIRD, NICHT AN DER ANTWORT ───────────────
 * Der Stub liefert immer dieselbe Strecke zurueck. An der Antwort liesse sich
 * also gar nicht erkennen, ob die Stationen ueberhaupt angekommen sind -- ein
 * Test, der die gezeichnete Linie ansieht, waere gruen, ohne irgendetwas zu
 * beweisen.
 *
 * Geprueft wird deshalb, was der Core WIRKLICH an Valhalla schickt:
 * `locations` = Start, dann die Zwischenziele in ihrer Reihenfolge, dann das
 * Ziel (`routing/profileMapping.ts#buildValhallaRouteBody`). Genau dort war
 * bis 0.5.9 die Luecke: der Browser schickte fest verdrahtet `waypoints: []`,
 * obwohl der ganze Weg dahinter fertig war.
 *
 * Die LISTENREGELN stehen in `src/routing/waypoints.test.ts`, die Regel fuer
 * den Kartentipper in `src/routing/mapTapIntent.test.ts`.
 */

import { test, expect, type Page } from '@playwright/test';
import { WAYPOINTS_CORE_BASE_URL, WAYPOINTS_VALHALLA_PORT } from './support/constants.js';
import { startValhallaStub, type ValhallaStub } from './support/valhallaStub.js';
import type { LatLon } from '../../core/src/routing/polyline.js';

const BASE_LAT = 47.5;
const BASE_LON = 9.8;
const M_PER_DEG_LAT = 111_195;

const POINTS: LatLon[] = Array.from({ length: 11 }, (_, i) => ({
  lat: BASE_LAT + (i * (M_PER_DEG_LAT * 0.001)) / M_PER_DEG_LAT,
  lon: BASE_LON,
}));

/** Zwei Stationen, klar unterscheidbar an der fuenften Nachkommastelle. */
const WP_A = { lat: BASE_LAT + 0.002, lon: BASE_LON };
const WP_B = { lat: BASE_LAT + 0.004, lon: BASE_LON };

let valhallaStub: ValhallaStub;

test.beforeAll(async () => {
  valhallaStub = await startValhallaStub(WAYPOINTS_VALHALLA_PORT);
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

/** Eine Position an den Core, damit `origin: 'current'` etwas vorfindet. */
async function postFix(page: Page, at: { lat: number; lon: number }, speed = 0): Promise<void> {
  const r = await page.request.post(`${WAYPOINTS_CORE_BASE_URL}/api/v1/position/browser`, {
    data: {
      lat: at.lat,
      lon: at.lon,
      alt: null,
      speed,
      heading: 0,
      accuracy: 5,
      fix: '3d',
      ts: new Date().toISOString(),
    },
  });
  expect(r.ok(), await r.text()).toBe(true);
}

/** Die `locations` der zuletzt an Valhalla geschickten Anfrage. */
function letzteLocations(): Array<{ lat: number; lon: number }> {
  const body = valhallaStub.lastRequestBody();
  expect(body, 'Der Stub hat noch gar keine Anfrage gesehen').not.toBeNull();
  const locations = body!.locations as Array<{ lat: number; lon: number }>;
  expect(Array.isArray(locations)).toBe(true);
  return locations;
}

/** Nur die Breitengrade, gerundet -- so lassen sich Reihenfolgen vergleichen. */
function breitengrade(): number[] {
  return letzteLocations().map((l) => Math.round((l.lat - BASE_LAT) * 100_000));
}

/**
 * Setzt Ziel und Zwischenziele direkt im Speicher und loest die Berechnung
 * aus. Der Kartentipper hat seine eigene Regel-Pruefung; hier geht es um den
 * Weg von der Liste bis zur Anfrage.
 */
async function planeMitZwischenzielen(page: Page, wps: Array<{ lat: number; lon: number }>): Promise<void> {
  // `origin: 'current'` heisst „nimm die Live-Position" -- ohne Fix lehnt der
  // Core mit NO_POSITION ab und fragt Valhalla gar nicht erst.
  await postFix(page, POINTS[0]);

  const profileId = await page.request
    .get(`${WAYPOINTS_CORE_BASE_URL}/api/v1/profiles`)
    .then(async (r) => {
      const data = ((await r.json()) as { data: Array<{ id: string; is_active?: boolean }> }).data;
      return (data.find((p) => p.is_active) ?? data[0]).id;
    });

  await page.evaluate(
    ({ ziel, stationen, profil }) => {
      const store = window.__yapajaRoutingStore;
      if (!store) throw new Error('Routing-Speicher fehlt');
      store.getState().setDestination(ziel as never);
      for (const s of stationen) {
        store.getState().addWaypoint(s as never, null, null);
      }
      void store.getState().requestRoute({ origin: 'current', profileId: profil });
    },
    {
      ziel: { lat: POINTS[10].lat, lon: POINTS[10].lon },
      stationen: wps,
      profil: profileId,
    },
  );
}

test.describe('Zwischenziele', () => {
  test.describe.configure({ mode: 'serial' }); // ein Core, ein Stub

  test.beforeEach(async ({ page }) => {
    valhallaStub.setNextTrip({ points: POINTS, lengthKm: 1.112, timeS: 90 });
    valhallaStub.setTraceAttributesEdges(null);
    await page.request
      .post(`${WAYPOINTS_CORE_BASE_URL}/api/v1/navigation/stop`)
      .catch(() => {
        // Aufraeumen nach bestem Vermoegen.
      });
  });

  test('gehen wirklich in die Routenanfrage -- in der gewaehlten Reihenfolge', async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto(WAYPOINTS_CORE_BASE_URL + '/');
    await waitForMapReady(page);

    const vorher = valhallaStub.callCount();
    await planeMitZwischenzielen(page, [WP_A, WP_B]);
    await expect.poll(() => valhallaStub.callCount(), { timeout: 15_000 }).toBeGreaterThan(vorher);

    // Start, A, B, Ziel -- genau vier Stationen, in genau dieser Reihenfolge.
    // Vor 0.5.9 waren es zwei: der Browser schickte `waypoints: []`.
    const lats = breitengrade();
    expect(lats).toHaveLength(4);
    expect(lats[1]).toBe(200); // WP_A
    expect(lats[2]).toBe(400); // WP_B
  });

  test('umsortieren aendert die Anfrage', async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto(WAYPOINTS_CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await planeMitZwischenzielen(page, [WP_A, WP_B]);
    await expect.poll(() => valhallaStub.callCount(), { timeout: 15_000 }).toBeGreaterThan(0);
    expect(breitengrade().slice(1, 3)).toEqual([200, 400]);

    // Das zweite nach oben -- ueber die Knoepfe in der Liste, nicht ueber den
    // Speicher: geprueft werden soll die Bedienung.
    await page.getByTestId('destination-sheet').waitFor({ state: 'visible', timeout: 10_000 });
    const zweiteId = await page.evaluate(
      () => window.__yapajaRoutingStore!.getState().waypoints[1].id,
    );
    const vorher = valhallaStub.callCount();
    await page.getByTestId(`waypoint-up-${zweiteId}`).click();

    await expect.poll(() => valhallaStub.callCount(), { timeout: 15_000 }).toBeGreaterThan(vorher);
    // Jetzt B vor A.
    expect(breitengrade().slice(1, 3)).toEqual([400, 200]);
  });

  test('entfernen nimmt die Station wieder aus der Anfrage', async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto(WAYPOINTS_CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await planeMitZwischenzielen(page, [WP_A, WP_B]);
    await expect.poll(() => valhallaStub.callCount(), { timeout: 15_000 }).toBeGreaterThan(0);

    const ersteId = await page.evaluate(
      () => window.__yapajaRoutingStore!.getState().waypoints[0].id,
    );
    const vorher = valhallaStub.callCount();
    await page.getByTestId(`waypoint-remove-${ersteId}`).click();

    await expect.poll(() => valhallaStub.callCount(), { timeout: 15_000 }).toBeGreaterThan(vorher);
    const lats = breitengrade();
    expect(lats).toHaveLength(3); // Start, B, Ziel
    expect(lats[1]).toBe(400);
  });

  test('die Liste zeigt Nummern und lässt sich an den Rändern nicht weiter schieben', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await page.goto(WAYPOINTS_CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await planeMitZwischenzielen(page, [WP_A, WP_B]);
    await expect(page.getByTestId('waypoint-list')).toBeVisible({ timeout: 15_000 });

    const ids = await page.evaluate(() =>
      window.__yapajaRoutingStore!.getState().waypoints.map((w) => w.id),
    );
    // Kein Umlauf: das erste kann nicht hoch, das letzte nicht runter.
    await expect(page.getByTestId(`waypoint-up-${ids[0]}`)).toBeDisabled();
    await expect(page.getByTestId(`waypoint-down-${ids[1]}`)).toBeDisabled();
    await expect(page.getByTestId(`waypoint-down-${ids[0]}`)).toBeEnabled();
    await expect(page.getByTestId(`waypoint-count`)).toHaveText('(2)');
  });

  /**
   * ─── DER TEIL, DEN ES OHNE DEN TESTFAHRER NICHT ZU PRUEFEN GAEBE ──────────
   * „…bzw. auch waehrend aktiver Navigation." Ein Neustart der Navigation ist
   * aus `navigating` gar nicht erlaubt (409); die Aenderung geht deshalb ueber
   * `POST /navigation/waypoints` und dieselbe Maschinerie, die der Core fuer
   * Abweichungen schon hat.
   */
  test('lassen sich WAEHREND der Fahrt anhaengen und legen die Strecke neu', async ({ page }) => {
    test.setTimeout(90_000);

    await page.goto(WAYPOINTS_CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await planeMitZwischenzielen(page, []);
    await expect.poll(() => valhallaStub.callCount(), { timeout: 15_000 }).toBeGreaterThan(0);

    // Fahrt starten mit der berechneten Route.
    const route = await page.evaluate(() => {
      const s = window.__yapajaRoutingStore!.getState();
      return s.routes.find((r) => r.id === s.activeRouteId) ?? s.routes[0];
    });
    const start = await page.request.post(`${WAYPOINTS_CORE_BASE_URL}/api/v1/navigation/start`, {
      data: { route, destination: { latlng: POINTS[10], name: 'Ziel' } },
    });
    expect(start.ok(), await start.text()).toBe(true);

    // Eine Position, damit der Core einen Bezugspunkt hat -- ohne Fix kann er
    // nicht neu rechnen (und sagt das auch).
    await postFix(page, POINTS[1], 8);

    // ─── AUF DIE RICHTIGE ZUSICHERUNG WARTEN ──────────────────────────────
    // Nicht auf `status === 'navigating'`: das gilt schon unmittelbar nach
    // `start()`, also BEVOR der Core einen Positionsfix verarbeitet hat. Eine
    // Neuberechnung braucht aber einen Ausgangspunkt -- ohne Fix vertagt der
    // Core sie (siehe `waypointRerouteWanted`), und der Test sah dann
    // scheinbar grundlos keine Anfrage.
    //
    // Genau daran ist dieser Test in CI gescheitert und lokal nicht: der
    // Unterschied war reines Timing. Deshalb wird jetzt auf einen Wert
    // gewartet, den es NUR nach einem verarbeiteten Fix gibt.
    await expect
      .poll(
        () =>
          page.evaluate(
            () => window.__yapajaNavStore?.getState().navState?.distance_remaining_m ?? null,
          ),
        { timeout: 15_000 },
      )
      .not.toBeNull();
    await expect
      .poll(
        () => page.evaluate(() => window.__yapajaNavStore?.getState().navState?.status ?? null),
        { timeout: 15_000 },
      )
      .toBe('navigating');

    // Jetzt die Station anhaengen -- mitten in der Fahrt.
    const vorher = valhallaStub.callCount();
    await page.evaluate((wp) => {
      window.__yapajaRoutingStore!.getState().addWaypoint(wp as never, null, null);
    }, WP_B);

    // Der Core hat neu angefragt, UND die Station war dabei.
    await expect.poll(() => valhallaStub.callCount(), { timeout: 20_000 }).toBeGreaterThan(vorher);
    const lats = breitengrade();
    expect(lats).toContain(400); // WP_B
    // Start ist jetzt die Fahrzeugposition, nicht mehr der urspruengliche
    // Streckenanfang -- die Neuberechnung geht von hier aus weiter.
    expect(lats).toHaveLength(3);
  });
});
