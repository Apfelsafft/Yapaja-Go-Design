/**
 * E09-T6 -- Sandbox-Escape-Suite, CORE-SEITIGE Vektoren (Wargame W-10, docs/07 §7).
 *
 * Läuft gegen einen ECHTEN, gebauten Core-Prozess (siehe
 * `support/globalSetup.ts`). Nichts hier ist gemockt, gestubbt oder über eine
 * Test-Naht abgeschaltet: jeder Vektor ist eine echte HTTP-/WS-Anfrage mit
 * einem echten scoped Add-on-Token bzw. ein echter Install-Aufruf mit einem
 * echten bösartigen Tarball.
 *
 * Für JEDEN Vektor wird beides geprüft:
 *   (a) der Versuch wurde GEBLOCKT (die beobachtbare Wirkung blieb aus / der
 *       Aufruf lieferte die Ablehnung), und
 *   (b) ein `security`-Event mit der passenden `vector`-Id wurde
 *       aufgezeichnet (`GET /api/v1/security/events`).
 *
 * Die Nachweistabelle je Vektor steht in `README.md`.
 */

import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import WebSocket from 'ws';
import {
  EVIL_ADDON_ID,
  SECURITY_ADDON_STORAGE_DIR,
  SECURITY_CORE_BASE_URL,
  SECURITY_CORE_PORT,
  SECURITY_CORE_TOKEN,
  VICTIM_ADDON_ID,
} from './support/constants.js';
import {
  buildAbsolutePathTarball,
  buildBombTarball,
  buildEvilFixtureTarball,
  buildHardlinkTarball,
  buildSymlinkTarball,
  buildTraversalTarball,
  coreAuth,
  expectNoSecretsInSecurityLog,
  expectSecurityEvent,
  fetchSecurityEvents,
  installAndEnable,
  installTarball,
  issueAddonToken,
  minimalManifest,
} from './support/helpers.js';
import { buildTarball } from '../../apps/core/src/addons/__fixtures__/buildTarball.js';

/** An add-on that DECLARED a loopback host -- the SSRF-into-the-Core attempt. */
const SSRF_ADDON_ID = 'com.example.ssrf-fixture';

let api: APIRequestContext;
let evilToken = '';
let ssrfToken = '';

/** `$YAPAJA_DATA_DIR/evil-probe.json` -- what the SERVICE process observed. */
function readServiceProbe(): Record<string, { ok?: boolean; status?: number | null; code?: string }> | null {
  const path = join(SECURITY_ADDON_STORAGE_DIR, EVIL_ADDON_ID, 'evil-probe.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, { ok?: boolean; status?: number | null; code?: string }>;
  } catch {
    return null;
  }
}

async function waitForServiceProbe(timeoutMs = 30_000): Promise<Record<string, { ok?: boolean; status?: number | null; code?: string }>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const probe = readServiceProbe();
    if (probe && probe.finishedAt !== undefined) return probe;
    if (Date.now() > deadline) {
      throw new Error(`the evil fixture's service never wrote evil-probe.json (got: ${JSON.stringify(probe)})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  api = await playwrightRequest.newContext();

  // --- an innocent VICTIM add-on with real data to steal ------------------
  const victim = await buildTarball(
    [
      {
        name: 'yapaja-addon.json',
        content: JSON.stringify(minimalManifest(VICTIM_ADDON_ID, ['storage.own'])),
      },
    ],
    { gzip: true },
  );
  await installAndEnable(api, victim, VICTIM_ADDON_ID);
  const seed = await api.put(
    `${SECURITY_CORE_BASE_URL}/api/v1/addons/${VICTIM_ADDON_ID}/storage/secret`,
    { headers: coreAuth({ 'content-type': 'application/json' }), data: { value: 'victim-only' } },
  );
  expect(seed.status()).toBe(200);

  // --- an add-on that DECLARED a loopback egress host ---------------------
  const ssrf = await buildTarball(
    [
      {
        name: 'yapaja-addon.json',
        content: JSON.stringify(
          minimalManifest(SSRF_ADDON_ID, ['pos.read', `net.fetch:127.0.0.1:${SECURITY_CORE_PORT}`]),
        ),
      },
    ],
    { gzip: true },
  );
  await installAndEnable(api, ssrf, SSRF_ADDON_ID);
  ssrfToken = await issueAddonToken(api, SSRF_ADDON_ID);

  // --- THE EVIL FIXTURE, installed through the REAL install API ----------
  const { bytes } = await buildEvilFixtureTarball();
  await installAndEnable(api, bytes, EVIL_ADDON_ID);
  evilToken = await issueAddonToken(api, EVIL_ADDON_ID);
});

test.afterAll(async () => {
  await api.dispose();
});

/** Every request below carries the EVIL add-on's own scoped token. */
function evilAuth(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${evilToken}`, ...extra };
}

