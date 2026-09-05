/**
 * Drive basics E2E flow (E04-T3, docs/07 §5 Flow 2's turn-by-turn portion):
 * a simulated drive along a synthetic route with two closely-spaced maneuvers
 * and a speed-limit segment gap, asserting:
 *  1. The maneuver panel steps through maneuvers correctly as progress
 *     advances, distance counts down.
 *  2. Announcements (`nav/instruction`) fire while approaching, exactly once
 *     per threshold, and the "Jetzt"/immediate one is reached right before
 *     the turn.
 *  3. The following-maneuver preview shows for a densely-spaced turn (< 300 m
 *     gap) and hides once the gap is >= 300 m.
 *  4. The speed-limit sign is hidden while the limit is unknown (null, a
 *     genuine gap in `speed_limits`) and appears/updates at the segment
 *     boundary -- never shows "0".
 *  5. Everything disappears again once the drive ends (arrival).
 *
 * No real Valhalla/geocoder is available in this harness (same constraint
 * `routing.spec.ts`/`search.spec.ts` document), so the route is POSTed
 * directly to `POST /api/v1/navigation/start` (which accepts a full `route`
 * object, no cache lookup needed) and progress is driven with exact
 * `Position` fixes to `/api/v1/position/browser` -- the same "drive the Core
 * directly with synthetic fixes" approach `search.spec.ts`'s speed-lock test
 * and `gps-loss.spec.ts` already establish for this codebase's nav-ish e2e.
 *
 * Runs against its own dedicated core (DRIVE_CORE_BASE_URL, see
 * constants.ts) so an unrelated parallel spec's browser fix can never land
 * in the middle of this test's exact position sequence.
 */

import { test, expect, type Page } from '@playwright/test';
import type { Route } from '@yapaja/shared';
import { encodePolyline6, type LatLon } from '../../core/src/routing/polyline.js';
import { DRIVE_CORE_BASE_URL } from './support/constants.js';
import { collectPageErrors, trackRequests } from './support/network.js';

const BASE_LAT = 47.2;
const BASE_LON = 9.6;
/** WGS84 average meters-per-degree-latitude -- good enough for a due-north test route. */
const M_PER_DEG_LAT = 111_195;

function latForProgressM(progressM: number): number {
  return BASE_LAT + progressM / M_PER_DEG_LAT;
}

// 11 vertices, ~111.2 m apart -> ~1112 m total, straight due north.
const ROUTE_POINTS: LatLon[] = Array.from({ length: 11 }, (_, i) => ({
  lat: latForProgressM(i * (M_PER_DEG_LAT * 0.001)),
  lon: BASE_LON,
}));
const TOTAL_LENGTH_M = 10 * (M_PER_DEG_LAT * 0.001); // ~1111.95 m

const ROUTE: Route = {
  id: 'drive-e2e-route',
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
      distance_m: 5 * (M_PER_DEG_LAT * 0.001), // ~556 m to maneuver 1
      begin_shape_index: 0,
    },
    {
      index: 1,
      type: 'turn_left',
      instruction: 'Links abbiegen auf die Seestraße',
      street_names: ['Seestraße'],
      distance_m: 1 * (M_PER_DEG_LAT * 0.001), // ~111 m to maneuver 2 -- dense turn (< 300 m)
      begin_shape_index: 5,
    },
    {
      index: 2,
      type: 'turn_right',
      instruction: 'Rechts abbiegen auf den Bergweg',
      street_names: ['Bergweg'],
      distance_m: 4 * (M_PER_DEG_LAT * 0.001), // ~445 m to the route end -- NOT dense (>= 300 m)
      begin_shape_index: 6,
    },
  ],
  // Deliberately only covers the SECOND half -- the first half is a genuine
  // gap (speed_limit_kmh must read null/hidden there, never fabricate 0).
  speed_limits: [{ begin_shape_index: 5, end_shape_index: 10, kmh: 80 }],
  warnings: [],
};

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

/** Posts one exact fix and waits out the Core's 1 Hz publish throttle so it's never coalesced away. */
async function driveTo(page: Page, progressM: number, speedMs = 3): Promise<void> {
  const response = await page.request.post(`${DRIVE_CORE_BASE_URL}/api/v1/position/browser`, {
    data: browserFixBody(progressM, speedMs),
  });
  expect(response.ok()).toBe(true);
  await page.waitForTimeout(1100); // clears the 1 Hz throttle window before the NEXT post
}

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapajaMapController?.getMap?.()), undefined, {
    timeout: 15_000,
  });
}

async function getManeuverDistanceM(page: Page): Promise<number> {
  const text = await page.getByTestId('maneuver-distance').textContent();
  expect(text).not.toBeNull();
  const match = /([\d.,]+)\s*(km|m)/.exec(text ?? '');
  expect(match).not.toBeNull();
  const [, numStr, unit] = match!;
  const num = Number(numStr.replace(',', '.'));
  return unit === 'km' ? num * 1000 : num;
}

async function instructionSeq(page: Page): Promise<number> {
  return page.evaluate(() => window.__yapajaNavStore?.getState().instructionSeq ?? 0);
}

