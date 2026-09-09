/**
 * E04-T5 (capstone): end-to-end navigation control + destination convenience.
 *
 * Flow 2 (full, docs/07 §5): destination -> "Route hierhin" -> "Navigation
 * starten" -> Drive mode (3d-course camera + follow-me, maneuver panel) ->
 * pause -> resume -> stop -> back to Explore mode with the route still
 * visible and `nav/state` idle.
 *
 * W-19 reload-recovery: reloading mid-navigation (Core process stays alive,
 * only the tab/page reloads) shows a one-click "Navigation fortsetzen?"
 * prompt; confirming it resumes into `navigating` in well under 3 s. (The
 * OTHER W-19 case -- the Core process itself restarting, `idle` +
 * `recovered_route` -- is covered by `apps/core/src/navigation/service.test.ts`
 * / `routes.test.ts` + `apps/web/src/drive/resume.test.ts` instead of here:
 * restarting the shared dedicated Core process mid-test isn't practical in
 * this harness without disrupting the "one process per spec file" pattern
 * every other e2e spec relies on.)
 *
 * Flow 5 (prepared, per spec -- full profile-change-triggers-reroute is out
 * of E04-T5's scope): a minimal smoke check that changing the active profile
 * while navigating doesn't crash the app or corrupt `nav/state`.
 *
 * No real Valhalla/geocoder in this harness (same constraint routing.spec.ts
 * / drive.spec.ts document) -- `POST /api/v1/routes` is mocked with a fixed
 * multi-maneuver `Route` fixture; navigation control itself (start/pause/
 * resume/stop/destination) hits the REAL Core.
 */

import { test, expect, type Page } from '@playwright/test';
import type { Route } from '@yapaia/shared';
import { encodePolyline6, type LatLon } from '../../core/src/routing/polyline.js';
import { NAV_CONTROL_CORE_BASE_URL } from './support/constants.js';
import { collectPageErrors, trackRequests } from './support/network.js';

const BASE_LAT = 47.3;
const BASE_LON = 9.9;
const M_PER_DEG_LAT = 111_195;

function latForProgressM(progressM: number): number {
  return BASE_LAT + progressM / M_PER_DEG_LAT;
}

// 11 vertices, ~111.2 m apart -> ~1112 m total, straight due north, 2 maneuvers.
const ROUTE_POINTS: LatLon[] = Array.from({ length: 11 }, (_, i) => ({
  lat: latForProgressM(i * (M_PER_DEG_LAT * 0.001)),
  lon: BASE_LON,
}));
const TOTAL_LENGTH_M = 10 * (M_PER_DEG_LAT * 0.001);

const ROUTE: Route = {
  id: 'nav-control-e2e-route',
  distance_m: TOTAL_LENGTH_M,
  duration_s: 120,
  geometry: encodePolyline6(ROUTE_POINTS),
  legs: [{ index: 0, distance_m: TOTAL_LENGTH_M, duration_s: 120 }],
  maneuvers: [
    {
      index: 0,
      type: 'continue',
      instruction: 'Der Hauptstraße folgen',
      street_names: ['Hauptstraße'],
      distance_m: 8 * (M_PER_DEG_LAT * 0.001),
      begin_shape_index: 0,
    },
    {
      index: 1,
      type: 'turn_left',
      instruction: 'Links abbiegen auf die Zielstraße',
      street_names: ['Zielstraße'],
      distance_m: 2 * (M_PER_DEG_LAT * 0.001),
      begin_shape_index: 8,
    },
  ],
  speed_limits: [],
  warnings: [],
};

async function mockRoutesEndpoint(page: Page): Promise<void> {
  await page.route('**/api/v1/routes', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [ROUTE] }),
    });
  });
}

async function createAndActivateProfile(page: Page, name = 'E2E Nav-Control Test-Fahrzeug'): Promise<string> {
  const createResponse = await page.request.post(`${NAV_CONTROL_CORE_BASE_URL}/api/v1/profiles`, {
    data: {
      name,
      height_m: 2.5,
      width_m: 2.1,
      length_m: 6.5,
      weight_t: 3.5,
      avg_speed_kmh: 80,
      hazmat: false,
      avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
    },
  });
  expect(createResponse.ok()).toBe(true);
  const created = (await createResponse.json()) as { data: { id: string } };
  const activateResponse = await page.request.put(
    `${NAV_CONTROL_CORE_BASE_URL}/api/v1/profiles/${created.data.id}/activate`,
  );
  expect(activateResponse.ok()).toBe(true);
  return created.data.id;
}

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapaiaMapController?.getMap?.()), undefined, {
    timeout: 15_000,
  });
}