// ===========================================================================
// core.scope_denied -- the default-deny route matrix
// ===========================================================================

test('VEKTOR core.scope_denied: eine nicht freigegebene Core-Route ist geblockt und geloggt', async () => {
  const settings = await api.get(`${SECURITY_CORE_BASE_URL}/api/v1/settings`, { headers: evilAuth() });
  // (a) blocked -- and the response body carries NO settings data.
  expect(settings.status()).toBe(403);
  expect(await settings.text()).not.toContain('onboarding_state');

  // The security log itself is likewise unreachable for an add-on (task
  // acceptance: the endpoint is default-denied to add-on principals).
  const readLog = await api.get(`${SECURITY_CORE_BASE_URL}/api/v1/security/events`, { headers: evilAuth() });
  expect(readLog.status()).toBe(403);
  const writeLog = await api.post(`${SECURITY_CORE_BASE_URL}/api/v1/security/events`, {
    headers: evilAuth({ 'content-type': 'application/json' }),
    data: { vector: 'ui.parent_dom_access', addon_id: VICTIM_ADDON_ID, detail: 'forged' },
  });
  expect(writeLog.status()).toBe(403);

  // Nor may it rotate the Core's own API token.
  const rotate = await api.post(`${SECURITY_CORE_BASE_URL}/api/v1/auth/token`, { headers: evilAuth() });
  expect(rotate.status()).toBe(403);

  // (b) recorded.
  const event = await expectSecurityEvent(api, 'core.scope_denied', {
    addonId: EVIL_ADDON_ID,
    detailMatches: /\/api\/v1\/settings/,
  });
  expect(event.detail).toContain('ROUTE_NOT_ALLOWED');

  // The Core token is still the ONLY thing that works there.
  const asOperator = await api.get(`${SECURITY_CORE_BASE_URL}/api/v1/settings`, { headers: coreAuth() });
  expect(asOperator.status()).toBe(200);
});

// ===========================================================================
// route.activate_without_confirm -- an add-on may propose, never activate
// ===========================================================================

test('VEKTOR route.activate_without_confirm: Navigation lässt sich ohne Nutzer-Ja nicht aktivieren', async () => {
  const before = await api.get(`${SECURITY_CORE_BASE_URL}/api/v1/navigation/state`, { headers: coreAuth() });
  expect(before.status()).toBe(200);
  const beforeState = (await before.json()) as { data: { status: string } };
  expect(beforeState.data.status).toBe('idle');

  for (const path of ['navigation/start', 'navigation/destination', 'navigation/resume']) {
    const res = await api.post(`${SECURITY_CORE_BASE_URL}/api/v1/${path}`, {
      headers: evilAuth({ 'content-type': 'application/json' }),
      data: { latlng: { lat: 47.4, lng: 9.7 }, route_id: 'anything' },
    });
    expect(res.status(), `${path} must be refused`).toBe(403);
  }

  // (a) blocked: navigation state is BIT-FOR-BIT what it was.
  const after = await api.get(`${SECURITY_CORE_BASE_URL}/api/v1/navigation/state`, { headers: coreAuth() });
  const afterState = (await after.json()) as { data: { status: string } };
  expect(afterState.data.status).toBe('idle');

  // (b) recorded.
  await expectSecurityEvent(api, 'route.activate_without_confirm', {
    addonId: EVIL_ADDON_ID,
    detailMatches: /navigation\/start/,
  });
});

// ===========================================================================
// events.foreign_topic -- REST publish + WS subscribe
// ===========================================================================

