/**
 * Frontend add-on runtime e2e (E09-T2, docs/05 §1A/§3/§4, Wargame W-10) --
 * the mandatory Playwright coverage the task spec calls out.
 *
 * Installs + enables a FIXTURE UI add-on (built as a real tarball with
 * `buildValidAddonTarball`, the same fixture builder the Core's own add-on
 * unit tests use) through the real two-step install API against a dedicated
 * core, then proves the four acceptance criteria end-to-end:
 *
 *   1. RUNTIME WORKS: the fixture's widget renders in its declared slot, its
 *      map layer (`addon:{id}:route`) lands on the live MapLibre map, and it
 *      receives a LIVE position through the bridge -- proven by the widget's
 *      own text updating from a real posted GPS fix, round-tripped through
 *      `position.subscribe` -> `pos/update` event -> `widgets.update`.
 *
 *   2. THE SANDBOX HOLDS (the actual W-10 security proof): the fixture's own
 *      script attempts `window.parent.document` on load. Because its iframe
 *      is `sandbox="allow-scripts"` WITHOUT `allow-same-origin`, it runs in
 *      an opaque origin and that access MUST throw -- the fixture catches
 *      the SecurityError and writes the boolean result into ITS OWN DOM
 *      (never postMessage'd back through the bridge, so a compromised/lying
 *      bridge implementation could not fake this). The test reads it via
 *      `frameLocator`, which talks to the browser over CDP and can inspect a
 *      sandboxed frame's DOM regardless of same-origin policy -- exactly
 *      like a real attacker CANNOT (an attacker only has in-page JS, which
 *      the sandbox blocks; Playwright is not an in-page attacker).
 *
 *   3. `route.propose` IS INERT UNTIL CONFIRMED: calling it only ever renders
 *      the confirmation banner. Proven by intercepting
 *      `POST /navigation/destination` -- zero requests fire before the user
 *      clicks "Übernehmen", exactly one fires after, and only after the click
 *      does the banner disappear.
 *
 *   4. DISABLE TEARS DOWN IMMEDIATELY: after `POST /addons/:id/disable` +
 *      the imperative `window.__yapajaRefreshAddons()` reconcile hook, the
 *      iframe, the map layer, and the widget are ALL gone -- no residue.
 *
 * Runs against its own dedicated core (`ADDON_UI_CORE_BASE_URL`) with its own
 * add-ons/add-on-storage directories (see `constants.ts`/`globalSetup.ts`) --
 * same "an unrelated parallel spec must never share install state" rationale
 * every other dedicated-port spec in this harness documents.
 */

import { test, expect, type Page } from '@playwright/test';
import { ADDON_UI_CORE_BASE_URL } from './support/constants.js';
import { collectPageErrors, trackRequests } from './support/network.js';
import { buildValidAddonTarball } from '../../core/src/addons/__fixtures__/buildTarball.js';

// The default `serviceWorkers: 'block'` (see `playwright.config.ts`) injects
// an instrumentation script into EVERY frame -- including this spec's fully
// sandboxed, opaque-origin add-on iframe (`sandbox="allow-scripts"`, no
// `allow-same-origin`) -- that touches `navigator.serviceWorker`. Reading
// that property throws a `SecurityError` in an opaque-origin context (the
// same sandbox restriction Criterion 2 below deliberately exercises), which
// surfaces as an uncaught `pageerror` with nothing to do with THIS spec's
// own product code. Opting back into `serviceWorkers: 'allow'` (the same
// pattern `pwa.spec.ts`/`nav-control.spec.ts`'s W-19 test already use)
// avoids the instrumentation script entirely.
test.use({ serviceWorkers: 'allow' });

const ADDON_ID = 'com.example.e2e-fixture';
const WIDGET_ID = `${ADDON_ID}/status`;
const MAP_LAYER_ID = `addon:${ADDON_ID}:route`;

/**
 * The fixture add-on's UI. Deliberately hand-rolls the raw postMessage wire
 * protocol (`@yapaja/addon-sdk`'s `protocol.ts`) instead of shipping the
 * built SDK bundle -- no bundler step needed for a tiny fixture, and it
 * proves the bridge enforces the protocol/scopes regardless of whether the
 * (untrusted, replaceable) SDK is used at all, exactly as `bridge.ts`'s doc
 * comment says it must.
 *
 * Shipped as a SEPARATE `.js` file (not an inline `<script>`) under the
 * add-on's own `ui/` dir -- the add-on CSP's `script-src 'self' … selfPath`
 * allows same-origin same-path script files without needing `unsafe-inline`
 * for this one, even though the CSP happens to also permit inline for the
 * add-on's own scripts (see `ui-host.ts#buildAddonCsp`'s doc comment).
 */
