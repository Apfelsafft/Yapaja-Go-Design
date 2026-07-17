/**
 * Widget shell E2E (E07-T1): the mandatory Playwright coverage the task
 * spec calls out --
 *   (a) widgets update LIVE during a simulated drive;
 *   (b) layout persists across reload, AND a "second device" (cleared
 *       localStorage) picks up the server-synced layout;
 *   (c) an unknown widget id in the saved layout never crashes the shell;
 *   (d) exactly ONE `/ws/v1` connection regardless of widget count.
 *
 * Runs against its own dedicated core (SHELL_CORE_BASE_URL, see
 * constants.ts) -- same "an unrelated parallel spec's fix could land mid-
 * sequence" rationale every other dedicated-port spec documents.
 *
 * The shell is mounted at `/shell.html` (a standalone entry, NOT wired into
 * `App.tsx`/`index.html` -- see `apps/web/src/shell/main.tsx`'s doc
 * comment), so this spec never touches the existing 30+ green specs'
 * `App.tsx` DOM.
 */

import { test, expect, type Page } from '@playwright/test';
import type { Route } from '@yapaja/shared';
import { encodePolyline6, type LatLon } from '../../core/src/routing/polyline.js';
import { SHELL_CORE_BASE_URL } from './support/constants.js';
import { collectPageErrors, trackRequests } from './support/network.js';

const BASE_LAT = 47.4;
const BASE_LON = 9.7;
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

const ROUTE: Route = {
  id: 'shell-e2e-route',
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
      distance_m: 6 * (M_PER_DEG_LAT * 0.001),
      begin_shape_index: 0,
    },
    {
      index: 1,
      type: 'turn_right',
      instruction: 'Rechts abbiegen auf die Zielstraße',
      street_names: ['Zielstraße'],
      distance_m: 4 * (M_PER_DEG_LAT * 0.001),
      begin_shape_index: 6,
    },
  ],
  speed_limits: [{ begin_shape_index: 6, end_shape_index: 10, kmh: 70 }],
  warnings: [],
};

function browserFixBody(progressM: number, speedMs: number): Record<string, unknown> {
  return {
    lat: latForProgressM(progressM),
    lon: BASE_LON,
    alt: 500 + progressM / 10, // varies with progress so the altitude widget has something to prove
    speed: speedMs,
    heading: 0,
    accuracy: 5,
    fix: '3d',
    ts: new Date().toISOString(),
  };
}

/** Posts one exact fix and waits out the Core's 1 Hz publish throttle so it's never coalesced away. */
async function driveTo(page: Page, progressM: number, speedMs = 15): Promise<void> {
  const response = await page.request.post(`${SHELL_CORE_BASE_URL}/api/v1/position/browser`, {
    data: browserFixBody(progressM, speedMs),
  });
  expect(response.ok()).toBe(true);
  await page.waitForTimeout(1100);
}

async function waitForShellReady(page: Page, mode: 'explore' | 'drive'): Promise<void> {
  const root = page.getByTestId('shell-root');
  await expect(root).toBeVisible({ timeout: 10_000 });
  await expect(root).toHaveAttribute('data-mode', mode);
}