test('VEKTOR events.foreign_topic (REST): kein Publizieren außerhalb addon/{id}/*', async () => {
  // 1. Another add-on's namespace -- REFUSED outright (403 + event).
  const hijackOther = await api.post(`${SECURITY_CORE_BASE_URL}/api/v1/addons/${EVIL_ADDON_ID}/events`, {
    headers: evilAuth({ 'content-type': 'application/json' }),
    data: { topic: `addon/${VICTIM_ADDON_ID}/started`, payload: {} },
  });
  expect(hijackOther.status()).toBe(403);
  expect((await hijackOther.json()) as { error: { code: string } }).toMatchObject({
    error: { code: 'TOPIC_NOT_ALLOWED' },
  });

  // 2. A CORE topic (`nav/state`) -- the Core does not refuse this one, it
  //    REWRITES it into the add-on's own namespace
  //    (`scopeMatrix.ts#normalizeAddonEventTopic`). That is a stronger
  //    guarantee than a refusal, and it is asserted as such rather than
  //    glossed over: the attempt is contained, so there is nothing to refuse.
  //    We therefore prove containment DIRECTLY, on the bus, with an
  //    independent Core-token WS client -- see below.
  const coreSocket = new WebSocket(
    `ws://127.0.0.1:${SECURITY_CORE_PORT}/ws/v1?token=${encodeURIComponent(SECURITY_CORE_TOKEN)}`,
  );
  const received: Array<Record<string, unknown>> = [];
  await new Promise<void>((resolve, reject) => {
    coreSocket.once('open', () => resolve());
    coreSocket.once('error', reject);
  });
  coreSocket.on('message', (raw) => received.push(JSON.parse(raw.toString()) as Record<string, unknown>));
  // The operator's client listens to EVERYTHING, so nothing can hide.
  coreSocket.send(JSON.stringify({ type: 'subscribe', topics: ['*'] }));
  await new Promise((resolve) => setTimeout(resolve, 300));

  const hijackCore = await api.post(`${SECURITY_CORE_BASE_URL}/api/v1/addons/${EVIL_ADDON_ID}/events`, {
    headers: evilAuth({ 'content-type': 'application/json' }),
    data: { topic: 'nav/state', payload: { status: 'navigating', hijacked: true } },
  });
  expect(hijackCore.status()).toBe(202);
  // The Core tells the caller exactly what it actually published.
  expect((await hijackCore.json()) as { data: { topic: string } }).toMatchObject({
    data: { topic: `addon/${EVIL_ADDON_ID}/nav/state` },
  });
  await new Promise((resolve) => setTimeout(resolve, 800));

  // (a) blocked: NOTHING was published on the real `nav/state` topic, and
  // nothing landed in any namespace but the add-on's own.
  const topics = received.map((m) => String(m.topic ?? ''));
  expect(topics).toContain(`addon/${EVIL_ADDON_ID}/nav/state`);
  expect(topics).not.toContain('nav/state');
  const hijacked = received.filter(
    (m) =>
      typeof m.topic === 'string' &&
      !String(m.topic).startsWith(`addon/${EVIL_ADDON_ID}/`) &&
      (m.payload as { hijacked?: boolean } | null)?.hijacked === true,
  );
  expect(hijacked).toEqual([]);
  coreSocket.close();

  // Positive control: its own namespace works normally.
  const own = await api.post(`${SECURITY_CORE_BASE_URL}/api/v1/addons/${EVIL_ADDON_ID}/events`, {
    headers: evilAuth({ 'content-type': 'application/json' }),
    data: { topic: 'noise', payload: { ok: true } },
  });
  expect(own.status()).toBe(202);

  // (b) recorded, for the refused foreign-namespace attempt.
  await expectSecurityEvent(api, 'events.foreign_topic', {
    addonId: EVIL_ADDON_ID,
    detailMatches: new RegExp(VICTIM_ADDON_ID.replace(/\./g, '\\.')),
  });
});