test.describe('Drive basics (E04-T3, Flow 2)', () => {
  test.describe.configure({ mode: 'serial' }); // one shared drive core, one navigation session at a time

  test.afterEach(async ({ page }) => {
    await page
      .evaluate(async (baseUrl: string) => {
        await fetch(`${baseUrl}/api/v1/navigation/stop`, { method: 'POST' });
      }, DRIVE_CORE_BASE_URL)
      .catch(() => {
        // Best-effort cleanup.
      });
  });

  test('maneuver panel steps through maneuvers, distance counts down, announcements fire, speed sign updates/hides', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const tracker = await trackRequests(page, DRIVE_CORE_BASE_URL);
    const pageErrors = collectPageErrors(page);
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(DRIVE_CORE_BASE_URL + '/');
    await waitForMapReady(page);

    // Start navigation directly against the Core (no live Valhalla/geocoder
    // in this harness -- see file-level comment).
    const startResponse = await page.request.post(`${DRIVE_CORE_BASE_URL}/api/v1/navigation/start`, {
      data: { route: ROUTE, destination: { latlng: ROUTE_POINTS[10], name: 'Ziel' } },
    });
    expect(startResponse.ok()).toBe(true);

    // The web app started this navigation via a raw REST call (no live
    // Valhalla/geocoder to drive the normal "Route hierhin" flow through --
    // see the file-level comment), so its OWN routing store never learned
    // this route. `ManeuverPanel`'s "following maneuver" preview needs the
    // full route (to look up maneuver `index + 1`), the same way it would if
    // this navigation had instead been started the normal way (E04-T5) with
    // the routing store already populated from "Route hierhin" -- seed it
    // directly so this test exercises that lookup for real.
    await page.evaluate((route: Route) => {
      window.__yapajaRoutingStore?.setState({ routes: [route], activeRouteId: route.id });
    }, ROUTE);

    // -- W1 (~111 m): approaching maneuver 1 (Seestraße), first threshold(s) fire.
    await driveTo(page, 111);
    await expect(page.getByTestId('maneuver-panel')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('maneuver-street')).toHaveText('Seestraße');
    await expect(page.getByTestId('maneuver-arrow').first()).toHaveAttribute('data-arrow-key', 'turn_left');
    // Dense turn (111 m to the next one, < 300 m): following-maneuver preview shown.
    await expect(page.getByTestId('maneuver-following')).toBeVisible();
    await expect(page.getByTestId('maneuver-following')).toContainText('Bergweg');
    // Speed limit: first half of the route has no covering segment -> hidden, never "0".
    await expect(page.getByTestId('speed-limit-sign')).toHaveCount(0);
    await expect
      .poll(() => instructionSeq(page), { timeout: 5_000 })
      .toBeGreaterThanOrEqual(1);
    const distanceAtW1 = await getManeuverDistanceM(page);

    // -- W2 (~445 m): distance to maneuver 1 has counted down; another threshold fires.
    const seqBeforeW2 = await instructionSeq(page);
    await driveTo(page, 445);
    const distanceAtW2 = await getManeuverDistanceM(page);
    expect(distanceAtW2).toBeLessThan(distanceAtW1);
    await expect.poll(() => instructionSeq(page), { timeout: 5_000 }).toBeGreaterThan(seqBeforeW2);
    await expect(page.getByTestId('speed-limit-sign')).toHaveCount(0); // still in the gap (< 556 m)

    // -- W3 (~545 m): right before the turn -- the immediate ("Jetzt") announcement.
    const seqBeforeW3 = await instructionSeq(page);
    await driveTo(page, 545);
    const distanceAtW3 = await getManeuverDistanceM(page);
    expect(distanceAtW3).toBeLessThan(distanceAtW2);
    await expect.poll(() => instructionSeq(page), { timeout: 5_000 }).toBeGreaterThan(seqBeforeW3);
    const sayAtW3 = await page.evaluate(() => window.__yapajaNavStore?.getState().lastInstruction?.say ?? '');
    expect(sayAtW3.startsWith('Jetzt')).toBe(true);
    expect(sayAtW3).toContain('Seestraße');

    // -- W4 (~600 m): past maneuver 1 -> maneuver 2 (Bergweg) is now active.
    // Not a dense turn (445 m to the route end) -> no following-maneuver preview.
    // Past the 556 m boundary -> speed-limit sign appears at 80.
    const seqBeforeW4 = await instructionSeq(page);
    await driveTo(page, 600);
    await expect(page.getByTestId('maneuver-street')).toHaveText('Bergweg', { timeout: 5_000 });
    await expect(page.getByTestId('maneuver-arrow').first()).toHaveAttribute('data-arrow-key', 'turn_right');
    await expect(page.getByTestId('maneuver-following')).toHaveCount(0);
    await expect(page.getByTestId('speed-limit-sign')).toBeVisible();
    await expect(page.getByTestId('speed-limit-value')).toHaveText('80');
    await expect.poll(() => instructionSeq(page), { timeout: 5_000 }).toBeGreaterThan(seqBeforeW4);
    const newInstructionManeuverIndex = await page.evaluate(
      () => window.__yapajaNavStore?.getState().lastInstruction?.maneuver.index ?? null,
    );
    expect(newInstructionManeuverIndex).toBe(2); // maneuver 1 never announces again after being passed

    // -- W5: arrival -- everything disappears again.
    await driveTo(page, TOTAL_LENGTH_M - 5, 0);
    await expect(page.getByTestId('maneuver-panel')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('speed-limit-sign')).toHaveCount(0);
    const finalStatus = await page.evaluate(() => window.__yapajaNavStore?.getState().navState?.status ?? null);
    expect(finalStatus).toBe('arrived');

    // TTS toggle exists and is togglable while a drive was active (checked
    // before arrival hid the overlay would also work, but re-verifying the
    // control itself never crashed the page is the point here).
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(tracker.getForeignUrls()).toEqual([]);
  });

  test('TTS toggle flips state and never throws (Web Speech availability-guarded, gong fallback otherwise)', async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const pageErrors = collectPageErrors(page);

    await page.goto(DRIVE_CORE_BASE_URL + '/');
    await waitForMapReady(page);

    const startResponse = await page.request.post(`${DRIVE_CORE_BASE_URL}/api/v1/navigation/start`, {
      data: { route: ROUTE, destination: { latlng: ROUTE_POINTS[10], name: 'Ziel' } },
    });
    expect(startResponse.ok()).toBe(true);
    await driveTo(page, 50);

    const toggle = page.getByTestId('tts-toggle');
    await expect(toggle).toBeVisible({ timeout: 5_000 });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    // Whichever path this browser takes (real speech synthesis vs. the
    // WebAudio gong fallback), it must never throw -- the availability check
    // itself is exposed for direct inspection.
    const speechAvailable = await page.evaluate(() => window.__yapajaSpeechAvailable?.() ?? null);
    expect(typeof speechAvailable).toBe('boolean');

    expect(pageErrors).toEqual([]);
  });
  /**
   * ─── EIN KARTENTIPPER DARF DIE LAUFENDE ROUTE NICHT VERWERFEN ────────────
   * Gemeldet: „Wenn die Navigation aktiv ist und man auf die Karte klickt,
   * dann wird in den Zielsetzen-Modus gewechselt. Die Route verschwindet und
   * man sieht den roten Zielpunkt auf der Stelle."
   *
   * `DestinationSelector.handlePick` endete bedingungslos mit
   * `setDestination` -- jeder Tipper waehrend der Fahrt, auch ein
   * verrutschter Schwenk, ersetzte die Route durch einen Zielpunkt.
   *
   * Die REGEL steht in `mapTapIntent.test.ts`. Hier wird die VERDRAHTUNG
   * geprueft: dass der Kartenlistener den Navigationszustand ueberhaupt
   * liest. Genau das kann ein Unit-Test nicht zeigen -- und genau solche
   * Luecken sind in diesem Projekt schon mehrfach durchgerutscht.
   */
  test('ein Kartentipper waehrend der Fahrt laesst Route und Ziel unangetastet', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.goto(DRIVE_CORE_BASE_URL + '/');
    await waitForMapReady(page);

    const startResponse = await page.request.post(`${DRIVE_CORE_BASE_URL}/api/v1/navigation/start`, {
      data: { route: ROUTE, destination: { latlng: ROUTE_POINTS[10], name: 'Ziel' } },
    });
    expect(startResponse.ok()).toBe(true);

    await page.evaluate((route: Route) => {
      window.__yapajaRoutingStore?.setState({ routes: [route], activeRouteId: route.id });
    }, ROUTE);

    await driveTo(page, 111);
    await expect(page.getByTestId('maneuver-panel')).toBeVisible({ timeout: 5_000 });

    const before = await page.evaluate(() => {
      const s = window.__yapajaRoutingStore?.getState();
      return { routes: s?.routes?.length ?? 0, activeRouteId: s?.activeRouteId ?? null };
    });
    expect(before.routes).toBe(1);

    // Mitten auf die Karte tippen -- weit weg von der Routenlinie, genau die
    // Geste aus der Meldung.
    const canvas = page.locator('canvas.maplibregl-canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width * 0.25, box!.y + box!.height * 0.75);
    // Kurz warten: waere der Fehler noch da, braeuchte er nur einen Tick.
    await page.waitForTimeout(500);

    const after = await page.evaluate(() => {
      const s = window.__yapajaRoutingStore?.getState();
      return {
        routes: s?.routes?.length ?? 0,
        activeRouteId: s?.activeRouteId ?? null,
        destination: s?.destination ?? null,
      };
    });

    // Die Route steht noch, und es wurde KEIN Ziel gesetzt.
    expect(after.routes).toBe(1);
    expect(after.activeRouteId).toBe(before.activeRouteId);
    expect(after.destination).toBeNull();
    // Und die Fahrt laeuft weiter -- das Panel ist noch da.
    await expect(page.getByTestId('maneuver-panel')).toBeVisible();
  });
});