test.describe('Widget shell (E07-T1)', () => {
  test.describe.configure({ mode: 'serial' }); // one shared core, one navigation session at a time

  test.afterEach(async ({ page }) => {
    await page
      .evaluate(async (baseUrl: string) => {
        await fetch(`${baseUrl}/api/v1/navigation/stop`, { method: 'POST' });
      }, SHELL_CORE_BASE_URL)
      .catch(() => {
        // Best-effort cleanup.
      });
  });

  test('(a) widgets update live during a simulated drive', async ({ page }) => {
    test.setTimeout(60_000);
    const tracker = await trackRequests(page, SHELL_CORE_BASE_URL);
    const pageErrors = collectPageErrors(page);
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${SHELL_CORE_BASE_URL}/shell.html?mode=drive`);
    await waitForShellReady(page, 'drive');

    // Nothing is navigating yet -- the drive-mode default widgets render
    // their "no data yet" placeholder, never a crash or a fabricated value.
    await expect(page.getByTestId('widget-speed-value')).toHaveText('–');

    const startResponse = await page.request.post(`${SHELL_CORE_BASE_URL}/api/v1/navigation/start`, {
      data: { route: ROUTE, destination: { latlng: ROUTE_POINTS[10], name: 'Shell E2E Ziel' } },
    });
    expect(startResponse.ok()).toBe(true);

    // W1: early in the drive, before the speed-limit segment starts.
    await driveTo(page, 100, 15); // 15 m/s = 54 km/h
    await expect(page.getByTestId('widget-speed-value')).toHaveText('54');
    await expect(page.getByTestId('widget-distance-value')).toBeVisible();
    const distanceAtW1 = await page.getByTestId('widget-distance-value').textContent();
    await expect(page.getByTestId('widget-eta-value')).not.toHaveText('–');
    await expect(page.getByTestId('widget-altitude-value')).toContainText('m');
    const altitudeAtW1 = await page.getByTestId('widget-altitude-value').textContent();
    // Maneuver panel (reused E04-T3 component) shows the first real turn.
    await expect(page.getByTestId('maneuver-panel')).toBeVisible();
    await expect(page.getByTestId('maneuver-street')).toHaveText('Zielstraße');
    // Speed-limit sign hidden -- the first half of the route has no covering segment (never fabricate "0").
    await expect(page.getByTestId('speed-limit-sign')).toHaveCount(0);

    // W2: faster, further along -- past the speed-limit segment boundary.
    await driveTo(page, 700, 25); // 25 m/s = 90 km/h
    await expect(page.getByTestId('widget-speed-value')).toHaveText('90');
    const distanceAtW2 = await page.getByTestId('widget-distance-value').textContent();
    expect(distanceAtW2).not.toBe(distanceAtW1);
    const altitudeAtW2 = await page.getByTestId('widget-altitude-value').textContent();
    expect(altitudeAtW2).not.toBe(altitudeAtW1); // altitude tracks Position.alt, which we varied with progress
    await expect(page.getByTestId('speed-limit-sign')).toBeVisible();
    await expect(page.getByTestId('speed-limit-value')).toHaveText('70');

    // W3: arrival -- the drive-only widgets go back to their placeholder.
    await driveTo(page, TOTAL_LENGTH_M - 5, 0);
    await expect(page.getByTestId('maneuver-panel')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('speed-limit-sign')).toHaveCount(0);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(tracker.getForeignUrls()).toEqual([]);
  });

  test('(d) exactly one /ws/v1 connection regardless of widget count', async ({ page }) => {
    test.setTimeout(30_000);
    const pageErrors = collectPageErrors(page);

    // Explore mode's DEFAULT layout has zero widgets (docs/06 §1 sketch has
    // no core widget placed there -- see layout.ts's doc comment).
    const exploreSockets: string[] = [];
    page.on('websocket', (ws) => exploreSockets.push(ws.url()));
    await page.goto(`${SHELL_CORE_BASE_URL}/shell.html?mode=explore`);
    await waitForShellReady(page, 'explore');
    await page.waitForTimeout(1000); // let any (incorrect) extra connections have a chance to open
    const exploreWsUrls = exploreSockets.filter((url) => url.includes('/ws/v1'));
    expect(exploreWsUrls).toHaveLength(1);

    // Drive mode's DEFAULT layout has SIX widgets (speed, eta, distance,
    // altitude, next-instruction, speed-limit) -- still exactly one connection.
    const driveSockets: string[] = [];
    page.on('websocket', (ws) => driveSockets.push(ws.url()));
    await page.goto(`${SHELL_CORE_BASE_URL}/shell.html?mode=drive`);
    await waitForShellReady(page, 'drive');
    await expect(page.getByTestId('widget-speed-value')).toBeVisible();
    await expect(page.getByTestId('widget-eta-value')).toBeVisible();
    await expect(page.getByTestId('widget-distance-value')).toBeVisible();
    await expect(page.getByTestId('widget-altitude-value')).toBeVisible();
    await page.waitForTimeout(1000);
    const driveWsUrls = driveSockets.filter((url) => url.includes('/ws/v1'));
    expect(driveWsUrls).toHaveLength(1);

    // The in-page store's own open-counter corroborates the network-level count.
    const socketOpens = await page.evaluate(() => window.__yapajaShellWsStore?.getState().socketOpens ?? -1);
    expect(socketOpens).toBe(1);

    expect(pageErrors).toEqual([]);
  });

  test('(b) layout persists across reload, and a second device (no local cache) picks up the server-synced layout', async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const pageErrors = collectPageErrors(page);

    await page.goto(`${SHELL_CORE_BASE_URL}/shell.html?mode=explore`);
    await waitForShellReady(page, 'explore');

    // Default explore layout is empty -- no clock widget yet.
    await expect(page.getByTestId('widget-clock')).toHaveCount(0);

    // Simulate what E07-T2's drag-and-drop editor will do: place a widget
    // via the layout store directly (no editor UI exists yet, out of scope).
    await page.evaluate(() => {
      window.__yapajaShellLayoutStore?.getState().setSlotWidgets('explore', 'top-bar', [
        { instanceId: 'e2e-clock', widgetId: 'clock', size: 'S' },
      ]);
    });

    // Wait for the debounced save (local + server) to land.
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem('yapaja:shell:layouts')), { timeout: 5_000 })
      .toContain('e2e-clock');
    await expect
      .poll(
        async () => {
          const serverSettings = await page.evaluate(async (baseUrl: string) => {
            const res = await fetch(`${baseUrl}/api/v1/settings`);
            return res.ok ? ((await res.json()) as { data: { layouts?: unknown } }).data.layouts ?? null : null;
          }, SHELL_CORE_BASE_URL);
          return JSON.stringify(serverSettings);
        },
        { timeout: 5_000 },
      )
      .toContain('e2e-clock');

    // Reload: same device, local cache present -- the widget survives.
    await page.reload();
    await waitForShellReady(page, 'explore');
    await expect(page.getByTestId('widget-clock')).toBeVisible();
    await expect(page.getByTestId('widget-clock-value')).toBeVisible();

    // "Second device": clear the local cache (a fresh browser/device has
    // never seen this layout), reload -- the shell falls back to the
    // server's copy (`PATCH /api/v1/settings` sync, docs E07-T1 acceptance
    // criterion 3) and the widget is STILL there, sourced purely from the Core.
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
    await waitForShellReady(page, 'explore');
    await expect(page.getByTestId('widget-clock')).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test('(c) an unknown widget id in the saved layout is skipped silently, never crashes the shell', async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const pageErrors = collectPageErrors(page);
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // First load establishes the origin so localStorage is writable.
    await page.goto(`${SHELL_CORE_BASE_URL}/shell.html?mode=explore`);
    await waitForShellReady(page, 'explore');

    // Inject a layout containing a widget id that was never registered --
    // e.g. an add-on the user has since uninstalled (docs/05 §4).
    await page.evaluate(() => {
      const layouts = {
        explore: {
          mode: 'explore',
          slots: {
            'top-bar': [
              { instanceId: 'known', widgetId: 'clock', size: 'S' },
              { instanceId: 'ghost', widgetId: 'com.example.uninstalled-addon/traffic-status', size: 'M' },
            ],
            'bottom-bar': [],
            'side-panel': [],
            'bottom-drawer': [],
            'map-overlay-tl': [],
            'map-overlay-tr': [],
            'map-overlay-bl': [],
            'map-overlay-br': [],
            settings: [],
          },
          updatedAt: Date.now(),
        },
        drive: {
          mode: 'drive',
          slots: {
            'top-bar': [],
            'bottom-bar': [],
            'side-panel': [],
            'bottom-drawer': [],
            'map-overlay-tl': [],
            'map-overlay-tr': [],
            'map-overlay-bl': [],
            'map-overlay-br': [],
            settings: [],
          },
          updatedAt: Date.now(),
        },
      };
      window.localStorage.setItem('yapaja:shell:layouts', JSON.stringify(layouts));
    });

    await page.reload();
    await waitForShellReady(page, 'explore');

    // The known widget still renders...
    await expect(page.getByTestId('widget-clock')).toBeVisible();
    // ...and the unknown one is simply absent -- no crash, no error boundary, no blank page.
    await expect(page.getByTestId('widget-com.example.uninstalled-addon/traffic-status')).toHaveCount(0);
    await expect(page.getByTestId('shell-root')).toBeVisible();

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