test('VEKTOR events.foreign_topic (WS): fremde Topics werden nicht abonniert und geloggt', async () => {
  const socket = new WebSocket(
    `ws://127.0.0.1:${SECURITY_CORE_PORT}/ws/v1?token=${encodeURIComponent(evilToken)}`,
  );
  const errors: Array<Record<string, unknown>> = [];
  const delivered: Array<Record<string, unknown>> = [];

  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  socket.on('message', (raw) => {
    const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
    if (msg.type === 'error') errors.push(msg);
    else delivered.push(msg);
  });

  // A bare `*`, another add-on's namespace, and a Core topic family it has no
  // scope for -- all three must be refused.
  socket.send(
    JSON.stringify({
      type: 'subscribe',
      topics: ['*', `addon/${VICTIM_ADDON_ID}/*`, 'nav/state', `addon/${EVIL_ADDON_ID}/*`],
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 800));

  // (a) blocked: exactly the three forbidden patterns were refused.
  expect(errors.map((e) => e.topic).sort()).toEqual(
    ['*', `addon/${VICTIM_ADDON_ID}/*`, 'nav/state'].sort(),
  );

  // Positive control: the add-on's OWN namespace subscription still works, so
  // the refusals are the topic rule and not a dead socket.
  const publish = await api.post(`${SECURITY_CORE_BASE_URL}/api/v1/addons/${EVIL_ADDON_ID}/events`, {
    headers: evilAuth({ 'content-type': 'application/json' }),
    data: { topic: 'ws-probe', payload: { ok: true } },
  });
  expect(publish.status()).toBe(202);
  await new Promise((resolve) => setTimeout(resolve, 800));
  expect(delivered.map((m) => m.topic)).toContain(`addon/${EVIL_ADDON_ID}/ws-probe`);
  // ... and nothing from anyone else's namespace ever arrived.
  expect(delivered.filter((m) => typeof m.topic === 'string' && !String(m.topic).startsWith(`addon/${EVIL_ADDON_ID}/`))).toEqual([]);

  socket.close();

  // (b) recorded.
  await expectSecurityEvent(api, 'events.foreign_topic', {
    addonId: EVIL_ADDON_ID,
    detailMatches: new RegExp(`WS subscribe "addon/${VICTIM_ADDON_ID.replace(/\./g, '\\.')}`),
  });
  await expectSecurityEvent(api, 'core.scope_denied', {
    addonId: EVIL_ADDON_ID,
    detailMatches: /WS subscribe "\*"/,
  });
});

// ===========================================================================
// storage.foreign_namespace
// ===========================================================================

test('VEKTOR storage.foreign_namespace: fremder Namespace + Traversal-Keys sind geblockt und geloggt', async () => {
  // 1. Another add-on's namespace by id.
  const foreign = await api.put(
    `${SECURITY_CORE_BASE_URL}/api/v1/addons/${VICTIM_ADDON_ID}/storage/secret`,
    { headers: evilAuth({ 'content-type': 'application/json' }), data: { value: 'pwned' } },
  );
  expect(foreign.status()).toBe(403);

  // 2/3/4. Traversal, percent-encoded traversal, absolute key -- inside its
  // OWN (allowed) namespace, so only the KEY shape can refuse them.
  for (const key of [
    encodeURIComponent('../other/secret'),
    '%2e%2e%2fother%2fsecret',
    encodeURIComponent('/etc/passwd'),
    encodeURIComponent('..\\other'),
  ]) {
    const res = await api.put(
      `${SECURITY_CORE_BASE_URL}/api/v1/addons/${EVIL_ADDON_ID}/storage/${key}`,
      { headers: evilAuth({ 'content-type': 'application/json' }), data: { value: 'pwned' } },
    );
    expect(res.status(), `storage key ${key} must be refused`).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'INVALID_KEY' },
    });
  }

  // (a) blocked: the victim's data is UNCHANGED, byte for byte.
  const victimValue = await api.get(
    `${SECURITY_CORE_BASE_URL}/api/v1/addons/${VICTIM_ADDON_ID}/storage/secret`,
    { headers: coreAuth() },
  );
  expect(victimValue.status()).toBe(200);
  expect((await victimValue.json()) as { data: unknown }).toEqual({ data: 'victim-only' });

  // Positive control: a normal key in its own namespace still works.
  const own = await api.put(`${SECURITY_CORE_BASE_URL}/api/v1/addons/${EVIL_ADDON_ID}/storage/mine`, {
    headers: evilAuth({ 'content-type': 'application/json' }),
    data: { value: 1 },
  });
  expect(own.status()).toBe(200);

  // (b) recorded -- both the foreign-id and the key-shape refusals.
  await expectSecurityEvent(api, 'storage.foreign_namespace', {
    addonId: EVIL_ADDON_ID,
    detailMatches: /FOREIGN_ADDON/,
  });
  await expectSecurityEvent(api, 'storage.foreign_namespace', {
    addonId: EVIL_ADDON_ID,
    detailMatches: /storage key/,
  });
});

// ===========================================================================
// egress.host_not_declared
// ===========================================================================

