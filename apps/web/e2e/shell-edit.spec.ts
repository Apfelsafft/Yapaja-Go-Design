/**
 * Widget shell EDIT MODE e2e (E07-T2): the mandatory Playwright coverage the
 * task spec calls out --
 *   Flow 7: drag a widget to another slot -> Save -> Reload -> persisted.
 *   Cancel provably discards changes (the saved layout is never touched).
 *   Reset restores the EXACT default layout.
 * Plus two more flows for the task's explicit "IMPORTANT" acceptance
 * criteria that aren't in the mandatory list but are load-bearing to the
 * feature: the standstill gate (edit mode only startable below 5 km/h) and
 * the plausibility check (an incompatible drop is visibly refused).
 *
 * A NEW spec file (does not modify shell.spec.ts), running against its OWN
 * dedicated core (SHELL_EDIT_CORE_BASE_URL, see constants.ts) for the same
 * "an unrelated parallel spec's fix/save could land mid-sequence" rationale
 * shell.spec.ts's own dedicated core already documents.
 *
 * Drag simulation: `@dnd-kit/core`'s `PointerSensor` listens for real
 * `pointerdown`/`pointermove`/`pointerup` events, which Chromium fires
 * alongside the legacy mouse events `page.mouse.*` drives -- a `down` at the
 * source, a small move past the sensor's activation distance (4px, see
 * `Shell.tsx`'s `activationConstraint`), then a move to the target slot
 * (letting dnd-kit's collision detection register `over`), then `up`. No
 * keyboard-sensor fallback is needed -- this pattern is deterministic in
 * headless Chromium.
 */

import { test, expect, type Page, type Locator } from '@playwright/test';
import { SHELL_EDIT_CORE_BASE_URL } from './support/constants.js';
import { collectPageErrors } from './support/network.js';
import { defaultLayoutsSettingsValue } from '../src/shell/layout.js';

const BASE_LAT = 47.4;
const BASE_LON = 9.7;

function positionFixBody(speedMs: number): Record<string, unknown> {
  return {
    lat: BASE_LAT,
    lon: BASE_LON,
    alt: 500,
    speed: speedMs,
    heading: 0,
    accuracy: 5,
    fix: '3d',
    ts: new Date().toISOString(),
  };
}

/** Posts one position fix and waits out the Core's 1 Hz publish throttle
 *  (same pattern as shell.spec.ts's `driveTo`) so the edit-mode standstill
 *  gate always sees it before the next assertion. */
async function postSpeed(page: Page, speedMs: number): Promise<void> {
  const response = await page.request.post(`${SHELL_EDIT_CORE_BASE_URL}/api/v1/position/browser`, {
    data: positionFixBody(speedMs),
  });
  expect(response.ok()).toBe(true);
  await page.waitForTimeout(1100);
}

async function waitForShellReady(page: Page, mode: 'explore' | 'drive'): Promise<void> {
  const root = page.getByTestId('shell-root');
  await expect(root).toBeVisible({ timeout: 10_000 });
  await expect(root).toHaveAttribute('data-mode', mode);
}

/**
 * Waits for the debounced save (`layoutStore.ts`'s 250ms `SAVE_DEBOUNCE_MS`)
 * to actually land in the device-local cache before reloading -- otherwise a
 * `page.reload()` immediately after clicking Save could race the debounce
 * timer and read back the PRE-save layout (same class of race
 * `shell.spec.ts`'s own persistence test guards against with its
 * `expect.poll(...).toContain('e2e-clock')` on `localStorage`).
 */
async function waitForSavedSlotToContain(page: Page, slotId: string, widgetId: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ slotId, widgetId }) => {
            const raw = window.localStorage.getItem('yapaja:shell:layouts');
            if (!raw) return false;
            try {
              const parsed = JSON.parse(raw) as { drive?: { slots?: Record<string, Array<{ widgetId: string }>> } };
              const list = parsed.drive?.slots?.[slotId];
              return Array.isArray(list) && list.some((instance) => instance.widgetId === widgetId);
            } catch {
              return false;
            }
          },
          { slotId, widgetId },
        ),
      { timeout: 5_000 },
    )
    .toBe(true);
}

async function enterEditMode(page: Page): Promise<void> {
  const button = page.getByTestId('edit-mode-enter-button');
  await expect(button).toBeEnabled({ timeout: 10_000 });
  await button.click();
  await expect(page.getByTestId('shell-root')).toHaveAttribute('data-edit-active', 'true');
}

/** Drags `source` onto `target` via a realistic pointer-event sequence (see
 *  file-level comment). Optionally pauses mid-drag (hovering `target`,
 *  before release) so a caller can assert hover-only state (e.g. the
 *  plausibility red-ring) before completing or aborting the drop. */
