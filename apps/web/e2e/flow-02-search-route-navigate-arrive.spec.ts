/**
 * docs/07 §5 — FLOW 2: "Suche 'Vaduz' ⇒ Ergebnis wählen ⇒ Route mit Profil
 * 'Camper 3,2 m' ⇒ Navigation starten ⇒ Simulator fährt ⇒ Manöver-Anzeigen
 * wechseln korrekt ⇒ Ankunft."
 *
 * Canonical proof for flow 2. See `e2e/FLOWS.md` for the full flow→spec table.
 *
 * Flow 2 was previously proven only in PIECES — `search.spec.ts` (the search
 * half), `nav-control.spec.ts` (destination → start → pause/resume → stop),
 * `drive.spec.ts` (maneuver stepping + arrival) — with no single test walking
 * the whole chain, and in particular nothing tying the route request to the
 * "Camper 3,2 m" profile the flow names. This spec is that end-to-end walk;
 * the three specs above keep their own (deeper, narrower) coverage.
 *
 * DETERMINISM (task requirement: "Simulator statt Echtzeit (speed_factor),
 * keine sleep-basierten Waits"): the drive is executed by the REAL GPS
 * simulator (`POST /api/v1/simulator/play`) replaying the route's OWN geometry
 * — docs/07 §2's "Routen-Geometrien aus Valhalla selbst (perfekte Fahrt)" —
 * compressed with `speed_factor`, so wall-clock time never enters an
 * assertion and there is not a single `waitForTimeout` in this file.
 *
 * No live Photon/Valhalla exists in this harness (the constraint
 * `search.spec.ts`/`routing.spec.ts`/`nav-control.spec.ts` all document), so
 * `GET /api/v1/search` and `POST /api/v1/routes` are mocked at the BROWSER's
 * fetch. Everything downstream of that — profile activation, route selection,
 * `POST /navigation/start`, the simulator, the navigation engine, arrival —
 * runs against the REAL built Core.
 *
 * END STATE ASSERTED BOTH WAYS at every stage (plausibility requirement):
 * every step below checks the Core's own REST state (`GET /api/v1/profiles`,
 * `GET /api/v1/navigation/state`, the captured `POST /routes` body) AND the
 * rendered UI.
 */

import { test, expect, type Page } from '@playwright/test';
import type { Route, SearchResult } from '@yapaja/shared';
import { encodePolyline6, type LatLon } from '../../core/src/routing/polyline.js';
import { FLOW2_CORE_BASE_URL } from './support/constants.js';
import { collectPageErrors, trackRequests } from './support/network.js';

// --- fixtures ---------------------------------------------------------------

const VADUZ: SearchResult = {
  name: 'Vaduz',
  label: 'Vaduz, Liechtenstein',
  latlng: { lat: 47.141, lon: 9.5215 },
  type: 'city',
  source: 'photon',
};

const M_PER_DEG_LAT = 111_195;
/** Route runs due north and ENDS on Vaduz, so "arrival" is arrival at the searched destination. */
const END_LAT = VADUZ.latlng.lat;
const LON = VADUZ.latlng.lon;
const STEP_M = 111.195; // 0.001 deg latitude
const POINT_COUNT = 21;
const TOTAL_LENGTH_M = (POINT_COUNT - 1) * STEP_M; // ~2224 m

/** index 0 = start (south), index 20 = Vaduz. */
const ROUTE_POINTS: LatLon[] = Array.from({ length: POINT_COUNT }, (_, i) => ({
  lat: END_LAT - ((POINT_COUNT - 1 - i) * STEP_M) / M_PER_DEG_LAT,
  lon: LON,
}));

/**
 * Three maneuvers with WELL-SEPARATED anchors so the maneuver panel provably
 * steps 1 → 2 → 3 as the simulator advances (`begin_shape_index` is what the
 * engine anchors on).
 */
const ROUTE: Route = {
  id: 'flow2-route',
  distance_m: TOTAL_LENGTH_M,
  duration_s: 150,
  geometry: encodePolyline6(ROUTE_POINTS),
  legs: [{ index: 0, distance_m: TOTAL_LENGTH_M, duration_s: 150 }],
  maneuvers: [
    {
      index: 0,
      type: 'continue',
      instruction: 'Der Landstraße folgen',
      street_names: ['Landstraße'],
      distance_m: 7 * STEP_M,
      begin_shape_index: 0,
    },
    {
      index: 1,
      type: 'turn_left',
      instruction: 'Links abbiegen auf die Äulestraße',
      street_names: ['Äulestraße'],
      distance_m: 7 * STEP_M,
      begin_shape_index: 7,
    },
    {
      index: 2,
      type: 'turn_right',
      instruction: 'Rechts abbiegen auf den Städtle',
      street_names: ['Städtle'],
      distance_m: 6 * STEP_M,
      begin_shape_index: 14,
    },
  ],
  speed_limits: [],
  warnings: [],
};