test('VEKTOR egress.host_not_declared: Proxy zu nicht deklariertem Host ist geblockt und geloggt', async () => {
  // The evil fixture declares NO `net.fetch:<host>` at all.
  const undeclared = await api.get(
    `${SECURITY_CORE_BASE_URL}/api/v1/addons/proxy?url=${encodeURIComponent('https://evil.example.com/exfiltrate')}`,
    { headers: evilAuth() },
  );
  // (a) blocked -- refused BEFORE any socket is opened (the response is the
  // Core's own 403, not an upstream error).
  expect(undeclared.status()).toBe(403);
  expect((await undeclared.json()) as { error: { code: string } }).toMatchObject({
    error: { code: 'HOST_NOT_ALLOWED' },
  });

  // The look-alike classics, with a DECLARED host in the string.
  for (const url of [
    `https://127.0.0.1.evil.example.com/`,
    `https://user:pw@127.0.0.1:${SECURITY_CORE_PORT}/api/v1/settings`,
    `file:///etc/passwd`,
  ]) {
    const res = await api.get(
      `${SECURITY_CORE_BASE_URL}/api/v1/addons/proxy?url=${encodeURIComponent(url)}`,
      { headers: { authorization: `Bearer ${ssrfToken}` } },
    );
    expect([400, 403], `proxy must refuse ${url}`).toContain(res.status());
  }

  // SSRF back into the Core's OWN API, from an add-on that genuinely DECLARED
  // the loopback host -- still refused (`isPrivateOrLoopbackHost`).
  const ssrf = await api.get(
    `${SECURITY_CORE_BASE_URL}/api/v1/addons/proxy?url=${encodeURIComponent(`http://127.0.0.1:${SECURITY_CORE_PORT}/api/v1/settings`)}`,
    { headers: { authorization: `Bearer ${ssrfToken}` } },
  );
  expect(ssrf.status()).toBe(403);
  expect((await ssrf.json()) as { error: { code: string } }).toMatchObject({
    error: { code: 'PRIVATE_HOST_NOT_ALLOWED' },
  });

  // (b) recorded, for both add-ons.
  await expectSecurityEvent(api, 'egress.host_not_declared', {
    addonId: EVIL_ADDON_ID,
    detailMatches: /HOST_NOT_ALLOWED|no net\.fetch/,
  });
  await expectSecurityEvent(api, 'egress.host_not_declared', {
    addonId: SSRF_ADDON_ID,
    detailMatches: /PRIVATE_HOST_NOT_ALLOWED/,
  });
});

// ===========================================================================
// fs.outside_datadir -- the SERVICE process
// ===========================================================================

test('VEKTOR fs.outside_datadir: der Service-Prozess kommt nicht aus seinem DATA_DIR heraus', async () => {
  const probe = await waitForServiceProbe();

  // (a) blocked -- reported by the add-on's OWN process through the
  // filesystem (not the HTTP layer it is also attacking), exactly like the
  // E09-T3 plausibility fixture.
  expect(probe.fs_read_core_db?.ok, 'the add-on must not read the Core DB').toBe(false);
  expect(probe.fs_read_etc_passwd?.ok, 'the add-on must not read /etc/passwd').toBe(false);
  expect(probe.fs_write_outside_storage?.ok, 'the add-on must not write outside its storage dir').toBe(false);

  // (b) recorded by the Core from the child's own permission-model denial.
  await expectSecurityEvent(api, 'fs.outside_datadir', { addonId: EVIL_ADDON_ID });
});

test('der Service-Prozess wird bei JEDEM seiner HTTP-Versuche ebenfalls abgewiesen', async () => {
  const probe = await waitForServiceProbe();
  // Everything the service tried over HTTP with its scoped token.
  const mustBeRefused = [
    'storage_foreign_addon',
    'storage_traversal_key',
    'storage_percent_encoded_traversal',
    'storage_absolute_key',
    'egress_proxy_undeclared',
    'nav_start_without_confirm',
    'nav_destination_without_confirm',
    'events_foreign_topic',
    'events_other_addon_namespace',
    'core_settings_read',
    'core_security_log_read',
    'core_security_log_write',
    'core_auth_token_rotate',
  ];
  for (const key of mustBeRefused) {
    expect(probe[key], `service probe is missing ${key}`).toBeDefined();
    expect(probe[key]?.ok, `${key} must have been refused`).toBe(false);
    expect([400, 401, 403], `${key} returned ${String(probe[key]?.status)}`).toContain(probe[key]?.status);
  }
});

// ===========================================================================
// Tarball-Angriffe -- durch die ECHTE Install-API
// ===========================================================================