async function clickMapCenter(page: Page): Promise<void> {
  const box = await page.locator('canvas.maplibregl-canvas').boundingBox();
  if (!box) throw new Error('Canvas has no bounding box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

function browserFixBody(progressM: number, speedMs: number): Record<string, unknown> {
  return {
    lat: latForProgressM(progressM),
    lon: BASE_LON,
    alt: null,
    speed: speedMs,
    heading: 0,
    accuracy: 5,
    fix: '3d',
    ts: new Date().toISOString(),
  };
}

/** Posts one exact fix and waits out the Core's 1 Hz publish throttle. */
async function driveTo(page: Page, progressM: number, speedMs = 3): Promise<void> {
  const response = await page.request.post(`${NAV_CONTROL_CORE_BASE_URL}/api/v1/position/browser`, {
    data: browserFixBody(progressM, speedMs),
  });
  expect(response.ok()).toBe(true);
  await page.waitForTimeout(1100);
}

async function zoomOf(page: Page): Promise<number> {
  return page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window.__yapaiaMapController?.getMap?.() as any)?.getZoom?.() ?? 0,
  );
}

async function readPitch(page: Page): Promise<number | null> {
  return page.evaluate(() => window.__yapaiaMapController?.getMap()?.getPitch?.() ?? null);
}

async function readCenter(page: Page): Promise<{ lat: number; lon: number } | null> {
  return page.evaluate(() => {
    const center = window.__yapaiaMapController?.getMap()?.getCenter?.();
    return center ? { lat: center.lat, lon: center.lng } : null;
  });
}

async function navStatus(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__yapaiaNavStore?.getState().navState?.status ?? null);
}