/** The flow's named profile. 3,2 m height is the whole point of the name. */
const CAMPER_PROFILE = {
  name: 'Camper 3,2 m',
  height_m: 3.2,
  width_m: 2.3,
  length_m: 7.0,
  weight_t: 3.5,
  avg_speed_kmh: 80,
  hazmat: false,
  avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
};

// --- helpers ----------------------------------------------------------------

interface CapturedRouteRequest {
  profile_id?: string;
  destination?: { lat: number; lon: number };
}

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapajaMapController?.getMap?.()), undefined, {
    timeout: 15_000,
  });
}

/** The Core's OWN view of the navigation session (the API half of every
 *  assertion below) — deliberately NOT the browser store. */
async function apiNavState(page: Page): Promise<{
  status: string;
  route_id: string | null;
  distance_remaining_m: number | null;
  next_maneuver: { index: number; street_names: string[] } | null;
  destination: { name?: string | null } | null;
}> {
  const response = await page.request.get(`${FLOW2_CORE_BASE_URL}/api/v1/navigation/state`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { data: Record<string, unknown> };
  return body.data as never;
}

test.describe('docs/07 §5 Flow 2 (end-to-end chain)', () => {
  // One Core, one navigation session, one global simulator at a time.
  test.describe.configure({ mode: 'serial' });

  test.afterEach(async ({ page }) => {
    await page.request.post(`${FLOW2_CORE_BASE_URL}/api/v1/simulator/stop`).catch(() => {});
    await page.request.post(`${FLOW2_CORE_BASE_URL}/api/v1/navigation/stop`).catch(() => {});
  });

  test('[Flow 2] search "Vaduz" -> pick -> route with profile "Camper 3,2 m" -> navigate -> simulator drives -> maneuvers step -> arrival', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const tracker = await trackRequests(page, FLOW2_CORE_BASE_URL);
    const pageErrors = collectPageErrors(page);
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // === 0. Profile "Camper 3,2 m" — created + activated through the REAL API.
    const createResponse = await page.request.post(`${FLOW2_CORE_BASE_URL}/api/v1/profiles`, {
      data: CAMPER_PROFILE,
    });
    expect(createResponse.ok()).toBe(true);
    const camperId = ((await createResponse.json()) as { data: { id: string } }).data.id;
    const activateResponse = await page.request.put(
      `${FLOW2_CORE_BASE_URL}/api/v1/profiles/${camperId}/activate`,
    );
    expect(activateResponse.ok()).toBe(true);

    // API: the Core really has it active, with the 3,2 m height.
    const profilesBody = (await (
      await page.request.get(`${FLOW2_CORE_BASE_URL}/api/v1/profiles`)
    ).json()) as { data: Array<{ id: string; name: string; height_m: number; is_active: boolean }> };
    const camper = profilesBody.data.find((p) => p.id === camperId);
    expect(camper?.name).toBe('Camper 3,2 m');
    expect(camper?.height_m).toBe(3.2);
    expect(camper?.is_active).toBe(true);

    // === mocks for the two backends this harness has no live instance of ===
    await page.route('**/api/v1/search*', async (route) => {
      const q = (new URL(route.request().url()).searchParams.get('q') ?? '').toLowerCase();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: q.includes('vaduz') ? [VADUZ] : [] }),
      });
    });

    const capturedRouteRequests: CapturedRouteRequest[] = [];
    await page.route('**/api/v1/routes', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      capturedRouteRequests.push(route.request().postDataJSON() as CapturedRouteRequest);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [ROUTE] }),
      });
    });

    await page.goto(FLOW2_CORE_BASE_URL + '/');
    await waitForMapReady(page);

    // UI: the active profile chip shows the Camper.
    await expect(page.getByTestId('profile-chip')).toContainText('Camper 3,2 m');

    // === 1. Search "Vaduz" ===================================================
    const searchResponse = page.waitForResponse(
      (res) => res.url().includes('/api/v1/search'),
      { timeout: 15_000 },
    );
    await page.getByTestId('search-input').fill('Vaduz');
    await searchResponse;

    const firstResult = page.getByTestId('search-result-0');
    await expect(firstResult).toBeVisible();
    await expect(firstResult).toContainText('Vaduz');

    // === 2. Pick the result -> destination sheet with the REAL name =========
    await firstResult.click();
    await expect(page.getByTestId('destination-sheet')).toBeVisible();
    await expect(page.getByTestId('destination-title')).toHaveText('Vaduz');

    // === 3. Route with the active profile ===================================
    await expect(page.getByTestId('route-here-button')).toBeEnabled({ timeout: 10_000 });
    await page.getByTestId('route-here-button').click();
    await expect(page.getByTestId('route-summary-panel')).toBeVisible({ timeout: 15_000 });

    // API side: the route request the app actually sent carried the Camper
    // profile and the searched destination -- this is what "Route mit Profil
    // 'Camper 3,2 m'" means, and it was previously asserted nowhere.
    expect(capturedRouteRequests.length).toBeGreaterThan(0);
    const routeRequest = capturedRouteRequests[capturedRouteRequests.length - 1];
    expect(routeRequest.profile_id).toBe(camperId);
    expect(routeRequest.destination?.lat).toBeCloseTo(VADUZ.latlng.lat, 4);
    expect(routeRequest.destination?.lon).toBeCloseTo(VADUZ.latlng.lon, 4);

    // === 4. Start navigation ================================================
    await expect(page.getByTestId('start-navigation-button')).toBeEnabled();
    await page.getByTestId('start-navigation-button').click();

    // UI: drive mode is up.
    await expect(page.getByTestId('maneuver-panel')).toBeVisible({ timeout: 15_000 });
    // API: the CORE agrees it is navigating this exact route to Vaduz.
    await expect.poll(async () => (await apiNavState(page)).status, { timeout: 15_000 }).toBe(
      'navigating',
    );
    const startedState = await apiNavState(page);
    expect(startedState.route_id).toBe(ROUTE.id);
    expect(startedState.destination?.name).toBe('Vaduz');

    // === 5. The SIMULATOR drives the route's own geometry ===================
    // `speed_factor: 6` compresses ~150 s of simulated driving into ~25 s of
    // wall clock; every assertion below is on STATE, never on elapsed time.
    const playResponse = await page.request.post(`${FLOW2_CORE_BASE_URL}/api/v1/simulator/play`, {
      data: {
        track: { polyline6: ROUTE.geometry, speedMs: TOTAL_LENGTH_M / 150 },
        speed_factor: 6,
      },
    });
    expect(playResponse.ok()).toBe(true);
    const simulatorStatus = (await playResponse.json()) as {
      data: { state: string; speedFactor: number };
    };
    expect(simulatorStatus.data.state).toBe('playing');
    expect(simulatorStatus.data.speedFactor).toBe(6);

    // === 6. Maneuver displays step through, correctly and in order ==========
    // Maneuver 0 is anchored at the depart point, so the panel shows the first
    // REAL turn from the outset (same mechanism nav-control.spec.ts documents).
    await expect(page.getByTestId('maneuver-street')).toHaveText('Äulestraße', { timeout: 30_000 });
    await expect(page.getByTestId('maneuver-arrow').first()).toHaveAttribute(
      'data-arrow-key',
      'turn_left',
    );

    // API: remaining distance is genuinely counting DOWN while that happens.
    const stateAtManeuver1 = await apiNavState(page);
    const remainingAtManeuver1 = stateAtManeuver1.distance_remaining_m;
    expect(remainingAtManeuver1).not.toBeNull();
    // API and UI agree on WHICH maneuver is active.
    expect(stateAtManeuver1.next_maneuver?.street_names).toContain('Äulestraße');

    await expect(page.getByTestId('maneuver-street')).toHaveText('Städtle', { timeout: 40_000 });
    await expect(page.getByTestId('maneuver-arrow').first()).toHaveAttribute(
      'data-arrow-key',
      'turn_right',
    );

    const stateAtManeuver2 = await apiNavState(page);
    const remainingAtManeuver2 = stateAtManeuver2.distance_remaining_m;
    expect(remainingAtManeuver2).not.toBeNull();
    expect(stateAtManeuver2.next_maneuver?.street_names).toContain('Städtle');
    // Remaining distance genuinely fell between the two maneuvers (docs/07
    // §3a plausibility invariant: "Restdistanz fällt").
    expect(remainingAtManeuver2 as number).toBeLessThan(remainingAtManeuver1 as number);

    // === 7. Arrival =========================================================
    // API: the CORE declares arrival.
    await expect.poll(async () => (await apiNavState(page)).status, { timeout: 60_000 }).toBe(
      'arrived',
    );
    // UI: the drive overlay is gone again.
    await expect(page.getByTestId('maneuver-panel')).toHaveCount(0, { timeout: 15_000 });

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(tracker.getForeignUrls()).toEqual([]);
  });
});