async function dragOnto(page: Page, source: Locator, target: Locator, opts: { beforeDrop?: () => Promise<void> } = {}): Promise<void> {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error('dragOnto: missing bounding box for source or target');
  }
  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Exceed dnd-kit's PointerSensor activation distance (4px) -- otherwise no
  // DragStart ever fires.
  await page.mouse.move(startX + 12, startY + 12, { steps: 5 });
  await page.mouse.move(endX, endY, { steps: 20 });
  // Settle at the final position so dnd-kit's collision detection has a
  // chance to register `over` before anything else happens.
  await page.mouse.move(endX, endY, { steps: 2 });
  await page.waitForTimeout(50);

  if (opts.beforeDrop) {
    await opts.beforeDrop();
  }

  await page.mouse.up();
  // Let dnd-kit's own post-drop teardown (it briefly keeps document-level
  // pointer listeners alive to finish its internal drag-end bookkeeping)
  // settle before the caller's next interaction (e.g. clicking a toolbar
  // button) -- clicking immediately in the same tick occasionally raced that
  // teardown and the click was silently dropped.
  await page.waitForTimeout(200);
}

test.describe('Widget shell edit mode (E07-T2)', () => {
  test.describe.configure({ mode: 'serial' }); // one shared core, one navigation session at a time

  // Every test starts from the EXACT built-in default layout server-side --
  // otherwise an earlier test's Save would leak into the next test's
  // baseline assertions (the dedicated core process outlives each test's
  // fresh browser context/localStorage).
  test.beforeEach(async ({ page }) => {
    const response = await page.request.patch(`${SHELL_EDIT_CORE_BASE_URL}/api/v1/settings`, {
      data: { layouts: defaultLayoutsSettingsValue() },
    });
    expect(response.ok()).toBe(true);
  });

  test('[Flow 7] drag a widget to another slot, Save, reload -> placement persisted', async ({ page }) => {
    test.setTimeout(30_000);
    const pageErrors = collectPageErrors(page);

    await page.goto(`${SHELL_EDIT_CORE_BASE_URL}/shell.html?mode=drive`);
    await waitForShellReady(page, 'drive');

    // Baseline: the altitude widget (S-only) starts in `bottom-bar` (drive
    // mode's default layout, layout.ts).
    await expect(page.getByTestId('slot-bottom-bar').getByTestId('widget-altitude')).toBeVisible();
    await expect(page.getByTestId('slot-side-panel').getByTestId('widget-altitude')).toHaveCount(0);

    await postSpeed(page, 0); // explicit standstill fix (criterion 2)
    await enterEditMode(page);

    await dragOnto(
      page,
      page.getByTestId('slot-bottom-bar').getByTestId('widget-altitude'),
      page.getByTestId('slot-side-panel'),
    );

    // The DRAFT reflects the move immediately, before Save.
    await expect(page.getByTestId('slot-side-panel').getByTestId('widget-altitude')).toBeVisible();
    await expect(page.getByTestId('slot-bottom-bar').getByTestId('widget-altitude')).toHaveCount(0);

    await page.getByTestId('edit-save-button').click();
    await expect(page.getByTestId('shell-root')).not.toHaveAttribute('data-edit-active', 'true');
    await waitForSavedSlotToContain(page, 'side-panel', 'altitude');

    // Reload: the SAVED (non-draft) layout must show the moved placement.
    await page.reload();
    await waitForShellReady(page, 'drive');
    await expect(page.getByTestId('slot-side-panel').getByTestId('widget-altitude')).toBeVisible();
    await expect(page.getByTestId('slot-bottom-bar').getByTestId('widget-altitude')).toHaveCount(0);

    // API side of the end state (E10-T1 plausibility requirement): the layout
    // lives in the CORE's settings store, not only in this browser's
    // localStorage -- so the same layout would follow the user to another
    // device/tab. `waitForSavedSlotToContain` above only inspects
    // localStorage; this asserts the server-side half.
    const settings = (await (
      await page.request.get(`${SHELL_EDIT_CORE_BASE_URL}/api/v1/settings`)
    ).json()) as {
      data?: { layouts?: { drive?: { slots?: Record<string, Array<{ widgetId: string }>> } } };
      layouts?: { drive?: { slots?: Record<string, Array<{ widgetId: string }>> } };
    };
    const layouts = settings.data?.layouts ?? settings.layouts;
    const driveSlots = layouts?.drive?.slots;
    expect(driveSlots).toBeDefined();
    expect((driveSlots?.['side-panel'] ?? []).map((w) => w.widgetId)).toContain('altitude');
    expect((driveSlots?.['bottom-bar'] ?? []).map((w) => w.widgetId)).not.toContain('altitude');

    expect(pageErrors).toEqual([]);
  });

  test('Cancel discards all draft changes -- the saved layout is never touched', async ({ page }) => {
    test.setTimeout(30_000);
    const pageErrors = collectPageErrors(page);

    await page.goto(`${SHELL_EDIT_CORE_BASE_URL}/shell.html?mode=drive`);
    await waitForShellReady(page, 'drive');
    await expect(page.getByTestId('slot-bottom-bar').getByTestId('widget-altitude')).toBeVisible();

    await enterEditMode(page);
    await dragOnto(
      page,
      page.getByTestId('slot-bottom-bar').getByTestId('widget-altitude'),
      page.getByTestId('slot-side-panel'),
    );
    // Draft shows the move...
    await expect(page.getByTestId('slot-side-panel').getByTestId('widget-altitude')).toBeVisible();

    await page.getByTestId('edit-cancel-button').click();
    await expect(page.getByTestId('shell-root')).not.toHaveAttribute('data-edit-active', 'true');

    // ...but immediately after Cancel, the ORIGINAL placement is back.
    await expect(page.getByTestId('slot-bottom-bar').getByTestId('widget-altitude')).toBeVisible();
    await expect(page.getByTestId('slot-side-panel').getByTestId('widget-altitude')).toHaveCount(0);

    // Reload proves the discard was real -- nothing was ever persisted.
    await page.reload();
    await waitForShellReady(page, 'drive');
    await expect(page.getByTestId('slot-bottom-bar').getByTestId('widget-altitude')).toBeVisible();
    await expect(page.getByTestId('slot-side-panel').getByTestId('widget-altitude')).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test('Reset restores the exact default layout', async ({ page }) => {
    test.setTimeout(30_000);
    const pageErrors = collectPageErrors(page);

    await page.goto(`${SHELL_EDIT_CORE_BASE_URL}/shell.html?mode=drive`);
    await waitForShellReady(page, 'drive');

    await enterEditMode(page);
    await dragOnto(
      page,
      page.getByTestId('slot-bottom-bar').getByTestId('widget-altitude'),
      page.getByTestId('slot-side-panel'),
    );
    await expect(page.getByTestId('slot-side-panel').getByTestId('widget-altitude')).toBeVisible();

    await page.getByTestId('edit-reset-button').click();
    await expect(page.getByTestId('edit-reset-confirm')).toBeVisible();
    await page.getByTestId('edit-reset-confirm-yes').click();
    await expect(page.getByTestId('edit-reset-confirm')).toHaveCount(0);

    // Reset restores the draft to the EXACT default -- altitude back in
    // bottom-bar, the other default placements untouched.
    await expect(page.getByTestId('slot-bottom-bar').getByTestId('widget-altitude')).toBeVisible();
    await expect(page.getByTestId('slot-side-panel').getByTestId('widget-altitude')).toHaveCount(0);
    await expect(page.getByTestId('slot-map-overlay-tl').getByTestId('widget-next-instruction')).toBeVisible();
    await expect(page.getByTestId('slot-map-overlay-tr').getByTestId('widget-speed-limit')).toBeVisible();

    // Save + reload -- the reset persists like any other draft change.
    await page.getByTestId('edit-save-button').click();
    await waitForSavedSlotToContain(page, 'bottom-bar', 'altitude');
    await page.reload();
    await waitForShellReady(page, 'drive');
    await expect(page.getByTestId('slot-bottom-bar').getByTestId('widget-altitude')).toBeVisible();
    await expect(page.getByTestId('slot-side-panel').getByTestId('widget-altitude')).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test('standstill gate: edit mode entry is blocked while driving, allowed at standstill', async ({ page }) => {
    test.setTimeout(30_000);
    const pageErrors = collectPageErrors(page);

    await page.goto(`${SHELL_EDIT_CORE_BASE_URL}/shell.html?mode=drive`);
    await waitForShellReady(page, 'drive');

    await postSpeed(page, 15); // 15 m/s = 54 km/h, well above the 5 km/h gate
    await expect(page.getByTestId('edit-mode-enter-button')).toBeDisabled();

    await postSpeed(page, 0); // standstill
    await expect(page.getByTestId('edit-mode-enter-button')).toBeEnabled();
    await page.getByTestId('edit-mode-enter-button').click();
    await expect(page.getByTestId('shell-root')).toHaveAttribute('data-edit-active', 'true');

    expect(pageErrors).toEqual([]);
  });

  test('plausibility: an incompatible drop is refused and the target slot turns red', async ({ page }) => {
    test.setTimeout(30_000);
    const pageErrors = collectPageErrors(page);

    await page.goto(`${SHELL_EDIT_CORE_BASE_URL}/shell.html?mode=drive`);
    await waitForShellReady(page, 'drive');
    // `next-instruction` is L-only (widgets/nextInstruction.tsx) and starts
    // in `map-overlay-tl` (accepts S/M/L); `top-bar` only accepts S/M. It
    // reuses `ManeuverPanel`, which renders NOTHING while no navigation is
    // active (matching shell.spec.ts's own "no maneuver panel until routing
    // starts" behaviour) -- so its wrapper is zero-sized here and this test
    // asserts DOM presence (`toHaveCount`), not `toBeVisible`.
    await expect(page.getByTestId('slot-map-overlay-tl').getByTestId('widget-next-instruction')).toHaveCount(1);

    await enterEditMode(page);

    const source = page.getByTestId('slot-map-overlay-tl').getByTestId('widget-next-instruction');
    const target = page.getByTestId('slot-top-bar');

    await dragOnto(page, source, target, {
      beforeDrop: async () => {
        await expect(target).toHaveAttribute('data-drop-invalid', 'true');
      },
    });

    // The drop is REFUSED -- the widget never moves.
    await expect(page.getByTestId('slot-map-overlay-tl').getByTestId('widget-next-instruction')).toHaveCount(1);
    await expect(page.getByTestId('slot-top-bar').getByTestId('widget-next-instruction')).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });
});
