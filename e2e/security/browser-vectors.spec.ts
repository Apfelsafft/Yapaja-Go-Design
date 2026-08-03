/**
 * E09-T6 -- Sandbox-Escape-Suite, BROWSER-SEITIGE Vektoren (Wargame W-10).
 *
 * Läuft in einem echten Chromium gegen denselben echten Core wie
 * `core-vectors.spec.ts`. Das Evil-Fixture wird über die ECHTE Install-API
 * installiert, vom echten `AddonHost` in ein echtes
 * `sandbox="allow-scripts"`-iframe geladen und redet ausschließlich über
 * rohes postMessage (bewusst OHNE SDK -- die Durchsetzung liegt im Host).
 *
 * WIE DER BLOCK BEWIESEN WIRD, OHNE DEM ADD-ON ZU GLAUBEN:
 * Das Fixture schreibt jedes Ergebnis in sein EIGENES DOM. Playwright liest
 * das über CDP (`frameLocator`) -- ein Kanal, den ein echter Angreifer NICHT
 * hat (der hat nur In-Page-JS, und genau das blockt die Sandbox). Der Nachweis
 * hängt also weder an der Bridge noch an einer Selbstmeldung des Add-ons.
 *
 * Für jeden Vektor: (a) geblockt, (b) `security`-Event aufgezeichnet.
 */

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test';
import { SECURITY_CORE_BASE_URL, SECURITY_CORE_TOKEN, VICTIM_ADDON_ID } from './support/constants.js';
import {
  buildEvilFixtureTarball,
  coreAuth,
  expectSecurityEvent,
  fetchSecurityEvents,
  installAndEnable,
} from './support/helpers.js';

/** A distinct id so this spec never collides with `core-vectors.spec.ts`'s
 *  install (which it DISABLES at the end -- a disabled add-on serves no UI). */
const UI_EVIL_ADDON_ID = 'com.example.evil-fixture-ui';

let api: APIRequestContext;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  api = await playwrightRequest.newContext();
  const { bytes } = await buildEvilFixtureTarball({ id: UI_EVIL_ADDON_ID });
  await installAndEnable(api, bytes, UI_EVIL_ADDON_ID);
});

test.afterAll(async () => {
  await api.dispose();
});

/**
 * The web app fetches `/api/v1/addons` etc. without an Authorization header
 * (it is the bundled first-party UI). This Core enforces `API_AUTH_TOKEN`, so
 * the browser gets one injected on every same-origin API request. This is the
 * HOST's credential -- never the add-on's, and never reachable from inside the
 * sandboxed iframe (its CSP is `connect-src 'none'`).
 */
async function authenticateBrowser(page: Page): Promise<void> {
  await page.route(`${SECURITY_CORE_BASE_URL}/api/**`, async (route) => {
    const headers = { ...route.request().headers(), authorization: `Bearer ${SECURITY_CORE_TOKEN}` };
    await route.continue({ headers });
  });
}

async function openAppWithFixture(page: Page): Promise<void> {
  await authenticateBrowser(page);
  await page.goto(SECURITY_CORE_BASE_URL);
  await expect(page.getByTestId(`addon-frame-${UI_EVIL_ADDON_ID}`)).toBeVisible({ timeout: 20_000 });
  // The fixture signals it has finished ALL of its attempts.
  await expect(
    page.frameLocator(`iframe[data-testid="addon-frame-${UI_EVIL_ADDON_ID}"]`).getByTestId('evil-done'),
  ).toHaveText('true', { timeout: 20_000 });
}

test('VEKTOR ui.parent_dom_access: Parent-DOM, top.location, Cookies und localStorage des Hosts bleiben unlesbar', async ({
  page,
}) => {
  // Prove there IS something worth stealing, so "nothing readable" is not
  // trivially true.
  await authenticateBrowser(page);
  await page.goto(SECURITY_CORE_BASE_URL);
  await page.evaluate(() => {
    document.cookie = 'yapaja_host_secret=super-secret; path=/';
    window.localStorage.setItem('yapaja_host_secret', 'super-secret');
  });
  await page.reload();
  await expect(page.getByTestId(`addon-frame-${UI_EVIL_ADDON_ID}`)).toBeVisible({ timeout: 20_000 });
  const frame = page.frameLocator(`iframe[data-testid="addon-frame-${UI_EVIL_ADDON_ID}"]`);
  await expect(frame.getByTestId('evil-done')).toHaveText('true', { timeout: 20_000 });

  // (a) blocked -- read out-of-band from the add-on's OWN DOM via CDP.
  await expect(frame.getByTestId('evil-parent-dom-readable')).toHaveText('false');
  await expect(frame.getByTestId('evil-top-location-readable')).toHaveText('false');
  await expect(frame.getByTestId('evil-host-cookie-readable')).toHaveText('false');
  await expect(frame.getByTestId('evil-host-localstorage-readable')).toHaveText('false');

  // The iframe really is the un-privileged variant.
  await expect(page.getByTestId(`addon-frame-${UI_EVIL_ADDON_ID}`)).toHaveAttribute('sandbox', 'allow-scripts');

  // (b) recorded (host-forwarded self-report -- auditability, see README).
  await expectSecurityEvent(api, 'ui.parent_dom_access', { addonId: UI_EVIL_ADDON_ID });
});

