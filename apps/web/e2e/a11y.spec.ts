/**
 * axe-core accessibility scan (E07-T4, docs/06 §7): both modes (explore +
 * drive) x both themes (light + dark) -> no `serious`/`critical` violations.
 *
 * Drive mode is reached the same way `drive.spec.ts`/`nav-control.spec.ts`
 * do (POST a synthetic route + position fixes directly at the Core, no live
 * Valhalla/geocoder in this harness). Dark mode is forced via
 * `window.__yapajaThemeStore` -> `getState().setMode('dark')` (mirrors
 * `theme.spec.ts`'s own direct-store-mutation pattern), against this spec's
 * OWN dedicated core (`A11Y_CORE_BASE_URL`) so persisting the theme mode
 * here can never leak into another parallel spec sharing a port.
 */

import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Route } from '@yapaja/shared';
import { encodePolyline6, type LatLon } from '../../core/src/routing/polyline.js';
import { A11Y_CORE_BASE_URL } from './support/constants.js';

const BASE_LAT = 47.25;
const BASE_LON = 9.35;
const M_PER_DEG_LAT = 111_195;

function latForProgressM(progressM: number): number {
  return BASE_LAT + progressM / M_PER_DEG_LAT;
}

const ROUTE_POINTS: LatLon[] = Array.from({ length: 11 }, (_, i) => ({
  lat: latForProgressM(i * (M_PER_DEG_LAT * 0.001)),
  lon: BASE_LON,
}));
const TOTAL_LENGTH_M = 10 * (M_PER_DEG_LAT * 0.001);

const ROUTE: Route = {
  id: 'a11y-e2e-route',
  distance_m: TOTAL_LENGTH_M,
  duration_s: 120,
  geometry: encodePolyline6(ROUTE_POINTS),
  legs: [{ index: 0, distance_m: TOTAL_LENGTH_M, duration_s: 120 }],
  maneuvers: [
    {
      index: 0,
      type: 'continue',
      instruction: 'Der Straße folgen',
      street_names: ['Teststraße'],
      distance_m: TOTAL_LENGTH_M,
      begin_shape_index: 0,
    },
  ],
  speed_limits: [{ begin_shape_index: 0, end_shape_index: 10, kmh: 80 }],
  warnings: [],
};

function browserFixBody(speedMs: number, progressM = 0): Record<string, unknown> {
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

async function postSpeed(page: Page, speedMs: number, progressM = 0): Promise<void> {
  const response = await page.request.post(`${A11Y_CORE_BASE_URL}/api/v1/position/browser`, {
    data: browserFixBody(speedMs, progressM),
  });
  expect(response.ok()).toBe(true);
  await page.waitForTimeout(1100);
}

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapajaMapController?.getMap?.()), undefined, {
    timeout: 15_000,
  });
}

async function enterDriveMode(page: Page): Promise<void> {
  const startResponse = await page.request.post(`${A11Y_CORE_BASE_URL}/api/v1/navigation/start`, {
    data: { route: ROUTE, destination: { latlng: ROUTE_POINTS[10], name: 'A11y Ziel' } },
  });
  expect(startResponse.ok()).toBe(true);
  await postSpeed(page, 15, 50); // real speed -> maneuver panel + drive controls render
  await expect(page.getByTestId('drive-controls')).toBeVisible({ timeout: 5_000 });
}

async function setDarkTheme(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__yapajaThemeStore?.getState().setMode('dark');
  });
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);
}

interface AxeViolationSummary {
  id: string;
  impact: string | null | undefined;
  help: string;
  nodes: number;
}

function seriousOrCritical(violations: Array<{ id: string; impact?: string | null; help: string; nodes: unknown[] }>): AxeViolationSummary[] {
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length }));
}

test.describe('axe-core accessibility scan (E07-T4)', () => {
  test.describe.configure({ mode: 'serial' }); // shared core, dark-mode PATCH + nav state must not race other tests

  test.afterEach(async ({ page }) => {
    await page
      .evaluate(async (baseUrl: string) => {
        await fetch(`${baseUrl}/api/v1/navigation/stop`, { method: 'POST' });
      }, A11Y_CORE_BASE_URL)
      .catch(() => {
        // Best-effort cleanup.
      });
  });

  test('explore mode, light theme: no serious/critical violations', async ({ page }) => {
    await page.goto(A11Y_CORE_BASE_URL + '/');
    await waitForMapReady(page);

    const results = await new AxeBuilder({ page }).analyze();
    const found = seriousOrCritical(results.violations);
    expect(found, JSON.stringify(found, null, 2)).toEqual([]);
  });

  test('explore mode, dark theme: no serious/critical violations', async ({ page }) => {
    await page.goto(A11Y_CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await setDarkTheme(page);

    const results = await new AxeBuilder({ page }).analyze();
    const found = seriousOrCritical(results.violations);
    expect(found, JSON.stringify(found, null, 2)).toEqual([]);
  });

  test('drive mode, light theme: no serious/critical violations', async ({ page }) => {
    await page.goto(A11Y_CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await enterDriveMode(page);

    const results = await new AxeBuilder({ page }).analyze();
    const found = seriousOrCritical(results.violations);
    expect(found, JSON.stringify(found, null, 2)).toEqual([]);
  });

  test('drive mode, dark theme: no serious/critical violations', async ({ page }) => {
    await page.goto(A11Y_CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await setDarkTheme(page);
    await enterDriveMode(page);

    const results = await new AxeBuilder({ page }).analyze();
    const found = seriousOrCritical(results.violations);
    expect(found, JSON.stringify(found, null, 2)).toEqual([]);
  });
});