const FIXTURE_INDEX_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Fixture Add-on</title></head>
  <body>
    <div id="parent-read-result" data-testid="fixture-parent-dom-readable">unknown</div>
    <script src="./addon.js"></script>
  </body>
</html>
`;

const FIXTURE_ADDON_JS = `(function () {
  var NS = 'yapaja-addon';
  var V = 1;
  var seq = 0;

  function post(msg) {
    var envelope = { ns: NS, v: V };
    for (var k in msg) envelope[k] = msg[k];
    window.parent.postMessage(envelope, '*');
  }

  function call(method, params) {
    var callId = 'c' + (++seq);
    post({ type: 'call', callId: callId, method: method, params: params });
    return callId;
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.ns !== NS || typeof data.type !== 'string') return;

    if (data.type === 'init') {
      call('widgets.register', {
        widgetId: 'status',
        name: 'Fixture Status',
        slots: ['map-overlay-tr'],
        data: { text: 'ready' },
      });

      call('map.addLayer', {
        id: 'route',
        render: 'line',
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: [[9.70, 47.40], [9.72, 47.42]] },
            },
          ],
        },
      });

      call('position.subscribe', {});

      call('route.propose', {
        waypoints: [{ lat: 47.45, lng: 9.75 }],
        reason: 'Fixture proposed detour',
      });

      // W-10 PROOF: this MUST throw -- a sandbox="allow-scripts" iframe
      // WITHOUT allow-same-origin has an opaque origin and cannot read a
      // cross-origin parent's DOM. The result is written into THIS frame's
      // OWN DOM (never sent back over the bridge) so nothing the host does
      // to the message channel could ever fake it.
      var readable = false;
      try {
        var doc = window.parent.document;
        readable = !!doc;
      } catch (e) {
        readable = false;
      }
      var el = document.getElementById('parent-read-result');
      if (el) el.textContent = String(readable);
      return;
    }

    if (data.type === 'event' && data.channel === 'pos/update') {
      var pos = data.payload || {};
      call('widgets.update', {
        widgetId: 'status',
        data: { text: 'pos:' + pos.lat + ',' + pos.lng },
      });
    }
  });

  post({ type: 'ready' });
})();
`;

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapajaMapController?.getMap?.()), undefined, {
    timeout: 15_000,
  });
}

/** Installs (two-step) + enables the fixture add-on against the dedicated
 *  core, and forces an immediate frontend reconcile so the test never has to
 *  wait out `AddonHost`'s 2 s poll interval. */
async function installAndEnableFixture(page: Page): Promise<void> {
  const { bytes } = await buildValidAddonTarball({
    manifest: {
      id: ADDON_ID,
      name: 'E2E Fixture Add-on',
      description: 'Fixture UI add-on for addon-ui.spec.ts (E09-T2)',
      permissions: ['pos.read', 'map.layer.write', 'widget.register', 'route.propose'],
      ui: { entry: 'ui/index.html' },
    },
    extraEntries: [
      { name: 'ui/index.html', content: FIXTURE_INDEX_HTML },
      { name: 'ui/addon.js', content: FIXTURE_ADDON_JS },
    ],
  });

  const beginResponse = await page.request.post(`${ADDON_UI_CORE_BASE_URL}/api/v1/addons/install`, {
    data: { source: 'upload', data: bytes.toString('base64') },
  });
  expect(beginResponse.status()).toBe(202);
  const begin = (await beginResponse.json()) as { data: { pending_id: string } };

  const confirmResponse = await page.request.post(
    `${ADDON_UI_CORE_BASE_URL}/api/v1/addons/install/${begin.data.pending_id}/confirm`,
  );
  expect(confirmResponse.status()).toBe(201);

  const enableResponse = await page.request.post(`${ADDON_UI_CORE_BASE_URL}/api/v1/addons/${ADDON_ID}/enable`);
  expect(enableResponse.status()).toBe(200);

  await page.evaluate(async () => {
    await window.__yapajaRefreshAddons?.();
  });
}

/** Posts one exact fix and waits out the Core's ~1 Hz publish throttle
 *  (same pattern `shell.spec.ts`'s `driveTo` helper uses) so the position
 *  store's WS update is never coalesced away. */
async function postPositionFix(page: Page, lat: number, lon: number): Promise<void> {
  const response = await page.request.post(`${ADDON_UI_CORE_BASE_URL}/api/v1/position/browser`, {
    data: {
      lat,
      lon,
      alt: 500,
      speed: 5,
      heading: 90,
      accuracy: 5,
      fix: '3d',
      ts: new Date().toISOString(),
    },
  });
  expect(response.ok()).toBe(true);
  await page.waitForTimeout(1100);
}

test.describe('Add-on UI runtime (E09-T2, W-10)', () => {
  test.describe.configure({ mode: 'serial' }); // one shared core/add-on lifecycle across these tests

  test('install + enable renders the sandboxed iframe, widget, and map layer; sandbox blocks parent DOM read; route.propose stays inert until confirmed; disable tears everything down', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const tracker = await trackRequests(page, ADDON_UI_CORE_BASE_URL);
    const pageErrors = collectPageErrors(page);
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Track every request to the route-apply endpoint -- criterion 3 hinges
    // on this NEVER firing before the user's own confirm click.
    let destinationRequests = 0;
    await page.route('**/api/v1/navigation/destination', async (route) => {
      destinationRequests += 1;
      await route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":{"code":"E2E_STUB","message":"no routing backend in this harness"}}' });
    });

    await page.goto(ADDON_UI_CORE_BASE_URL);
    await waitForMapReady(page);

    await installAndEnableFixture(page);

    // --- Criterion 1a: the sandboxed iframe itself renders. -----------------
    const frame = page.getByTestId(`addon-frame-${ADDON_ID}`);
    await expect(frame).toBeVisible({ timeout: 10_000 });
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');

    // --- Criterion 1b: the widget the fixture registered renders in its slot.
    const widgetText = page.getByTestId(`addon-widget-text-${WIDGET_ID}`);
    await expect(widgetText).toBeVisible({ timeout: 10_000 });
    await expect(widgetText).toHaveText('ready');

    // --- Criterion 1c: the fixture's map layer landed on the live map. ------
    await expect
      .poll(
        async () =>
          page.evaluate((layerId) => {
            const map = window.__yapajaMapController?.getMap?.();
            return Boolean(map && map.getSource(layerId) && map.getLayer(layerId));
          }, MAP_LAYER_ID),
        { timeout: 10_000 },
      )
      .toBe(true);

    // --- Criterion 2: the parent DOM stays unreadable from inside the sandbox.
    const fixtureFrame = page.frameLocator(`iframe[data-testid="addon-frame-${ADDON_ID}"]`);
    await expect(fixtureFrame.getByTestId('fixture-parent-dom-readable')).toHaveText('false', { timeout: 10_000 });

    // --- Criterion 3a: route.propose only ever shows the banner -- nav is untouched.
    const proposal = page.getByTestId('addon-route-proposal');
    await expect(proposal).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('addon-route-proposal-reason')).toHaveText('Fixture proposed detour');
    expect(destinationRequests).toBe(0);

    // --- Criterion 1d: a real position fix flows through the bridge into the widget.
    // 47.5/9.5 (both exactly representable in binary floating point) so the
    // round-trip through JSON -> the store -> the bridge -> the widget's own
    // string formatting can never be flaky on decimal representation.
    await postPositionFix(page, 47.5, 9.5);
    await expect(widgetText).toHaveText('pos:47.5,9.5');

    // --- Criterion 3b: confirming is the ONLY thing that ever calls /navigation/destination.
    await page.getByTestId('addon-route-accept').click();
    await expect
      .poll(() => destinationRequests, { timeout: 5_000 })
      .toBe(1);
    await expect(proposal).toHaveCount(0);

    // --- Criterion 4: disabling tears everything down immediately, no residue.
    const disableResponse = await page.request.post(`${ADDON_UI_CORE_BASE_URL}/api/v1/addons/${ADDON_ID}/disable`);
    expect(disableResponse.status()).toBe(200);
    await page.evaluate(async () => {
      await window.__yapajaRefreshAddons?.();
    });

    await expect(frame).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId(`addon-widget-text-${WIDGET_ID}`)).toHaveCount(0);
    await expect
      .poll(
        async () =>
          page.evaluate((layerId) => {
            const map = window.__yapajaMapController?.getMap?.();
            return Boolean(map && (map.getSource(layerId) || map.getLayer(layerId)));
          }, MAP_LAYER_ID),
        { timeout: 10_000 },
      )
      .toBe(false);
    expect(pageErrors).toEqual([]);
    // The one expected console entry is Chromium's own "failed to load
    // resource" log for the deliberate 502 the test's own stub above returns
    // for `/navigation/destination` (this harness has no real routing
    // backend, same constraint every other nav e2e spec documents) --
    // `applyProposal` itself never throws on it (see its try/catch). Nothing
    // else may log an error.
    expect(consoleErrors.filter((m) => !m.includes('502'))).toEqual([]);
    expect(tracker.getForeignUrls()).toEqual([]);
  });
});