test('VEKTOR ui.foreign_host_fetch: fetch() zu einem fremden Host kommt nicht aus dem iframe heraus', async ({
  page,
}) => {
  const foreignRequests: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith(SECURITY_CORE_BASE_URL) && !url.startsWith('data:') && !url.startsWith('blob:')) {
      foreignRequests.push(url);
    }
  });

  await openAppWithFixture(page);
  const frame = page.frameLocator(`iframe[data-testid="addon-frame-${UI_EVIL_ADDON_ID}"]`);

  // (a) blocked, proven two independent ways:
  //     1. the add-on's own record of its fetch result, and
  //     2. the browser never issued a single request off this origin.
  await expect(frame.getByTestId('evil-foreign-fetch-ok')).toHaveText('false');
  expect(foreignRequests, `the sandbox leaked requests: ${foreignRequests.join(', ')}`).toEqual([]);

  // (b) recorded.
  await expectSecurityEvent(api, 'ui.foreign_host_fetch', { addonId: UI_EVIL_ADDON_ID });
});

test('VEKTOR bridge.scope_denied: eine Methode ohne deklarierten Scope wird host-seitig abgelehnt', async ({
  page,
}) => {
  await openAppWithFixture(page);
  const frame = page.frameLocator(`iframe[data-testid="addon-frame-${UI_EVIL_ADDON_ID}"]`);

  // The fixture called `map.addLayer` -- it never declared `map.layer.write`.
  // (a) blocked: the call was refused AND no such layer exists on the map.
  await expect(frame.getByTestId('evil-undeclared-scope-ok')).toHaveText('false');
  const layerPresent = await page.evaluate((layerId) => {
    const map = window.__yapajaMapController?.getMap?.();
    return Boolean(map && (map.getSource(layerId) || map.getLayer(layerId)));
  }, `addon:${UI_EVIL_ADDON_ID}:evil-layer`);
  expect(layerPresent).toBe(false);

  // Positive control: a method it DID declare works, so the refusal above is
  // the scope check and not a dead bridge.
  await expect(page.getByTestId(`addon-widget-text-${UI_EVIL_ADDON_ID}/evil-status`)).toHaveText('armed', {
    timeout: 15_000,
  });

  // (b) recorded.
  await expectSecurityEvent(api, 'bridge.scope_denied', {
    addonId: UI_EVIL_ADDON_ID,
    detailMatches: /map\.addLayer/,
  });
});

test('VEKTOR bridge.unknown_method: nicht existierende Bridge-Methoden werden abgelehnt', async ({ page }) => {
  await openAppWithFixture(page);
  const frame = page.frameLocator(`iframe[data-testid="addon-frame-${UI_EVIL_ADDON_ID}"]`);

  // (a) blocked -- both a made-up privileged method and the route-activation
  // method the host deliberately does NOT expose to add-ons.
  await expect(frame.getByTestId('evil-unknown-method-ok')).toHaveText('false');
  await expect(frame.getByTestId('evil-route-activate-ok')).toHaveText('false');

  // (b) recorded, once per attempted method.
  await expectSecurityEvent(api, 'bridge.unknown_method', {
    addonId: UI_EVIL_ADDON_ID,
    detailMatches: /core\.executeSql/,
  });
  await expectSecurityEvent(api, 'bridge.unknown_method', {
    addonId: UI_EVIL_ADDON_ID,
    detailMatches: /route\.activate/,
  });
});

test('VEKTOR route.activate_without_confirm (UI): keine Routen-Aktivierung ohne Nutzerklick', async ({ page }) => {
  let destinationCalls = 0;
  let startCalls = 0;
  await page.route('**/api/v1/navigation/destination', async (route) => {
    destinationCalls += 1;
    await route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":{"code":"E2E_STUB","message":"no routing backend"}}' });
  });
  await page.route('**/api/v1/navigation/start', async (route) => {
    startCalls += 1;
    await route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":{"code":"E2E_STUB","message":"no routing backend"}}' });
  });

  await openAppWithFixture(page);

  // (a) blocked: the fixture's `route.activate` attempt produced NEITHER a
  // navigation call NOR a confirmation banner (it lacks `route.propose` too,
  // so it cannot even ask).
  expect(destinationCalls).toBe(0);
  expect(startCalls).toBe(0);
  await expect(page.getByTestId('addon-route-proposal')).toHaveCount(0);
  const state = await api.get(`${SECURITY_CORE_BASE_URL}/api/v1/navigation/state`, { headers: coreAuth() });
  expect(((await state.json()) as { data: { status: string } }).data.status).toBe('idle');
});

