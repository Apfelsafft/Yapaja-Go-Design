/**
 * E01-T4 acceptance criteria:
 * 1. Three styles switchable; custom layers + camera survive the switch.
 * 2. Options (lang/labelScale/poi) visibly affect the served style JSON and
 *    persist.
 * 3. (spec validation is covered by `apps/core/src/map/styles/styles.test.ts`,
 *    a Node unit test — no browser needed for that.)
 * 4. Dark style background is dark, light is light — checked via a
 *    pixel-sample against the live WebGL canvas (catches swapped styles).
 * 5. Fully offline / works under a sub-path (network-tracking + relative
 *    URLs, reusing the same harness as the other E01 specs).
 *
 * Plausibility: exactly one Map instance survives every switch (never a
 * full re-init) — checked by tagging the live canvas DOM node and
 * confirming the SAME node (not a new one) is present after switching.
 */

import { test, expect, type Page } from '@playwright/test';
import { CORE_BASE_URL } from './support/constants.js';
import { trackRequests, collectPageErrors } from './support/network.js';

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapajaMapController?.getMap?.()), undefined, {
    timeout: 15_000,
  });
}

/** Reads a single RGBA pixel from the center of the live WebGL canvas via
 *  gl.readPixels (requires `canvasContextAttributes: { preserveDrawingBuffer:
 *  true }` on the Map, set in MapView.tsx for exactly this purpose). */
async function readCenterPixel(page: Page): Promise<[number, number, number, number]> {
  const pixel = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.maplibregl-canvas') as HTMLCanvasElement | null;
    if (!canvas) {
      return null;
    }
    const gl = (canvas.getContext('webgl2') ||
      canvas.getContext('webgl')) as WebGLRenderingContext | WebGL2RenderingContext | null;
    if (!gl) {
      return null;
    }
    const out = new Uint8Array(4);
    gl.readPixels(
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height / 2),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      out,
    );
    return Array.from(out);
  });
  if (!pixel) {
    throw new Error('Could not read a pixel from the live map canvas');
  }
  return pixel as [number, number, number, number];
}