test.describe('Navigation control end-to-end (E04-T5, Flow 2 + W-19)', () => {
  test.describe.configure({ mode: 'serial' }); // one shared Core, one navigation session at a time
  // Opt back IN to the PWA Service Worker that `playwright.config.ts` blocks
  // by default (E07-T5): the W-19 test below is the mandatory "reload-recovery
  // still works with the SW active" proof -- the resume prompt must appear and
  // resume even though the reloaded app shell is now served from the SW's
  // precache. (These tests already ran green with the SW; they aren't among
  // the tight-budget specs the default block exists to protect.)
  test.use({ serviceWorkers: 'allow' });

  test.afterEach(async ({ page }) => {
    await page
      .evaluate(async (baseUrl: string) => {
        await fetch(`${baseUrl}/api/v1/navigation/stop`, { method: 'POST' });
      }, NAV_CONTROL_CORE_BASE_URL)
      .catch(() => {
        // Best-effort cleanup.
      });
  });

  test('Flow 2 (full): destination -> Navigation starten -> drive mode -> pause/resume -> stop -> Explore mode with route still visible', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const tracker = await trackRequests(page, NAV_CONTROL_CORE_BASE_URL);
    const pageErrors = collectPageErrors(page);
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await mockRoutesEndpoint(page);
    await createAndActivateProfile(page);

    await page.goto(NAV_CONTROL_CORE_BASE_URL + '/');
    await waitForMapReady(page);

    // Starts in 2d-north (pitch 0) -- the "prior view mode" Stop must restore.
    await expect.poll(() => readPitch(page)).toBeLessThan(1);

    // 1. Destination -> "Route hierhin".
    await clickMapCenter(page);
    await expect(page.getByTestId('destination-sheet')).toBeVisible();
    await expect(page.getByTestId('route-here-button')).toBeEnabled({ timeout: 10_000 });
    await page.getByTestId('route-here-button').click();
    await expect(page.getByTestId('route-summary-panel')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('start-navigation-button')).toBeEnabled();

    // 2. "Navigation starten" -> real POST /navigation/start against the Core.
    await page.getByTestId('start-navigation-button').click();
    await expect(page.getByTestId('maneuver-panel')).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => navStatus(page), { timeout: 5_000 }).toBe('navigating');

    // The destination sheet (route-planning UI) makes way for drive mode.
    await expect(page.getByTestId('destination-sheet')).not.toBeVisible();

    // 3. Drive mode: camera switches to 3d-course (pitch ~55) + follow-me
    // recenters on each new position fix.
    await expect.poll(() => readPitch(page), { timeout: 5_000 }).toBeGreaterThan(50);

    await driveTo(page, 200);
    // Maneuver anchors are keyed by `begin_shape_index`; maneuver 0 sits at
    // shape index 0 (the depart point, `progressM` 0) so it's already
    // "passed" at any progress > 0 -- the panel shows the first REAL turn
    // (index 1) from the very start of the drive (same mechanism
    // `drive.spec.ts`'s own route exercises).
    await expect(page.getByTestId('maneuver-street')).toHaveText('Zielstraße');
    await expect
      .poll(async () => {
        const center = await readCenter(page);
        return center ? Math.abs(center.lat - latForProgressM(200)) : Infinity;
      }, { timeout: 5_000 })
      .toBeLessThan(0.01); // follow-me recentered the camera on the fed position

    // 4. Pause -> Resume.
    await expect(page.getByTestId('drive-pause-button')).toBeVisible();
    await page.getByTestId('drive-pause-button').click();
    await expect.poll(() => navStatus(page), { timeout: 5_000 }).toBe('paused');
    await expect(page.getByTestId('maneuver-panel')).toBeVisible(); // still shown while paused
    await expect(page.getByTestId('drive-resume-button')).toBeVisible();

    await page.getByTestId('drive-resume-button').click();
    await expect.poll(() => navStatus(page), { timeout: 5_000 }).toBe('navigating');
    await expect(page.getByTestId('drive-pause-button')).toBeVisible();

    // 5. Stop -> back to Explore mode; route stays drawn; nav/state idle
    // (destination null, per the E04-T5 plausibility requirement).
    await page.getByTestId('drive-stop-button').click();
    await expect(page.getByTestId('maneuver-panel')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByTestId('drive-controls')).toHaveCount(0);
    await expect.poll(() => navStatus(page), { timeout: 5_000 }).toBe('idle');
    const destinationAfterStop = await page.evaluate(
      () => window.__yapaiaNavStore?.getState().navState?.destination,
    );
    expect(destinationAfterStop).toBeNull();

    // Explore mode: view mode restored (pitch back near 0, the prior mode).
    await expect.poll(() => readPitch(page), { timeout: 5_000 }).toBeLessThan(1);

    // The route-planning UI reappears, STILL showing the same route.
    await expect(page.getByTestId('destination-sheet')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('route-summary-panel')).toBeVisible();
    expect(
      await page.evaluate(() => Boolean(window.__yapaiaMapController?.getMap()?.getLayer('route-main-accent'))),
    ).toBe(true);
    expect(await page.evaluate(() => window.__yapaiaRoutingStore?.getState().activeRouteId)).toBe(ROUTE.id);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(tracker.getForeignUrls()).toEqual([]);
  });

  test('W-19: reload mid-navigation shows "Navigation fortsetzen?" and one click resumes navigating in < 3 s', async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const pageErrors = collectPageErrors(page);

    await page.goto(NAV_CONTROL_CORE_BASE_URL + '/');
    await waitForMapReady(page);

    // Start navigation directly against the Core (no live Valhalla/geocoder
    // to drive the UI flow through -- see the file-level comment; Flow 2
    // above already exercises the full UI-driven start).
    const startResponse = await page.request.post(`${NAV_CONTROL_CORE_BASE_URL}/api/v1/navigation/start`, {
      data: { route: ROUTE, destination: { latlng: ROUTE_POINTS[10], name: 'W-19 Ziel' } },
    });
    expect(startResponse.ok()).toBe(true);
    await driveTo(page, 150);
    await expect.poll(() => navStatus(page), { timeout: 5_000 }).toBe('navigating');

    // Reload: the tab crashes/reloads, the Core process (and its navigation)
    // stays alive. Time the whole recovery from reload to fully resumed.
    const reloadStart = Date.now();
    await page.reload();
    await waitForMapReady(page);

    await expect(page.getByTestId('resume-prompt')).toBeVisible({ timeout: 3_000 });
    // The Drive UI must NOT have jumped in on its own before the click.
    await expect(page.getByTestId('maneuver-panel')).toHaveCount(0);

    await page.getByTestId('resume-navigation-button').click();
    await expect(page.getByTestId('maneuver-panel')).toBeVisible({ timeout: 3_000 });
    await expect.poll(() => navStatus(page), { timeout: 3_000 }).toBe('navigating');
    const elapsedMs = Date.now() - reloadStart;
    expect(elapsedMs).toBeLessThan(3_000);

    expect(pageErrors).toEqual([]);
  });

  /**
   * ─── DER PANEL-WECHSEL IN HOME ASSISTANT ──────────────────────────────────
   * Gemeldet: „Ich wechsle zum Dashboard und zurueck, und werde gefragt ob
   * ich die Navigation fortsetzen moechte. Es sieht aus als ob die Navigation
   * gestoppt wird."
   *
   * Sie wird nicht gestoppt -- Home Assistant wirft beim Wechsel den
   * Ingress-Rahmen weg und baut ihn neu auf. Fuer die App ist das ein
   * frischer Start, kein Neuladen. Genau das bildet dieser Test ab: ein
   * zweites `goto` auf dieselbe Seite, waehrend der Core weiterfaehrt.
   */
  test('zurueck aus einem anderen Dashboard: keine Frage, sondern weiterfahren', async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const pageErrors = collectPageErrors(page);

    await page.goto(NAV_CONTROL_CORE_BASE_URL + '/');
    await waitForMapReady(page);
    const startResponse = await page.request.post(
      `${NAV_CONTROL_CORE_BASE_URL}/api/v1/navigation/start`,
      { data: { route: ROUTE, destination: { latlng: ROUTE_POINTS[10], name: 'Panel-Ziel' } } },
    );
    expect(startResponse.ok()).toBe(true);
    await driveTo(page, 150);
    await expect.poll(() => navStatus(page), { timeout: 5_000 }).toBe('navigating');

    // Weg und wieder da -- wie der Rahmen, den Home Assistant neu aufbaut.
    await page.goto(NAV_CONTROL_CORE_BASE_URL + '/');
    await waitForMapReady(page);

    // Die Fahransicht ist einfach wieder da, ohne Rueckfrage.
    await expect(page.getByTestId('maneuver-panel')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('resume-prompt')).toHaveCount(0);
    expect(await navStatus(page)).toBe('navigating');

    expect(pageErrors).toEqual([]);
  });

  /**
   * ─── DIE ROUTE IN DER DASHBOARD-KACHEL ────────────────────────────────────
   * Gemeldet, mit Bildschirmfoto: die Kachel heisst „Karte mit Route", zeigte
   * aber nur die Karte -- waehrend im Add-on selbst die blaue Linie lief.
   *
   * Der Test steht in DIESER Datei und nicht in `embed.spec.ts`, weil er eine
   * LAUFENDE Fahrt braucht. Die gibt es nur auf dem eigenen Core dieser Datei;
   * auf dem geteilten Core waere sie ein Stolperstein fuer jede andere
   * Pruefung, die parallel laeuft (siehe die Begruendung zu den eigenen Ports
   * in `support/constants.ts`).
   */
  test('die Dashboard-Kachel zeigt die laufende Route, nicht nur die Karte', async ({ page }) => {
    test.setTimeout(30_000);
    const pageErrors = collectPageErrors(page);

    await page.goto(NAV_CONTROL_CORE_BASE_URL + '/');
    await waitForMapReady(page);
    const startResponse = await page.request.post(
      `${NAV_CONTROL_CORE_BASE_URL}/api/v1/navigation/start`,
      { data: { route: ROUTE, destination: { latlng: ROUTE_POINTS[10], name: 'Kachel-Ziel' } } },
    );
    expect(startResponse.ok()).toBe(true);
    await driveTo(page, 150);
    await expect.poll(() => navStatus(page), { timeout: 5_000 }).toBe('navigating');

    // Jetzt die Anzeigeseite -- genau das, was die Lovelace-Karte einrahmt.
    await page.goto(`${NAV_CONTROL_CORE_BASE_URL}/embed.html`);
    await waitForMapReady(page);

    // Gemessen wird die LINIE, nicht der Speicherzustand: die Kachel soll
    // etwas zeigen, nicht etwas wissen.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const map: any = window.__yapaiaMapController?.getMap?.();
            if (!map?.getSource('route-main-source')) return -1;
            return map.querySourceFeatures('route-main-source').length;
          }),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);

    // Und es bleibt eine Anzeige: keine Fahrbedienung, keine Rueckfrage.
    await expect(page.getByTestId('resume-prompt')).toHaveCount(0);
    await expect(page.getByTestId('drive-controls')).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  /**
   * ─── UND SIE ZOOMT AUF DAS FAHRZEUG ───────────────────────────────────────
   * Auf dem Bildschirmfoto des Betreibers stand die Kachel auf dem ganzen
   * Kartengebiet -- Deutschland mit einem Punkt darin. Der Ausschnitt kommt
   * beim Start aus den Grenzen der installierten Region; wer eine grosse
   * Region installiert hat, sieht sie ganz.
   *
   * Gemessen wird deshalb die BEWEGUNG, nicht der Endwert: die Kachel wird
   * absichtlich weit herausgezoomt, DANN beginnt die Fahrt. Ein Test auf
   * „Zoomstufe > 10" waere hier wertlos -- die Testregion ist so klein, dass
   * der Anfangsausschnitt das ohnehin erfuellt (nachgemessen: er besteht auch
   * ohne den Auto-Zoom).
   */
  test('die Dashboard-Kachel zoomt auf das Fahrzeug, wenn die Fahrt beginnt', async ({ page }) => {
    test.setTimeout(30_000);

    await page.goto(`${NAV_CONTROL_CORE_BASE_URL}/embed.html`);
    await waitForMapReady(page);
    await driveTo(page, 10);

    const WEIT_DRAUSSEN = 6;
    await page.evaluate((z) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window.__yapaiaMapController?.getMap?.() as any)?.setZoom?.(z);
    }, WEIT_DRAUSSEN);
    expect(await zoomOf(page)).toBeCloseTo(WEIT_DRAUSSEN, 1);

    const startResponse = await page.request.post(
      `${NAV_CONTROL_CORE_BASE_URL}/api/v1/navigation/start`,
      { data: { route: ROUTE, destination: { latlng: ROUTE_POINTS[10], name: 'Zoom-Ziel' } } },
    );
    expect(startResponse.ok()).toBe(true);
    await driveTo(page, 150);

    await expect
      .poll(() => zoomOf(page), { timeout: 10_000 })
      .toBeGreaterThan(WEIT_DRAUSSEN + 2);
  });

  test('Flow 5 (prepared): changing the active profile mid-navigation does not crash the app or corrupt nav/state', async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const pageErrors = collectPageErrors(page);

    const otherProfileId = await createAndActivateProfile(page, 'E2E Flow5 Ausgangsprofil');

    await page.goto(NAV_CONTROL_CORE_BASE_URL + '/');
    await waitForMapReady(page);

    const startResponse = await page.request.post(`${NAV_CONTROL_CORE_BASE_URL}/api/v1/navigation/start`, {
      data: { route: ROUTE, destination: { latlng: ROUTE_POINTS[10], name: 'Flow5 Ziel' } },
    });
    expect(startResponse.ok()).toBe(true);
    await driveTo(page, 100);
    await expect.poll(() => navStatus(page), { timeout: 5_000 }).toBe('navigating');

    // Activate a DIFFERENT profile while navigating -- full "reroute + Warnhinweis"
    // (docs/03: profile activate during nav) is out of E04-T5's scope; this
    // just proves the app survives it and `nav/state` stays a valid status.
    const otherId = await createAndActivateProfile(page, 'E2E Flow5 Neues Profil');
    expect(otherId).not.toBe(otherProfileId);

    await driveTo(page, 150);
    const status = await navStatus(page);
    expect(['navigating', 'off_route', 'paused']).toContain(status);

    expect(pageErrors).toEqual([]);
  });
});
