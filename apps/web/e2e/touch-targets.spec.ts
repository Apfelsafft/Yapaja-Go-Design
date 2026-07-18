/**
 * Touch-target measurement e2e (E07-T4, docs/06 §4: "Touchziele ... im
 * Drive-Modus ≥ 64 px; Abstände ≥ 8 px"): automated bounding-box measurement
 * of the drive-mode-ONLY interactive elements -- the ones the task's own
 * text explicitly calls out (`DriveControls.tsx`'s
 * drive-stop-button/drive-pause-button/drive-resume-button, inside
 * `drive-controls`), plus the TTS toggle (`DriveOverlay.tsx`'s
 * `tts-toggle`), which is the only OTHER control rendered exclusively while
 * a drive session is active (`DriveOverlay.tsx`'s `active` gate).
 *
 * SCOPING DECISION (documented, matches the task's "be pragmatic, document
 * what you scope out" guidance): the always-present map FABs
 * (CompassButton/ViewModeButton/ReCenterButton/StylePanel-toggle/
 * RegionsPanel-toggle) are NOT measured here -- they render in BOTH modes
 * (pre-existing E01-T3 controls, already "Touch-friendly ≥48px" per that
 * task, docs/06 §4's general ≥48px floor), not exclusively "im
 * Drive-Modus". Resizing them to 64px would be a real behavior change to
 * controls outside this task's `apps/web/src/drive/` scope note, with real
 * regression risk against the 20+ pre-existing e2e specs that click them
 * (positions/afforances, though not sizes, are asserted indirectly via
 * click-target reachability) -- left at their pre-existing size,
 * consciously out of scope.
 */

import { test, expect, type Page } from '@playwright/test';
import type { Route } from '@yapaja/shared';
import { encodePolyline6, type LatLon } from '../../core/src/routing/polyline.js';
import { TOUCH_TARGETS_CORE_BASE_URL } from './support/constants.js';
import { collectPageErrors } from './support/network.js';

/** The exact drive-mode-only controls this test measures -- see the
 *  file-level scoping comment above for why the list stops here. */
const MEASURED_TESTIDS = ['drive-stop-button', 'drive-pause-button', 'tts-toggle'] as const;

const MIN_SIZE_PX = 64;
const MIN_GAP_PX = 8;

const BASE_LAT = 47.1;
const BASE_LON = 9.4;
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
  id: 'touch-targets-e2e-route',
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
  speed_limits: [],
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
  const response = await page.request.post(`${TOUCH_TARGETS_CORE_BASE_URL}/api/v1/position/browser`, {
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

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Whether two axis-aligned boxes' NEAREST edges are at least `minGapPx`
 *  apart along at least one axis -- overlapping boxes (gap < 0 on both
 *  axes) or boxes closer than the minimum on both axes fail. Two boxes that
 *  don't overlap on one axis at all (e.g. one strictly above the other)
 *  only need the gap on THAT axis to clear the minimum. */
function gapPx(a: Box, b: Box): number {
  const horizontalGap = Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width);
  const verticalGap = Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height);
  // Whichever axis actually separates the two boxes (positive value there);
  // if both are negative, the boxes overlap -- report the LEAST-negative
  // (closest to separating) as the effective gap, which will correctly fail
  // the >= 8px assertion.
  return Math.max(horizontalGap, verticalGap);
}

test.describe('Touch-target audit (E07-T4, drive-mode-only controls)', () => {
  test.describe.configure({ mode: 'serial' });

  test.afterEach(async ({ page }) => {
    await page
      .evaluate(async (baseUrl: string) => {
        await fetch(`${baseUrl}/api/v1/navigation/stop`, { method: 'POST' });
      }, TOUCH_TARGETS_CORE_BASE_URL)
      .catch(() => {
        // Best-effort cleanup.
      });
  });

  test('every measured drive-mode control is >= 64x64 px, with >= 8px gaps between adjacent ones', async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const pageErrors = collectPageErrors(page);

    await page.goto(TOUCH_TARGETS_CORE_BASE_URL + '/');
    await waitForMapReady(page);

    const startResponse = await page.request.post(`${TOUCH_TARGETS_CORE_BASE_URL}/api/v1/navigation/start`, {
      data: { route: ROUTE, destination: { latlng: ROUTE_POINTS[10], name: 'Touch-Target Ziel' } },
    });
    expect(startResponse.ok()).toBe(true);
    await postSpeed(page, 3, 50); // any real speed so `active` gates render + the panel is visible

    await expect(page.getByTestId('drive-controls')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('tts-toggle')).toBeVisible();

    const boxes: Record<string, Box> = {};
    for (const testId of MEASURED_TESTIDS) {
      const locator = page.getByTestId(testId);
      await expect(locator).toBeVisible();
      const box = await locator.boundingBox();
      expect(box, `${testId} must have a bounding box`).not.toBeNull();
      boxes[testId] = box as Box;
    }

    // 1. Every measured control is >= 64x64 px.
    for (const testId of MEASURED_TESTIDS) {
      const box = boxes[testId];
      expect(box.width, `${testId} width`).toBeGreaterThanOrEqual(MIN_SIZE_PX);
      expect(box.height, `${testId} height`).toBeGreaterThanOrEqual(MIN_SIZE_PX);
    }

    // 2. Pairwise gaps between every measured control are >= 8px.
    const testIds = [...MEASURED_TESTIDS];
    for (let i = 0; i < testIds.length; i += 1) {
      for (let j = i + 1; j < testIds.length; j += 1) {
        const gap = gapPx(boxes[testIds[i]], boxes[testIds[j]]);
        expect(gap, `gap between ${testIds[i]} and ${testIds[j]}`).toBeGreaterThanOrEqual(MIN_GAP_PX);
      }
    }

    expect(pageErrors).toEqual([]);
  });

  test('the Resume button (shown while paused) is also >= 64x64 px', async ({ page }) => {
    test.setTimeout(30_000);
    const pageErrors = collectPageErrors(page);

    await page.goto(TOUCH_TARGETS_CORE_BASE_URL + '/');
    await waitForMapReady(page);

    const startResponse = await page.request.post(`${TOUCH_TARGETS_CORE_BASE_URL}/api/v1/navigation/start`, {
      data: { route: ROUTE, destination: { latlng: ROUTE_POINTS[10], name: 'Touch-Target Ziel' } },
    });
    expect(startResponse.ok()).toBe(true);
    await postSpeed(page, 3, 50);

    await page.getByTestId('drive-pause-button').click();
    const resumeButton = page.getByTestId('drive-resume-button');
    await expect(resumeButton).toBeVisible({ timeout: 5_000 });
    const box = await resumeButton.boundingBox();
    expect(box).not.toBeNull();
    expect((box as Box).width).toBeGreaterThanOrEqual(MIN_SIZE_PX);
    expect((box as Box).height).toBeGreaterThanOrEqual(MIN_SIZE_PX);

    // Stop is still on screen alongside Resume, with an adequate gap.
    const stopBox = (await page.getByTestId('drive-stop-button').boundingBox()) as Box;
    expect(gapPx(box as Box, stopBox)).toBeGreaterThanOrEqual(MIN_GAP_PX);

    expect(pageErrors).toEqual([]);
  });
});