/** WCAG relative luminance from 0-255 RGB channels. */
function relativeLuminance([r, g, b]: [number, number, number, number]): number {
  const channel = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

async function openStylePanel(page: Page): Promise<void> {
  const toggle = page.locator('[data-testid="style-panel-toggle"]');
  await expect(toggle).toBeVisible({ timeout: 5_000 });
  await toggle.click();
  await expect(page.locator('[data-testid="style-panel"]')).toBeVisible({ timeout: 5_000 });
}

async function selectStyle(page: Page, styleId: string): Promise<void> {
  const option = page.locator(`[data-testid="style-option-${styleId}"]`);
  await expect(option).toBeVisible({ timeout: 5_000 });
  await option.click();
}

test.describe('style switching', () => {
  test('three styles are offered and switchable via the style panel', async ({ page }) => {
    await page.goto(CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await openStylePanel(page);

    await expect(page.locator('[data-testid="style-option-yapaja-light"]')).toBeVisible();
    await expect(page.locator('[data-testid="style-option-yapaja-dark"]')).toBeVisible();
    await expect(page.locator('[data-testid="style-option-yapaja-contrast"]')).toBeVisible();
  });

  test('dark style background is dark, light is light (pixel-sample, catches swapped styles)', async ({
    page,
  }) => {
    await page.goto(CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await openStylePanel(page);

    await selectStyle(page, 'yapaja-dark');
    await expect.poll(async () => relativeLuminance(await readCenterPixel(page)), { timeout: 5_000 }).toBeLessThan(
      0.3,
    );

    await selectStyle(page, 'yapaja-light');
    await expect
      .poll(async () => relativeLuminance(await readCenterPixel(page)), { timeout: 5_000 })
      .toBeGreaterThan(0.7);

    await selectStyle(page, 'yapaja-contrast');
    await expect
      .poll(async () => relativeLuminance(await readCenterPixel(page)), { timeout: 5_000 })
      .toBeGreaterThan(0.7);
  });

  test('switching styles never re-initializes the Map (same canvas DOM node, single instance)', async ({
    page,
  }) => {
    await page.goto(CORE_BASE_URL + '/');
    await waitForMapReady(page);

    // Tag the live canvas element; a full re-init would create a brand new
    // canvas node without this marker.
    await page.evaluate(() => {
      document.querySelector('canvas.maplibregl-canvas')?.setAttribute('data-e2e-marker', 'original-instance');
    });

    await openStylePanel(page);
    await selectStyle(page, 'yapaja-dark');
    await expect
      .poll(async () => relativeLuminance(await readCenterPixel(page)), { timeout: 5_000 })
      .toBeLessThan(0.3);
    await selectStyle(page, 'yapaja-contrast');
    await selectStyle(page, 'yapaja-light');
    await expect
      .poll(async () => relativeLuminance(await readCenterPixel(page)), { timeout: 5_000 })
      .toBeGreaterThan(0.7);

    // Exactly one canvas.maplibregl-canvas exists, and it's still the
    // originally-tagged one.
    await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(1);
    await expect(page.locator('canvas.maplibregl-canvas[data-e2e-marker="original-instance"]')).toHaveCount(1);
  });

  test('camera (center/zoom/bearing/pitch) survives a style switch', async ({ page }) => {
    await page.goto(CORE_BASE_URL + '/');
    await waitForMapReady(page);

    // Move out of 2d-north first: that mode (E01-T3) continuously locks
    // bearing back to 0 on every 'rotate'/'moveend' event (including the
    // `jumpTo` a style switch issues) — a *separate*, intentional feature
    // invariant, not something this style-switch test should fight. In
    // 3d-course (no live position in this harness) nothing re-asserts
    // bearing/pitch, so an arbitrary camera set here must survive untouched.
    const viewModeBtn = page.locator('[data-testid="viewmode-button"]');
    await viewModeBtn.click(); // 2d-course
    await viewModeBtn.click(); // 3d-course
    await expect
      .poll(() => page.evaluate(() => window.__yapajaMapController?.getMap()?.getPitch()), { timeout: 5_000 })
      .toBeGreaterThan(50);

    const targetCamera = { center: [8.4, 49.0] as [number, number], zoom: 12.5, bearing: 37, pitch: 20 };
    await page.evaluate((camera) => {
      window.__yapajaMapController?.setCamera(camera);
    }, targetCamera);

    await expect
      .poll(() => page.evaluate(() => window.__yapajaMapController?.getMap()?.getZoom()))
      .toBeCloseTo(targetCamera.zoom, 1);

    await openStylePanel(page);
    await selectStyle(page, 'yapaja-dark');
    await expect
      .poll(async () => relativeLuminance(await readCenterPixel(page)), { timeout: 5_000 })
      .toBeLessThan(0.3);

    const camera = await page.evaluate(() => {
      const map = window.__yapajaMapController?.getMap();
      const center = map?.getCenter();
      return center
        ? { lng: center.lng, lat: center.lat, zoom: map?.getZoom(), bearing: map?.getBearing(), pitch: map?.getPitch() }
        : null;
    });

    expect(camera).not.toBeNull();
    expect(camera!.lng).toBeCloseTo(targetCamera.center[0], 1);
    expect(camera!.lat).toBeCloseTo(targetCamera.center[1], 1);
    expect(camera!.zoom).toBeCloseTo(targetCamera.zoom, 1);
    expect(camera!.bearing).toBeCloseTo(targetCamera.bearing, 0);
    expect(camera!.pitch).toBeCloseTo(targetCamera.pitch, 0);
  });

  test('a custom layer/source added on top of the style survives a switch (dummy layer, per task note re: puck timing)', async ({
    page,
  }) => {
    await page.goto(CORE_BASE_URL + '/');
    await waitForMapReady(page);

    await page.evaluate(() => {
      const map = window.__yapajaMapController?.getMap();
      if (!map) {
        throw new Error('no live map');
      }
      map.addSource('e2e-dummy-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'e2e-dummy-layer',
        type: 'circle',
        source: 'e2e-dummy-source',
        paint: { 'circle-radius': 5, 'circle-color': '#ff00ff' },
      });
    });

    await expect(
      await page.evaluate(() => Boolean(window.__yapajaMapController?.getMap()?.getLayer('e2e-dummy-layer'))),
    ).toBe(true);

    await openStylePanel(page);
    await selectStyle(page, 'yapaja-dark');
    await expect
      .poll(async () => relativeLuminance(await readCenterPixel(page)), { timeout: 5_000 })
      .toBeLessThan(0.3);

    // Give the transformStyle merge + styledata a moment to settle, then
    // assert the dummy layer/source are still present on the SAME map.
    await expect
      .poll(() =>
        page.evaluate(() => Boolean(window.__yapajaMapController?.getMap()?.getLayer('e2e-dummy-layer'))),
      )
      .toBe(true);
    expect(
      await page.evaluate(() => Boolean(window.__yapajaMapController?.getMap()?.getSource('e2e-dummy-source'))),
    ).toBe(true);

    // Switch again (contrast) — must still survive a second switch.
    await selectStyle(page, 'yapaja-contrast');
    await expect
      .poll(() =>
        page.evaluate(() => Boolean(window.__yapajaMapController?.getMap()?.getLayer('e2e-dummy-layer'))),
      )
      .toBe(true);
  });
});

test.describe('style options', () => {
  test('poi=off hides the poi-labels layer in the live style; poi=full/reduced show it', async ({ page }) => {
    await page.goto(CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await openStylePanel(page);

    const poiOff = page.locator('[data-testid="poi-option-off"]');
    await expect(poiOff).toBeVisible({ timeout: 5_000 });
    await poiOff.click();

    await expect
      .poll(() =>
        page.evaluate(() => {
          const layer = window.__yapajaMapController?.getMap()?.getStyle()?.layers?.find((l) => l.id === 'poi-labels');
          return (layer as { layout?: { visibility?: string } } | undefined)?.layout?.visibility;
        }),
      )
      .toBe('none');

    await page.locator('[data-testid="poi-option-full"]').click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const layer = window.__yapajaMapController?.getMap()?.getStyle()?.layers?.find((l) => l.id === 'poi-labels');
          return (layer as { layout?: { visibility?: string } } | undefined)?.layout?.visibility;
        }),
      )
      .toBe('visible');
  });

  test('labelScale=1.2 increases text-size on the live style vs 1.0', async ({ page }) => {
    await page.goto(CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await openStylePanel(page);

    async function currentPlaceLabelSize(): Promise<number | undefined> {
      return page.evaluate(() => {
        const layer = window.__yapajaMapController
          ?.getMap()
          ?.getStyle()
          ?.layers?.find((l) => l.id === 'place-labels');
        const layout = (layer as { layout?: Record<string, unknown> } | undefined)?.layout;
        return layout?.['text-size'] as number | undefined;
      });
    }

    const baseSize = await currentPlaceLabelSize();
    expect(baseSize).toBeTruthy();

    await page.locator('[data-testid="labelscale-option-1.2"]').click();
    await expect.poll(() => currentPlaceLabelSize()).toBeCloseTo((baseSize as number) * 1.2, 1);

    await page.locator('[data-testid="labelscale-option-1.0"]').click();
    await expect.poll(() => currentPlaceLabelSize()).toBeCloseTo(baseSize as number, 1);
  });

  test('lang=name:de rewrites the label text-field expression on the live style', async ({ page }) => {
    await page.goto(CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await openStylePanel(page);

    await page.locator('[data-testid="lang-option-name:de"]').click();

    await expect
      .poll(() =>
        page.evaluate(() => {
          const layer = window.__yapajaMapController
            ?.getMap()
            ?.getStyle()
            ?.layers?.find((l) => l.id === 'place-labels');
          const layout = (layer as { layout?: Record<string, unknown> } | undefined)?.layout;
          return JSON.stringify(layout?.['text-field']);
        }),
      )
      .toBe(JSON.stringify(['get', 'name:de']));
  });

  test('style id + options persist across reload', async ({ page }) => {
    await page.goto(CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await openStylePanel(page);

    await selectStyle(page, 'yapaja-dark');
    await page.locator('[data-testid="poi-option-off"]').click();
    await page.locator('[data-testid="labelscale-option-1.2"]').click();
    await page.locator('[data-testid="lang-option-name:en"]').click();

    // 10s (not 5s): the dark-style render can lag under CI CPU contention --
    // this poll was the source of a recurring styles.spec flake. Matches the
    // post-reload poll's budget below.
    await expect
      .poll(async () => relativeLuminance(await readCenterPixel(page)), { timeout: 10_000 })
      .toBeLessThan(0.3);

    const storedBefore = await page.evaluate(() => ({
      styleId: window.localStorage.getItem('yapaja.styleId'),
      options: window.localStorage.getItem('yapaja.styleOptions'),
    }));
    expect(storedBefore.styleId).toBe('yapaja-dark');
    expect(storedBefore.options).toBeTruthy();
    const parsedOptions = JSON.parse(storedBefore.options as string) as {
      lang: string;
      labelScale: string;
      poi: string;
    };
    expect(parsedOptions).toEqual({ lang: 'name:en', labelScale: '1.2', poi: 'off' });

    await page.reload();
    await waitForMapReady(page);

    // Dark background re-applied on load (never resets to the default light
    // style after a reload).
    await expect
      .poll(async () => relativeLuminance(await readCenterPixel(page)), { timeout: 10_000 })
      .toBeLessThan(0.3);

    // The re-fetched/re-applied live style still carries the persisted
    // options (poi off, labelScale 1.2, lang name:en).
    await expect
      .poll(() =>
        page.evaluate(() => {
          const layers = window.__yapajaMapController?.getMap()?.getStyle()?.layers ?? [];
          const poi = layers.find((l) => l.id === 'poi-labels') as { layout?: { visibility?: string } } | undefined;
          return poi?.layout?.visibility;
        }),
      )
      .toBe('none');

    const storedAfter = await page.evaluate(() => window.localStorage.getItem('yapaja.styleId'));
    expect(storedAfter).toBe('yapaja-dark');
  });
});

test.describe('offline / same-origin', () => {
  test('style panel + switching + option changes never leave same-origin', async ({ page }) => {
    const tracker = await trackRequests(page, CORE_BASE_URL);
    const pageErrors = collectPageErrors(page);

    await page.goto(CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await openStylePanel(page);

    await selectStyle(page, 'yapaja-dark');
    await expect
      .poll(async () => relativeLuminance(await readCenterPixel(page)), { timeout: 5_000 })
      .toBeLessThan(0.3);
    await selectStyle(page, 'yapaja-contrast');
    await page.locator('[data-testid="poi-option-reduced"]').click();
    await page.locator('[data-testid="lang-option-name:de"]').click();
    await selectStyle(page, 'yapaja-light');
    await expect
      .poll(async () => relativeLuminance(await readCenterPixel(page)), { timeout: 5_000 })
      .toBeGreaterThan(0.7);

    expect(tracker.getForeignUrls()).toEqual([]);
    expect(pageErrors).toEqual([]);

    const allUrls = tracker.getAllUrls();
    expect(allUrls.some((u) => u.includes('/api/v1/map/styles'))).toBe(true);
  });
});
