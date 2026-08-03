/**
 * docs/07 §5 — FLOW 5: "Profilwechsel während Navigation ⇒ Reroute +
 * Warnbanner." (E06-T3.)
 *
 * Canonical proof for flow 5. See `e2e/FLOWS.md` for the full flow→spec table.
 *
 * E10-T1 additions: the end state is now also read back from the Core's own
 * REST API (`GET /api/v1/navigation/state`, `GET /api/v1/profiles`), not only
 * from the browser stores -- the task's plausibility requirement.
 *
 * `nav-control.spec.ts` shipped a "Flow 5 (prepared)" smoke test (E04-T5) that
 * only proved a mid-navigation profile change didn't crash the app -- the
 * real reroute coupling was explicitly out of that task's scope. This spec
 * implements the real thing:
 *  1. a UI client is connected (this very page, via the nav WS) -> switching
 *     the active profile mid-navigation shows the "Mit '‹name›' neu
 *     berechnen?" confirmation banner; "Ja" reroutes (`route/updated
 *     {reason:'profile_change'}`, a genuinely NEW route id) and, since the
 *     stub route is deliberately >15% longer, the advisory warning banner
 *     also appears;
 *  2. "Abbrechen" reactivates the PREVIOUS profile and leaves the navigation
 *     completely untouched -- no reroute request is ever sent.
 *
 * Unlike every other e2e spec's routing mock (`page.route('**\/api/v1/routes'
 * ...)`, which only intercepts the BROWSER's own fetches -- see
 * nav-control.spec.ts's file-level comment), the profile-change reroute is
 * triggered SERVER-SIDE: `NavigationService` calls `RoutingService.
 * createRoutes` from inside the Core's own Node process. This spec therefore
 * runs against a DEDICATED core (`PROFILE_REROUTE_CORE_PORT`) whose
 * `VALHALLA_URL` points at a real (stub) HTTP server this file starts/stops
 * itself (`support/valhallaStub.ts`) -- the only core in the harness
 * configured that way.
 */

import { test, expect, type Page } from '@playwright/test';
import type { Route } from '@yapaja/shared';
import { encodePolyline6, type LatLon } from '../../core/src/routing/polyline.js';
import { PROFILE_REROUTE_CORE_BASE_URL, PROFILE_REROUTE_VALHALLA_PORT } from './support/constants.js';
import { collectPageErrors, trackRequests } from './support/network.js';
import { startValhallaStub, type ValhallaStub } from './support/valhallaStub.js';

const BASE_LAT = 47.3;
const BASE_LON = 9.9;
const M_PER_DEG_LAT = 111_195;

function latForProgressM(progressM: number): number {
  return BASE_LAT + progressM / M_PER_DEG_LAT;
}

// 11 vertices, ~111.2 m apart -> ~1112 m total, straight due north.
const ROUTE_POINTS: LatLon[] = Array.from({ length: 11 }, (_, i) => ({
  lat: latForProgressM(i * (M_PER_DEG_LAT * 0.001)),
  lon: BASE_LON,
}));
const TOTAL_LENGTH_M = 10 * (M_PER_DEG_LAT * 0.001);
const INITIAL_DURATION_S = 120;

const ROUTE: Route = {
  id: 'profile-reroute-e2e-route',
  distance_m: TOTAL_LENGTH_M,
  duration_s: INITIAL_DURATION_S,
  geometry: encodePolyline6(ROUTE_POINTS),
  legs: [{ index: 0, distance_m: TOTAL_LENGTH_M, duration_s: INITIAL_DURATION_S }],
  maneuvers: [],
  speed_limits: [],
  warnings: [],
};

let valhallaStub: ValhallaStub;

test.beforeAll(async () => {
  valhallaStub = await startValhallaStub(PROFILE_REROUTE_VALHALLA_PORT);
});

test.afterAll(async () => {
  await valhallaStub.close();
});

interface CreatedProfile {
  id: string;
  name: string;
}

async function createProfile(page: Page, name: string, dims: Partial<{ height_m: number; weight_t: number }> = {}): Promise<CreatedProfile> {
  const response = await page.request.post(`${PROFILE_REROUTE_CORE_BASE_URL}/api/v1/profiles`, {
    data: {
      name,
      height_m: dims.height_m ?? 2.5,
      width_m: 2.1,
      length_m: 6.5,
      weight_t: dims.weight_t ?? 3.5,
      avg_speed_kmh: 80,
      hazmat: false,
      avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
    },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { data: CreatedProfile };
  return { id: body.data.id, name };
}

async function activateProfileViaApi(page: Page, id: string): Promise<void> {
  const response = await page.request.put(`${PROFILE_REROUTE_CORE_BASE_URL}/api/v1/profiles/${id}/activate`);
  expect(response.ok()).toBe(true);
}

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapajaMapController?.getMap?.()), undefined, {
    timeout: 15_000,
  });
}

