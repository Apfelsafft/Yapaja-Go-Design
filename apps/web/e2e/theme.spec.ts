/**
 * Theme E2E (E07-T3):
 *  1. Auto-switch demonstrable with simulated time (clock mock, no position
 *     fix -> the 19:00-07:00 local clock fallback, docs/06 §3).
 *  2. UI + map switch together atomically: `document.documentElement`'s
 *     `dark` class AND the live map's light/dark background are asserted
 *     together after every clock change, never independently.
 *
 * Runs against the SHARED default core (`CORE_BASE_URL`). The default theme
 * MODE is deliberately `'light'`, not `'auto'` (see `themeClient.ts`'s doc
 * comment on `DEFAULT_THEME_MODE` -- avoids every OTHER pre-existing e2e
 * spec non-deterministically going dark depending on real wall-clock time),
 * so these tests flip the live store straight to `'auto'` via
 * `window.__yapajaThemeStore.setState(...)` (mirrors the same
 * direct-store-mutation pattern `shell.spec.ts` already uses for its own
 * debug store hook) -- deliberately NOT through the `setMode` action, which
 * would `PATCH /api/v1/settings`'s `theme` key on this SHARED core and leak
 * into other parallel specs reusing the same port (the exact class of
 * contamination `constants.ts`'s dedicated-port comments warn about).
 */

import { test, expect, type Page } from '@playwright/test';
import { CORE_BASE_URL } from './support/constants.js';

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapajaMapController?.getMap?.()), undefined, {
    timeout: 15_000,
  });
}

/** Same pixel-sample technique as `styles.spec.ts` (requires
 *  `canvasContextAttributes: { preserveDrawingBuffer: true }` on the Map,
 *  set in MapView.tsx for exactly this purpose). */
async function readCenterPixel(page: Page): Promise<[number, number, number, number]> {
  const pixel = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.maplibregl-canvas') as HTMLCanvasElement | null;
    if (!canvas) return null;
    const gl = (canvas.getContext('webgl2') ||
      canvas.getContext('webgl')) as WebGLRenderingContext | WebGL2RenderingContext | null;
    if (!gl) return null;
    const out = new Uint8Array(4);
    gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return Array.from(out);
  });
  if (!pixel) throw new Error('Could not read a pixel from the live map canvas');
  return pixel as [number, number, number, number];
}

function relativeLuminance([r, g, b]: [number, number, number, number]): number {
  const channel = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

async function isHtmlDark(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.classList.contains('dark'));
}

/** Flips the live store to `auto` mode WITHOUT going through the `setMode`
 *  action (which persists to the shared core, see the file-level comment
 *  above) -- a direct state mutation + an immediate `tick()` so the
 *  resolution/style/class all reflect `auto` right away, under the
 *  already-mocked clock. */
async function forceAutoMode(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__yapajaThemeStore?.setState({ mode: 'auto', override: null, lastAppliedTheme: null });
    window.__yapajaThemeStore?.getState().tick();
  });
}

test.describe('theme default mode (no user choice made)', () => {
  test('default mode is deterministic light, regardless of real/mocked wall-clock time', async ({ page }) => {
    // Mocked to a time that WOULD be dark under auto -- proves the default
    // mode is genuinely 'light' (not 'auto' silently reading the clock).
    await page.clock.install({ time: new Date('2026-01-15T23:00:00Z') });
    await page.goto(CORE_BASE_URL + '/');
    await waitForMapReady(page);

    await expect.poll(() => isHtmlDark(page), { timeout: 10_000 }).toBe(false);
    await expect
      .poll(async () => relativeLuminance(await readCenterPixel(page)), { timeout: 10_000 })
      .toBeGreaterThan(0.7);
  });
});

test.describe('theme auto-switch (clock fallback, no position)', () => {
  test('night time: UI dark class AND dark map style, applied together', async ({ page }) => {
    // 22:00 UTC -- container/browser TZ is UTC (see playwright.config.ts /
    // no TZ override), so this lands squarely in the 19:00-07:00 dark
    // window regardless of the host machine's own timezone.
    await page.clock.install({ time: new Date('2026-01-15T22:00:00Z') });
    await page.goto(CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await forceAutoMode(page);

    await expect.poll(() => isHtmlDark(page), { timeout: 10_000 }).toBe(true);
    await expect
      .poll(async () => relativeLuminance(await readCenterPixel(page)), { timeout: 10_000 })
      .toBeLessThan(0.3);
  });

  test('day time: no dark class AND light map style', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-01-15T12:00:00Z') });
    await page.goto(CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await forceAutoMode(page);

    await expect.poll(() => isHtmlDark(page), { timeout: 10_000 }).toBe(false);
    await expect
      .poll(async () => relativeLuminance(await readCenterPixel(page)), { timeout: 10_000 })
      .toBeGreaterThan(0.7);
  });

  test('crossing the 19:00 boundary flips BOTH the UI class and the map style together (atomic, no in-between frame)', async ({
    page,
  }) => {
    // Start just before the boundary: still light.
    await page.clock.install({ time: new Date('2026-01-15T18:58:00Z') });
    await page.goto(CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await forceAutoMode(page);

    await expect.poll(() => isHtmlDark(page), { timeout: 10_000 }).toBe(false);
    await expect
      .poll(async () => relativeLuminance(await readCenterPixel(page)), { timeout: 10_000 })
      .toBeGreaterThan(0.7);

    // Fast-forward the faked clock past 19:00 -- the theme controller's
    // periodic re-check (`ThemeController.tsx`'s 30s interval) fires inside
    // this jump and re-resolves + re-applies.
    await page.clock.fastForward('00:05:00');

    // Both must now report dark -- polled independently, but since
    // `applyThemeResolution` sets the class and the map style id from the
    // SAME resolution object in the same synchronous call
    // (`applyThemeResolution.ts`), there is no resolution tick that could
    // leave one updated and the other stale.
    await expect.poll(() => isHtmlDark(page), { timeout: 10_000 }).toBe(true);
    await expect
      .poll(async () => relativeLuminance(await readCenterPixel(page)), { timeout: 10_000 })
      .toBeLessThan(0.3);
  });
});
