/**
 * docs/07 §5 — FLOW 4: "GPS-Verlust 45 s ⇒ UI-Zustand 'Signal verloren' ⇒
 * Wiederaufnahme nahtlos." (E02-T5, W-01.)
 *
 * Canonical proof for flow 4. See `e2e/FLOWS.md` for the full flow→spec table.
 *
 * E10-T1 changes: the outage is now the SPEC'S 45 seconds (previously 6),
 * expressed in SIMULATED time and compressed onto the wall clock with
 * `speed_factor` so the test stays fast and deterministic; the
 * `waitForTimeout(1500)` sleep that used to stand in for "not yet" is gone,
 * replaced by an atomic store+DOM snapshot; and the end state is now also
 * asserted through the Core's REST API, not the browser store alone.
 *
 * Drives the GPS simulator with an `outage` mutation and asserts:
 * 1. No premature "GPS-Signal verloren" banner while fixes are still fresh.
 * 2. The banner appears once no real fix has arrived for >3s.
 * 3. The banner disappears again as soon as playback resumes (a real fix
 *    returns).
 * 4. The store never received a `pos/extrapolated` fix during the outage
 *    (`noopDeadReckoningProvider` is wired in production until E04-T6 ships
 *    the real route-based math) -- "no active route" means the puck freezes
 *    rather than guessing.
 * 5. The puck's paint config uses MapLibre `*-transition`, so the
 *    gray -> blue recovery never hard-snaps ("kein Teleport-Flackern").
 *
 * Runs against its own dedicated core (SIMULATOR_CORE_BASE_URL) -- forcing
 * the simulator as active position source would otherwise race the other
 * specs sharing CORE_BASE_URL (`fullyParallel: true`); see the
 * SIMULATOR_CORE_PORT comment in support/constants.ts.
 */

import { test, expect, type Page } from '@playwright/test';
import { SIMULATOR_CORE_BASE_URL } from './support/constants.js';
import { collectPageErrors } from './support/network.js';

const BANNER_TEXT = /GPS-Signal verloren/;

/** The flow's own number: 45 SIMULATED seconds without a fix. */
const OUTAGE_DURATION_S = 45;
/**
 * Wall-clock compression. `speed_factor: 5` turns the 45 simulated seconds of
 * outage into 9 s of real time -- still 3x the product's 3 s
 * `GPS_SIGNAL_LOST_THRESHOLD_MS`, so the banner genuinely has to appear, but
 * without spending 45 s of CI wall clock on a sleep. This is exactly the
 * "Simulator statt Echtzeit (speed_factor)" determinism the task requires.
 */
const SPEED_FACTOR = 5;
const OUTAGE_AT_S = 5;

async function startSimulatorOutage(page: Page): Promise<void> {
  const status = await page.evaluate(
    async ({ baseUrl, atS, durationS, speedFactor }) => {
      const response = await fetch(`${baseUrl}/api/v1/simulator/play`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          track: { gpxId: 'city' },
          speed_factor: speedFactor,
          mutations: { outage: { at_s: atS, duration_s: durationS } },
        }),
      });
      return response.status;
    },
    {
      baseUrl: SIMULATOR_CORE_BASE_URL,
      atS: OUTAGE_AT_S,
      durationS: OUTAGE_DURATION_S,
      speedFactor: SPEED_FACTOR,
    },
  );
  expect(status).toBe(200);
}

