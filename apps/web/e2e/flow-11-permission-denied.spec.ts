/**
 * docs/07 §5 — FLOW 11: "Berechtigung verweigert (Geolocation denied) ⇒
 * verständlicher Hinweis + gpsd-Hinweis."
 *
 * Canonical proof for flow 11. See `e2e/FLOWS.md` for the full flow→spec table.
 *
 * WHY THIS SPEC EXISTS (rather than reusing the old coverage): the previous
 * check, `position.spec.ts`'s "permission denied shows W-03 hint", was
 * VACUOUS. Its whole body was
 *
 *     const hintVisible = await page.locator(...).isVisible().catch(() => false);
 *     if (hintVisible) {
 *       const gpsdMentioned = await page.locator(...).isVisible().catch(() => false);
 *       expect(gpsdMentioned || hintVisible).toBe(true);
 *     }
 *
 * — i.e. it passed unconditionally when the hint never appeared at all, and
 * the one assertion inside the guard is a tautology (`hintVisible` is `true`
 * inside that branch, so the `||` can never be false). It also slept 2 s
 * instead of waiting for anything. That test is left in place as the general
 * browser-geolocation smoke it really is; THIS spec is flow 11's actual proof.
 *
 * HOW THE DENIAL IS PRODUCED — and why not the obvious way:
 * merely NOT granting the permission does not reproduce this flow. Measured
 * with a probe: an ungranted Playwright context leaves
 * `navigator.permissions.query({name:'geolocation'})` at `"prompt"`, and
 * `watchPosition` eventually fails with code 3 (TIMEOUT), not code 1
 * (PERMISSION_DENIED) — a different branch of `browserSource.handleError`
 * showing a different ("GPS-Signal nicht verfügbar") hint. That is why the
 * old check could never have seen the banner it claimed to look for.
 *
 * A genuine denial is set through Chromium's own permission store via CDP
 * (`Browser.setPermission` with `setting: 'denied'`, scoped to this
 * browser context) — the browser then answers `watchPosition` with a real
 * code 1, exactly like a user pressing "Block". Nothing in the app is
 * stubbed or monkey-patched.
 *
 * The page is served from 127.0.0.1, which IS a secure context, so this
 * genuinely exercises the `permission-denied` branch and not the
 * `insecure-context` one.
 *
 * END STATE ASSERTED BOTH WAYS:
 *  - UI: the German hint is on screen, names the problem in plain language,
 *    and offers the gpsd alternative (the "+ gpsd-Hinweis" half of the flow).
 *  - API: the Core genuinely never received a browser fix — `GET
 *    /api/v1/position` still answers 204 (no position at all) and
 *    `GET /api/v1/position/sources` reports no active source. Without this,
 *    a UI-only test could pass against an app that showed the banner while
 *    silently feeding positions anyway.
 */

import { test, expect } from '@playwright/test';
import { FLOW11_CORE_BASE_URL } from './support/constants.js';
import { collectPageErrors, trackRequests } from './support/network.js';

interface SourcesReply {
  sources: Array<{ name: string; status?: string }>;
  active: string | null;
  forced: string | null;
}

test('[Flow 11] geolocation denied: understandable German hint incl. the gpsd alternative, and no position ever reaches the Core', async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  const tracker = await trackRequests(page, FLOW11_CORE_BASE_URL);
  const pageErrors = collectPageErrors(page);

  // Deny geolocation for real, in Chromium's own permission store (see the
  // file header for why `clearPermissions()` alone is NOT enough).
  await context.clearPermissions();
  const pageSession = await context.newCDPSession(page);
  const targetInfo = (await pageSession.send('Target.getTargetInfo')) as {
    targetInfo: { browserContextId?: string };
  };
  const browser = context.browser();
  expect(browser).not.toBeNull();
  const browserSession = await browser!.newBrowserCDPSession();
  await browserSession.send('Browser.setPermission', {
    permission: { name: 'geolocation' },
    setting: 'denied',
    origin: FLOW11_CORE_BASE_URL,
    browserContextId: targetInfo.targetInfo.browserContextId,
  });

  // Sanity: the browser really is in the denied state this flow is about --
  // so a green run can never mean "the permission was simply never asked for".
  await page.goto(FLOW11_CORE_BASE_URL + '/');
  const permissionState = await page.evaluate(() =>
    navigator.permissions.query({ name: 'geolocation' as PermissionName }).then((p) => p.state),
  );
  expect(permissionState).toBe('denied');

  // API precondition: this Core has never seen a position (204 = none yet).
  const before = await page.request.get(`${FLOW11_CORE_BASE_URL}/api/v1/position`);
  expect(before.status()).toBe(204);

  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

  // --- UI: the hint ---------------------------------------------------------
  const hint = page.getByTestId('geolocation-hint');
  await expect(hint).toBeVisible({ timeout: 20_000 });
  // It is the PERMISSION-DENIED hint specifically, not the generic
  // "no GPS signal" / "insecure context" ones.
  await expect(hint).toHaveAttribute('data-geolocation-error', 'permission-denied');

  // "Verständlicher Hinweis": says what happened, in German, without jargon.
  await expect(hint).toContainText('Standortzugriff verweigert');
  await expect(hint).toContainText('Berechtigung für Standortzugriff wurde verweigert');

  // "+ gpsd-Hinweis": the flow's explicit second half -- the user must be
  // pointed at the gpsd alternative, not just told "no".
  await expect(hint).toContainText('gpsd');

  // The app stays usable: this is a hint, not a dead end. The map is still
  // there and still interactive.
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
  await expect(page.getByTestId('search-input')).toBeEnabled();

  // --- API: nothing was ever fed to the Core --------------------------------
  const after = await page.request.get(`${FLOW11_CORE_BASE_URL}/api/v1/position`);
  expect(after.status()).toBe(204);

  const sourcesResponse = await page.request.get(`${FLOW11_CORE_BASE_URL}/api/v1/position/sources`);
  expect(sourcesResponse.ok()).toBe(true);
  const sources = (await sourcesResponse.json()) as SourcesReply;
  // No source is delivering, and nothing was force-pinned behind the scenes.
  expect(sources.active).toBeNull();
  expect(sources.forced).toBeNull();

  // The browser never POSTed a fix either (belt and braces: proves the denial
  // was honoured client-side too, not merely unobservable server-side).
  expect(tracker.getAllUrls().some((u) => u.includes('/api/v1/position/browser'))).toBe(false);

  expect(tracker.getForeignUrls()).toEqual([]);
  expect(pageErrors).toEqual([]);
});