async function waitForWsConnected(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__yapajaNavStore?.getState().isConnected ?? false), {
      timeout: 10_000,
    })
    .toBe(true);
}

function browserFixBody(progressM: number): Record<string, unknown> {
  return {
    lat: latForProgressM(progressM),
    lon: BASE_LON,
    alt: null,
    speed: 3,
    heading: 0,
    accuracy: 5,
    fix: '3d',
    ts: new Date().toISOString(),
  };
}

/** Posts one exact fix and waits out the Core's 1 Hz publish throttle. */
async function driveTo(page: Page, progressM: number): Promise<void> {
  const response = await page.request.post(`${PROFILE_REROUTE_CORE_BASE_URL}/api/v1/position/browser`, {
    data: browserFixBody(progressM),
  });
  expect(response.ok()).toBe(true);
  await page.waitForTimeout(1100);
}

async function navStatus(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__yapajaNavStore?.getState().navState?.status ?? null);
}

async function navRouteId(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__yapajaNavStore?.getState().navState?.route_id ?? null);
}

async function activeProfileId(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__yapajaProfileStore?.getState().activeProfile?.id ?? null);
}

test.describe('E06-T3 Flow 5: profile change during navigation -> reroute coupling', () => {
  test.describe.configure({ mode: 'serial' }); // one shared Core, one navigation session at a time

  test.afterEach(async ({ page }) => {
    await page
      .evaluate(async (baseUrl: string) => {
        await fetch(`${baseUrl}/api/v1/navigation/stop`, { method: 'POST' });
      }, PROFILE_REROUTE_CORE_BASE_URL)
      .catch(() => {
        // Best-effort cleanup.
      });
  });

  test('[Flow 5] Ja: shows the confirmation banner, reroutes onto a NEW route, and shows the >15% warning banner', async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const tracker = await trackRequests(page, PROFILE_REROUTE_CORE_BASE_URL);
    const pageErrors = collectPageErrors(page);
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const profileA = await createProfile(page, 'E2E Flow5 Camper');
    const profileB = await createProfile(page, 'E2E Flow5 Alkoven 7,5t', { height_m: 3.4, weight_t: 7.5 });
    await activateProfileViaApi(page, profileA.id);

    await page.goto(PROFILE_REROUTE_CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await waitForWsConnected(page);

    const startResponse = await page.request.post(`${PROFILE_REROUTE_CORE_BASE_URL}/api/v1/navigation/start`, {
      data: { route: ROUTE, destination: { latlng: ROUTE_POINTS[10], name: 'Flow5 Ziel' } },
    });
    expect(startResponse.ok()).toBe(true);
    await driveTo(page, 100);
    await expect.poll(() => navStatus(page), { timeout: 5_000 }).toBe('navigating');

    // The stub route: same geometry, +25% duration -> over the 15% warning threshold.
    const callsBefore = valhallaStub.callCount();
    valhallaStub.setNextTrip({
      points: ROUTE_POINTS,
      lengthKm: TOTAL_LENGTH_M / 1000,
      timeS: INITIAL_DURATION_S * 1.25,
    });

    // Switch the active profile through the REAL UI (profile chip -> panel -> item).
    await page.getByTestId('profile-chip').click();
    await expect(page.getByTestId('profiles-panel')).toBeVisible();
    await expect(page.getByTestId(`profile-item-${profileB.id}`)).toBeVisible({ timeout: 5_000 });
    await page.getByTestId(`profile-item-${profileB.id}`).click();

    // Confirmation banner appears with the exact spec text.
    await expect(page.getByTestId('profile-change-confirm-banner')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('profile-change-confirm-text')).toHaveText(
      `Mit '${profileB.name}' neu berechnen?`,
    );
    // Nothing rerouted yet.
    expect(valhallaStub.callCount()).toBe(callsBefore);
    expect(await navRouteId(page)).toBe(ROUTE.id);

    await page.getByTestId('profile-change-confirm-yes').click();

    // Confirmation banner closes; a NEW route lands; the warning banner appears.
    await expect(page.getByTestId('profile-change-confirm-banner')).toHaveCount(0, { timeout: 5_000 });
    await expect
      .poll(() => navRouteId(page), { timeout: 5_000 })
      .not.toBe(ROUTE.id);
    await expect.poll(() => navStatus(page)).toBe('navigating');
    expect(valhallaStub.callCount()).toBe(callsBefore + 1);

    await expect(page.getByTestId('profile-change-warning-banner')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('profile-change-warning-banner')).toContainText('25');

    // The warning is dismissible.
    await page.getByTestId('profile-change-warning-dismiss').click();
    await expect(page.getByTestId('profile-change-warning-banner')).toHaveCount(0);

    expect(await activeProfileId(page)).toBe(profileB.id);

    // --- API side of the end state (E10-T1 plausibility requirement) --------
    // The CORE -- not just the browser store -- is navigating a genuinely new
    // route, and the newly activated profile is the active one server-side.
    const apiNav = (await (
      await page.request.get(`${PROFILE_REROUTE_CORE_BASE_URL}/api/v1/navigation/state`)
    ).json()) as { data: { status: string; route_id: string | null } };
    expect(apiNav.data.status).toBe('navigating');
    expect(apiNav.data.route_id).not.toBe(ROUTE.id);
    expect(apiNav.data.route_id).toBe(await navRouteId(page)); // API and UI agree

    const apiProfiles = (await (
      await page.request.get(`${PROFILE_REROUTE_CORE_BASE_URL}/api/v1/profiles`)
    ).json()) as { data: Array<{ id: string; is_active: boolean }> };
    const apiActive = apiProfiles.data.find((p) => p.is_active);
    expect(apiActive?.id).toBe(profileB.id);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(tracker.getForeignUrls()).toEqual([]);
  });

  test('[Flow 5] Abbrechen: reactivates the previous profile, no reroute, navigation untouched', async ({ page }) => {
    test.setTimeout(30_000);
    const pageErrors = collectPageErrors(page);

    const profileA = await createProfile(page, 'E2E Flow5 Cancel Ausgangsprofil');
    const profileB = await createProfile(page, 'E2E Flow5 Cancel Neues Profil', { height_m: 3.4, weight_t: 7.5 });
    await activateProfileViaApi(page, profileA.id);

    await page.goto(PROFILE_REROUTE_CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await waitForWsConnected(page);

    const startResponse = await page.request.post(`${PROFILE_REROUTE_CORE_BASE_URL}/api/v1/navigation/start`, {
      data: { route: ROUTE, destination: { latlng: ROUTE_POINTS[10], name: 'Flow5 Cancel Ziel' } },
    });
    expect(startResponse.ok()).toBe(true);
    await driveTo(page, 100);
    await expect.poll(() => navStatus(page), { timeout: 5_000 }).toBe('navigating');

    const callsBefore = valhallaStub.callCount();
    // No trip configured for this test -- if a reroute were (wrongly) attempted, it would 400.

    await page.getByTestId('profile-chip').click();
    await expect(page.getByTestId('profiles-panel')).toBeVisible();
    await page.getByTestId(`profile-item-${profileB.id}`).click();

    await expect(page.getByTestId('profile-change-confirm-banner')).toBeVisible({ timeout: 5_000 });
    expect(await activeProfileId(page)).toBe(profileB.id); // the activation itself DID happen

    await page.getByTestId('profile-change-confirm-cancel').click();

    await expect(page.getByTestId('profile-change-confirm-banner')).toHaveCount(0, { timeout: 5_000 });
    // Reverted to the PREVIOUS profile.
    await expect.poll(() => activeProfileId(page), { timeout: 5_000 }).toBe(profileA.id);

    // Exact prior state: same route, still navigating, no reroute attempt made.
    expect(await navRouteId(page)).toBe(ROUTE.id);
    expect(await navStatus(page)).toBe('navigating');
    expect(valhallaStub.callCount()).toBe(callsBefore);
    await expect(page.getByTestId('profile-change-warning-banner')).toHaveCount(0);

    // --- API side of the end state (E10-T1) ---------------------------------
    // Server-side the session is untouched (same route, still navigating) and
    // the PREVIOUS profile is active again.
    const apiNav = (await (
      await page.request.get(`${PROFILE_REROUTE_CORE_BASE_URL}/api/v1/navigation/state`)
    ).json()) as { data: { status: string; route_id: string | null } };
    expect(apiNav.data.status).toBe('navigating');
    expect(apiNav.data.route_id).toBe(ROUTE.id);

    const apiProfiles = (await (
      await page.request.get(`${PROFILE_REROUTE_CORE_BASE_URL}/api/v1/profiles`)
    ).json()) as { data: Array<{ id: string; is_active: boolean }> };
    expect(apiProfiles.data.find((p) => p.is_active)?.id).toBe(profileA.id);

    expect(pageErrors).toEqual([]);
  });
});