test.describe('GPS loss (W-01)', () => {
  // Both tests drive the ONE shared simulator core (SIMULATOR_CORE_BASE_URL)
  // and its single global simulator; `fullyParallel: true` would otherwise
  // run them on separate workers at once, so one test's `simulator/stop`
  // (afterEach) races the other's playback. Serial keeps simulator control
  // to one test at a time.
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.goto(SIMULATOR_CORE_BASE_URL + '/');
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(() => Boolean(window.__yapajaMapController?.getMap?.()));
  });

  test.afterEach(async ({ page }) => {
    await page
      .evaluate(async (baseUrl: string) => {
        await fetch(`${baseUrl}/api/v1/simulator/stop`, { method: 'POST' });
      }, SIMULATOR_CORE_BASE_URL)
      .catch(() => {
        // Best-effort cleanup; a failure here must not fail the test itself.
      });
  });

  test('[Flow 4] 45 s GPS outage: no premature banner, "Signal verloren" while lost, seamless resumption', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const pageErrors = collectPageErrors(page);

    await startSimulatorOutage(page);

    // Fixes are genuinely flowing first (otherwise "no premature banner"
    // below would be vacuously true on a simulator that never started).
    await expect
      .poll(
        () => page.evaluate(() => window.__yapajaPositionStore?.getState().position !== null),
        { timeout: 20_000 },
      )
      .toBe(true);

    // NO PREMATURE BANNER -- asserted without a sleep. The store's
    // `lastRealUpdateTime` and the banner's presence are read in ONE
    // `page.evaluate`, so they cannot drift apart between the two reads: if
    // the last real fix is younger than the product's own 3 s threshold, the
    // banner must not be on screen. (The previous version slept 1.5 s and
    // hoped, which is precisely the wall-clock coupling E10-T1 removes.)
    const freshSnapshot = await page.evaluate(() => {
      const lastRealUpdateTime = window.__yapajaPositionStore?.getState().lastRealUpdateTime ?? null;
      return {
        msSinceLastFix: lastRealUpdateTime === null ? null : Date.now() - lastRealUpdateTime,
        bannerPresent: Boolean(document.querySelector('[data-testid="gps-loss-banner"]')),
      };
    });
    expect(freshSnapshot.msSinceLastFix).not.toBeNull();
    if ((freshSnapshot.msSinceLastFix as number) < 3_000) {
      expect(freshSnapshot.bannerPresent).toBe(false);
    }

    // Banner shows once the signal has been lost for > 3 s. The outage runs
    // for 45 simulated seconds (9 s wall at speed_factor 5), so this lands
    // comfortably inside it.
    await expect(page.getByText(BANNER_TEXT)).toBeVisible({ timeout: 20_000 });

    // While lost, the store must reflect a REAL signal loss, not a
    // dead-reckoned guess -- with no active route (noopDeadReckoningProvider,
    // E04-T6 ships the real math), `pos/extrapolated` must never have fired.
    const extrapolatedWhileLost = await page.evaluate(
      () => window.__yapajaPositionStore?.getState().extrapolated ?? null,
    );
    expect(extrapolatedWhileLost).toBe(false);

    // Playback resumes after the outage window -> a real fix returns ->
    // banner disappears again.
    await expect(page.getByText(BANNER_TEXT)).toBeHidden({ timeout: 15_000 });

    const stateAfterRecovery = await page.evaluate(() => {
      const s = window.__yapajaPositionStore?.getState();
      return s ? { extrapolated: s.extrapolated, hasPosition: s.position !== null } : null;
    });
    expect(stateAfterRecovery).toEqual({ extrapolated: false, hasPosition: true });

    // --- API side of the end state (plausibility requirement) ---------------
    // "Wiederaufnahme nahtlos" must be true of the CORE too, not just of the
    // browser store: the simulator is still the active source and still
    // playing (it never had to be restarted), and the Core's last known
    // position is a real, fresh simulator fix.
    const simulatorStatus = (await (
      await page.request.get(`${SIMULATOR_CORE_BASE_URL}/api/v1/simulator/status`)
    ).json()) as { data: { state: string; tickS: number; speedFactor: number } };
    expect(simulatorStatus.data.state).toBe('playing');
    expect(simulatorStatus.data.speedFactor).toBe(SPEED_FACTOR);
    // Playback continued straight through the outage rather than restarting.
    expect(simulatorStatus.data.tickS).toBeGreaterThan(OUTAGE_AT_S + OUTAGE_DURATION_S);

    const positionResponse = await page.request.get(`${SIMULATOR_CORE_BASE_URL}/api/v1/position`);
    expect(positionResponse.status()).toBe(200);
    const corePosition = (await positionResponse.json()) as { source: string; ts: string };
    expect(corePosition.source).toBe('simulator');
    expect(Number.isFinite(Date.parse(corePosition.ts))).toBe(true);

    expect(pageErrors).toEqual([]);
  });

  test('[Flow 4] puck layers configure MapLibre paint transitions (no hard color snap on recovery)', async ({ page }) => {
    // The puck source/layers are added on the map's `load` event (see
    // PositionPuck's style-readiness guard), which can land slightly after
    // the canvas is visible. Wait for the layer before querying its paint.
    await page.waitForFunction(
      () => Boolean(window.__yapajaMapController?.getMap()?.getLayer('position-puck-layer')),
      undefined,
      { timeout: 10_000 },
    );

    const transitions = await page.evaluate(() => {
      const map = window.__yapajaMapController?.getMap();
      if (!map) return null;
      return {
        puckColor: map.getPaintProperty('position-puck-layer', 'circle-color-transition'),
        ringColor: map.getPaintProperty('position-puck-layer-ring', 'circle-color-transition'),
      };
    });

    expect(transitions?.puckColor).toEqual({ duration: 600, delay: 0 });
    expect(transitions?.ringColor).toEqual({ duration: 600, delay: 0 });
  });
});