test('VEKTOR events.foreign_topic (Bridge): fremde Topics werden host-seitig abgelehnt', async ({ page }) => {
  await openAppWithFixture(page);
  const frame = page.frameLocator(`iframe[data-testid="addon-frame-${UI_EVIL_ADDON_ID}"]`);

  // (a) blocked -- `events.publish` IS granted; the namespace is the boundary.
  await expect(frame.getByTestId('evil-foreign-topic-ok')).toHaveText('false');

  // (b) recorded.
  await expectSecurityEvent(api, 'events.foreign_topic', {
    addonId: UI_EVIL_ADDON_ID,
    detailMatches: new RegExp(VICTIM_ADDON_ID.replace(/\./g, '\\.')),
  });
});

test('VEKTOR storage.foreign_namespace (Bridge): Traversal-Keys erreichen kein fremdes Add-on', async ({ page }) => {
  await openAppWithFixture(page);
  const frame = page.frameLocator(`iframe[data-testid="addon-frame-${UI_EVIL_ADDON_ID}"]`);

  // (a) blocked, and the victim's data is untouched.
  await expect(frame.getByTestId('evil-storage-escape-ok')).toHaveText('false');
  const victim = await api.get(
    `${SECURITY_CORE_BASE_URL}/api/v1/addons/${VICTIM_ADDON_ID}/storage/secret`,
    { headers: coreAuth() },
  );
  if (victim.status() === 200) {
    expect((await victim.json()) as { data: unknown }).toEqual({ data: 'victim-only' });
  }

  // (b) recorded.
  await expectSecurityEvent(api, 'storage.foreign_namespace', {
    addonId: UI_EVIL_ADDON_ID,
    detailMatches: /storage key/,
  });
});

test('VEKTOR bridge.source_spoofed: eine Nachricht aus einem FREMDEN Fenster wird verworfen', async ({ page }) => {
  await openAppWithFixture(page);

  const widget = page.getByTestId(`addon-widget-text-${UI_EVIL_ADDON_ID}/evil-status`);
  await expect(widget).toHaveText('armed', { timeout: 15_000 });

  // A second, unrelated iframe posts a perfectly well-formed bridge `call`
  // to the host -- claiming to be the evil add-on. The host's ONLY trust
  // anchor is `event.source === iframe.contentWindow`, so this must be
  // dropped without any side effect. (This is the SDK-bypass proof at its
  // sharpest: the message is protocol-valid, only the sender is wrong.)
  await page.evaluate(() => {
    const attacker = document.createElement('iframe');
    attacker.id = 'attacker-frame';
    attacker.srcdoc =
      '<script>window.parent.postMessage(' +
      "{ ns: 'yapaja-addon', v: 1, type: 'call', callId: 'spoof-1', method: 'widgets.update', " +
      "params: { widgetId: 'evil-status', data: { text: 'SPOOFED' } } }, '*');" +
      "window.parent.postMessage({ ns: 'yapaja-addon', v: 1, type: 'security-violation', " +
      "vector: 'ui.parent_dom_access', detail: 'forged-by-attacker-frame' }, '*');" +
      // Split so this source file never contains a literal closing script tag.
      '</scr' + 'ipt>';
    document.body.appendChild(attacker);
  });
  await page.waitForTimeout(1500);

  // (a) blocked: the widget text is unchanged -- the spoofed call never ran.
  await expect(widget).toHaveText('armed', { timeout: 15_000 });

  // (b) recorded (only well-formed add-on traffic from a foreign window is
  // logged -- see `bridge.ts`, which deliberately ignores unrelated chatter).
  await expectSecurityEvent(api, 'bridge.source_spoofed', { addonId: UI_EVIL_ADDON_ID });

  // ... and the attacker's FORGED self-report was never attributed to another
  // add-on: no `ui.parent_dom_access` entry carries the attacker's detail.
  const reports = await fetchSecurityEvents(api, { vector: 'ui.parent_dom_access' });
  expect(reports.every((e) => !e.detail.includes('forged-by-attacker-frame'))).toBe(true);
});

test('Deaktivieren entfernt die UI des Add-ons rückstandsfrei', async ({ page }) => {
  await openAppWithFixture(page);

  const disable = await api.post(
    `${SECURITY_CORE_BASE_URL}/api/v1/addons/${UI_EVIL_ADDON_ID}/disable`,
    { headers: coreAuth() },
  );
  expect(disable.status()).toBe(200);
  await page.evaluate(async () => {
    await window.__yapajaRefreshAddons?.();
  });

  await expect(page.getByTestId(`addon-frame-${UI_EVIL_ADDON_ID}`)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId(`addon-widget-text-${UI_EVIL_ADDON_ID}/evil-status`)).toHaveCount(0);
});