test('VEKTOR tarball.path_traversal: `../`- und absolute Einträge werden über die echte Install-API abgewiesen', async () => {
  for (const build of [buildTraversalTarball, buildAbsolutePathTarball]) {
    const outcome = await installTarball(api, await build());
    // (a) blocked at step 1 -- nothing is ever written to disk.
    expect(outcome.beginStatus).toBe(400);
    expect(outcome.errorCode).toBe('TARBALL_REJECTED');
  }
  expect(existsSync('/etc/yapaja-pwned.txt')).toBe(false);

  // (b) recorded.
  await expectSecurityEvent(api, 'tarball.path_traversal');
});

test('VEKTOR tarball.symlink: Symlink- und Hardlink-Einträge werden abgewiesen', async () => {
  for (const build of [buildSymlinkTarball, buildHardlinkTarball]) {
    const outcome = await installTarball(api, await build());
    expect(outcome.beginStatus).toBe(400);
    expect(outcome.errorCode).toBe('TARBALL_REJECTED');
  }
  await expectSecurityEvent(api, 'tarball.symlink');
});

test('VEKTOR tarball.zip_bomb: eine 60-MB-Bombe wird an der Auspack-Obergrenze gestoppt', async () => {
  const bomb = await buildBombTarball();
  // The COMPRESSED payload is tiny -- only the streaming uncompressed counter
  // can stop this, which is the point.
  expect(bomb.length).toBeLessThan(1024 * 1024);
  const outcome = await installTarball(api, bomb);
  expect(outcome.beginStatus).toBe(400);
  expect(outcome.errorCode).toBe('TARBALL_REJECTED');
  expect(outcome.errorMessage ?? '').toMatch(/uncompressed/i);

  await expectSecurityEvent(api, 'tarball.zip_bomb');
});

// ===========================================================================
// token.replay_after_disable -- MUST run last (it disables the fixture)
// ===========================================================================

test('VEKTOR token.replay_after_disable: das Token eines deaktivierten Add-ons ist sofort wertlos', async () => {
  // Proof the token WAS live a moment ago.
  const before = await api.get(`${SECURITY_CORE_BASE_URL}/api/v1/position`, { headers: evilAuth() });
  expect(before.status()).not.toBe(401);
  expect(before.status()).not.toBe(403);

  const disable = await api.post(`${SECURITY_CORE_BASE_URL}/api/v1/addons/${EVIL_ADDON_ID}/disable`, {
    headers: coreAuth(),
  });
  expect(disable.status()).toBe(200);

  // (a) blocked. NOTE the Core here enforces `API_AUTH_TOKEN`, so a token the
  // add-on layer no longer recognises falls through to the ordinary Core-token
  // check and is 401 -- it does NOT silently become an anonymous LAN client.
  const replay = await api.get(`${SECURITY_CORE_BASE_URL}/api/v1/position`, { headers: evilAuth() });
  expect(replay.status()).toBe(401);

  const replayStorage = await api.get(
    `${SECURITY_CORE_BASE_URL}/api/v1/addons/${EVIL_ADDON_ID}/storage/mine`,
    { headers: evilAuth() },
  );
  expect(replayStorage.status()).toBe(401);

  // Its UI is gone too (the enabled-gate in `ui-host.ts`).
  const ui = await api.get(`${SECURITY_CORE_BASE_URL}/addons/${EVIL_ADDON_ID}/ui/index.html`);
  expect(ui.status()).toBe(404);

  // (b) recorded.
  await expectSecurityEvent(api, 'token.replay_after_disable', { addonId: EVIL_ADDON_ID });
});

// ===========================================================================
// Querschnitt: das Sicherheitslog selbst
// ===========================================================================

test('das Security-Log enthält NIEMALS ein Token oder anderes Geheimnis', async () => {
  await expectNoSecretsInSecurityLog(api, [evilToken, ssrfToken, SECURITY_CORE_TOKEN]);
});

test('jeder core-seitige Pflichtvektor hat mindestens ein aufgezeichnetes Event', async () => {
  const required = [
    'core.scope_denied',
    'route.activate_without_confirm',
    'events.foreign_topic',
    'storage.foreign_namespace',
    'egress.host_not_declared',
    'fs.outside_datadir',
    'token.replay_after_disable',
    'tarball.path_traversal',
    'tarball.symlink',
    'tarball.zip_bomb',
  ];
  const missing: string[] = [];
  for (const vector of required) {
    if ((await fetchSecurityEvents(api, { vector })).length === 0) missing.push(vector);
  }
  expect(missing, `vectors without a recorded security event: ${missing.join(', ')}`).toEqual([]);
});
