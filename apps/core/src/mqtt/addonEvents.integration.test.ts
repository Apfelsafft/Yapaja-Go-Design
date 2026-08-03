/* eslint-disable no-undef -- setTimeout is a standard Node global (typed via
 * @types/node); the shared eslint config's `globals` list predates this
 * backend module. Same justification as bridge.integration.test.ts. */

/**
 * Add-on -> MQTT republish integration tests (E09-T8), against the SAME
 * real, in-process `aedes` broker harness `bridge.integration.test.ts`/
 * `discovery.integration.test.ts` use (this repo's deliberate Testcontainer
 * substitute -- no Docker broker service in CI; see `bridge.integration.
 * test.ts`'s header comment for the full rationale). UNLIKE those two files
 * (which build a bare `MqttBridge` against stub navigation/profile services),
 * this file drives the add-on side through a REAL `buildServer()` and the
 * REAL `POST /addons/:id/events` route (`../addons/serviceRoutes.ts`) --
 * because the whole point of this task is that an event travels through the
 * REAL namespace guard (`normalizeAddonEventTopic`) before this bridge ever
 * sees it, and the acceptance/plausibility criteria are about THAT full
 * pipeline, not the bridge in isolation.
 *
 * Covers:
 *  1. Acceptance 1: recorder-shaped start/stop events appear as MQTT topics.
 *  2. Acceptance 2: the 5 msg/s rate limit demonstrably bites, independently
 *     per add-on, with a throttle log.
 *  3. Acceptance 3: the "In Home Assistant verfügbar" toggle takes effect on
 *     the very next event -- no restart, no reconnect (the server/bridge in
 *     this test is never restarted between phases).
 *  4. The 16 KB MQTT payload cap (distinct from and tighter than the 64 KB
 *     bus-level cap `serviceRoutes.ts` already enforces).
 *  5. Plausibility: an add-on can never produce an MQTT topic outside
 *     `yapaja/addon/{id}/*` -- including inputs the upstream namespace guard
 *     ALLOWS onto the bus (MQTT wildcards) but this bridge must still refuse
 *     to publish, AND the bridge's own broker connection survives such an
 *     attempt (the concrete DoS `addonTopic.ts`'s doc comment describes).
 *  6. Retain semantics: an add-on event is never retained.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server, type Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { Aedes } from 'aedes';
import { connect as mqttConnect, type MqttClient } from 'mqtt';
import type { FastifyInstance } from 'fastify';
import type { AddonManifest } from '@yapaja/shared';
import { buildServer } from '../index.js';
import { closeDb } from '../db/index.js';
import { AddonRepository } from '../addons/repository.js';
import { AddonTokenService } from '../addons/tokens.js';
import { ADDON_EVENT_RATE_LIMIT_PER_SECOND } from './rateThrottle.js';
import { MAX_ADDON_EVENT_PAYLOAD_BYTES } from './bridge.js';

// --- test broker plumbing (identical pattern to bridge.integration.test.ts) -

interface BrokerCtx {
  broker: Aedes;
  server: Server;
  port: number;
  connections: Socket[];
}

async function startBroker(): Promise<BrokerCtx> {
  const broker = await Aedes.createBroker();
  const server = createServer(broker.handle);
  const connections: Socket[] = [];
  server.on('connection', (socket) => connections.push(socket));
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { broker, server, port, connections };
}

function stopBroker(ctx: BrokerCtx): Promise<void> {
  return new Promise((resolve) => {
    for (const socket of ctx.connections) socket.destroy();
    ctx.server.close(() => {
      ctx.broker.close(() => resolve());
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate: () => boolean, timeoutMs = 5000, stepMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
    }
    await sleep(stepMs);
  }
}

/** Same as {@link waitUntil}, for an ASYNC predicate (e.g. one that itself
 *  does a `server.inject()` round-trip, like the health-check wait below). */
async function waitUntilAsync(predicate: () => Promise<boolean>, timeoutMs = 5000, stepMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) {
      throw new Error(`waitUntilAsync: condition not met within ${timeoutMs}ms`);
    }
    await sleep(stepMs);
  }
}

interface Recorded {
  topic: string;
  payload: unknown;
  raw: string;
  retain: boolean;
}

function recordMessages(client: MqttClient): Recorded[] {
  const records: Recorded[] = [];
  client.on('message', (topic, payload, packet) => {
    const raw = payload.toString('utf8');
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // not JSON -- keep the raw text
    }
    records.push({ topic, payload: parsed, raw, retain: Boolean(packet.retain) });
  });
  return records;
}

/** See `bridge.integration.test.ts`'s identical helper's doc comment: the
 *  only faithful way to prove "was this stored as a RETAINED message" is a
 *  fresh subscribe after the fact. */
async function collectRetained(brokerUrl: string, topicFilter: string, waitMs = 300): Promise<Recorded[]> {
  const client = mqttConnect(brokerUrl, { reconnectPeriod: 0 });
  client.on('error', () => {});
  await new Promise<void>((resolve) => client.once('connect', () => resolve()));
  const records = recordMessages(client);
  await new Promise<void>((resolve, reject) =>
    client.subscribe(topicFilter, { qos: 1 }, (err) => (err ? reject(err) : resolve())),
  );
  await sleep(waitMs);
  client.end(true);
  return records;
}

// --- add-on fixtures ---------------------------------------------------------

function manifestFor(id: string): AddonManifest {
  return {
    id,
    name: `Test add-on ${id}`,
    version: '1.0.0',
    core_api: '^0.0.0',
    author: 'Test',
    license: 'MIT',
    description: 'events.publish fixture for E09-T8',
    permissions: ['events.publish'],
  };
}

// --- shared harness -----------------------------------------------------------

interface Harness {
  parentDir: string;
  brokerCtx: BrokerCtx;
  brokerUrl: string;
  subscriber: MqttClient;
  records: Recorded[];
  server: FastifyInstance;
  repository: AddonRepository;
  tokens: AddonTokenService;
}

function latestOf(records: Recorded[], topic: string): Recorded | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i]!.topic === topic) return records[i];
  }
  return undefined;
}

function countOf(records: Recorded[], topicPrefix: string): number {
  return records.filter((r) => r.topic.startsWith(topicPrefix)).length;
}

/** Installs + enables an add-on with ONLY `events.publish`, and mints it a
 *  scoped token for that one scope -- mirrors `serviceRoutes.test.ts`'s
 *  `tokens.issue(...)` pattern (no child process needed; this task's own
 *  concern is the REST->bus->MQTT path, not the service-host lifecycle
 *  E09-T3 already covers). */
function installAddon(h: Harness, id: string): string {
  h.repository.insert({
    id,
    name: manifestFor(id).name,
    version: '1.0.0',
    manifest: manifestFor(id),
    enabled: true,
    installPath: join(h.parentDir, 'addons', id),
  });
  return h.tokens.issue(id, ['events.publish']);
}

async function publishEvent(
  h: Harness,
  id: string,
  token: string,
  topic: string,
  payload: unknown = { ok: true },
): Promise<number> {
  const res = await h.server.inject({
    method: 'POST',
    url: `/api/v1/addons/${id}/events`,
    headers: { authorization: `Bearer ${token}` },
    payload: { topic, payload },
  });
  return res.statusCode;
}

async function buildHarness(): Promise<Harness> {
  const parentDir = mkdtempSync(join(tmpdir(), 'addon-mqtt-events-'));
  const brokerCtx = await startBroker();
  const brokerUrl = `mqtt://127.0.0.1:${brokerCtx.port}`;

  process.env.ADDONS_DIR = join(parentDir, 'addons');
  process.env.ADDON_STORAGE_DIR = join(parentDir, 'addon-storage');
  process.env.DB_PATH = ':memory:';
  process.env.MQTT_BROKER_URL = brokerUrl;
  closeDb();

  const subscriber = mqttConnect(brokerUrl, { reconnectPeriod: 200 });
  subscriber.on('error', () => {});
  await new Promise<void>((resolve) => subscriber.once('connect', () => resolve()));
  await new Promise<void>((resolve, reject) =>
    subscriber.subscribe('yapaja/#', { qos: 1 }, (err) => (err ? reject(err) : resolve())),
  );
  const records = recordMessages(subscriber);

  const server = await buildServer();
  await server.ready();

  // Wait for the Core's OWN MqttBridge (constructed inside buildServer() from
  // MQTT_BROKER_URL above) to actually connect -- `/api/v1/health` is the
  // only externally-observable signal for that (`mqttBridge` itself is not
  // decorated onto the fastify instance).
  await waitUntilAsync(async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/health' });
    return (JSON.parse(res.body) as { services: { mqtt: string } }).services.mqtt === 'ok';
  });

  const repository = new AddonRepository();
  const tokens = new AddonTokenService({ repository });

  return { parentDir, brokerCtx, brokerUrl, subscriber, records, server, repository, tokens };
}

async function teardownHarness(h: Harness): Promise<void> {
  await h.server.close();
  closeDb();
  delete process.env.ADDONS_DIR;
  delete process.env.ADDON_STORAGE_DIR;
  delete process.env.DB_PATH;
  delete process.env.MQTT_BROKER_URL;
  h.subscriber.end(true);
  await stopBroker(h.brokerCtx);
  rmSync(h.parentDir, { recursive: true, force: true });
}

// --- tests --------------------------------------------------------------------

describe('add-on events.publish -> MQTT republish (E09-T8, real Core + real broker)', () => {
  let h: Harness;
  const wait = (predicate: () => boolean) => waitUntil(predicate);

  beforeEach(async () => {
    h = await buildHarness();
  });

  afterEach(async () => {
    await teardownHarness(h);
  });

  // --- acceptance 1: recorder-shaped start/stop events ------------------------
  it('acceptance 1: recorder start/stop events appear as MQTT topics', async () => {
    const id = 'com.yapaja.track-recorder-fixture';
    const token = installAddon(h, id);

    expect(await publishEvent(h, id, token, 'started', { trackId: 'track-1', startedAt: new Date().toISOString() })).toBe(202);
    await wait(() => Boolean(latestOf(h.records, `yapaja/addon/${id}/started`)));
    const started = latestOf(h.records, `yapaja/addon/${id}/started`)!;
    expect(started.payload).toMatchObject({ trackId: 'track-1' });
    expect(started.retain).toBe(false);

    expect(
      await publishEvent(h, id, token, 'stopped', {
        trackId: 'track-1',
        distanceMeters: 1234.5,
        pointCount: 42,
      }),
    ).toBe(202);
    await wait(() => Boolean(latestOf(h.records, `yapaja/addon/${id}/stopped`)));
    const stopped = latestOf(h.records, `yapaja/addon/${id}/stopped`)!;
    expect(stopped.payload).toMatchObject({ trackId: 'track-1', distanceMeters: 1234.5 });
  });

  // --- acceptance 2: rate limit demonstrably bites -----------------------------
  it('acceptance 2: the 5 msg/s rate limit bites -- exactly 5 of 8 rapid events reach MQTT', async () => {
    const id = 'com.example.chatty';
    const token = installAddon(h, id);

    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      statuses.push(await publishEvent(h, id, token, 'tick', { i }));
    }
    // The REST layer itself does not rate-limit -- every well-formed request
    // is accepted onto the bus (202). The limit is enforced ONLY at the
    // MQTT-republish stage, so this is the control that proves the next
    // assertion is really about the bridge, not a REST-level rejection.
    expect(statuses).toEqual(new Array(8).fill(202));

    await sleep(300); // let the bridge drain whatever it will publish
    const delivered = countOf(h.records, `yapaja/addon/${id}/tick`);
    expect(delivered).toBe(ADDON_EVENT_RATE_LIMIT_PER_SECOND);
  });

  it('acceptance 2: the rate limit is independent PER add-on -- a flooding add-on cannot starve another', async () => {
    const chattyId = 'com.example.chatty-2';
    const quietId = 'com.example.quiet';
    const chattyToken = installAddon(h, chattyId);
    const quietToken = installAddon(h, quietId);

    for (let i = 0; i < 8; i++) {
      await publishEvent(h, chattyId, chattyToken, 'tick', { i });
    }
    // The quiet add-on's SINGLE event still gets through, even though the
    // chatty one just blew through its own budget in the same window.
    expect(await publishEvent(h, quietId, quietToken, 'tick', { i: 0 })).toBe(202);

    await sleep(300);
    expect(countOf(h.records, `yapaja/addon/${chattyId}/tick`)).toBe(ADDON_EVENT_RATE_LIMIT_PER_SECOND);
    expect(countOf(h.records, `yapaja/addon/${quietId}/tick`)).toBe(1);
  });

  // --- payload cap --------------------------------------------------------------
  it('drops a payload over the 16 KB MQTT cap that the 64 KB bus-level cap still accepts', async () => {
    const id = 'com.example.big-payload';
    const token = installAddon(h, id);

    // 20 KB: over MAX_ADDON_EVENT_PAYLOAD_BYTES (16 KB) but comfortably under
    // the bus-level DEFAULT_MAX_EVENT_PAYLOAD_BYTES (64 KB, serviceRoutes.ts)
    // -- proves the NEW cap is a distinct, tighter gate at the MQTT stage,
    // not a duplicate of the existing REST-level one.
    const bigBlob = 'x'.repeat(20 * 1024);
    expect(Buffer.byteLength(JSON.stringify({ blob: bigBlob }), 'utf8')).toBeGreaterThan(MAX_ADDON_EVENT_PAYLOAD_BYTES);
    const status = await publishEvent(h, id, token, 'big', { blob: bigBlob });
    expect(status).toBe(202); // accepted onto the bus...

    await sleep(200);
    expect(latestOf(h.records, `yapaja/addon/${id}/big`)).toBeUndefined(); // ...but never reaches MQTT
  });

  it('publishes a payload comfortably under the 16 KB cap normally', async () => {
    const id = 'com.example.small-payload';
    const token = installAddon(h, id);
    expect(await publishEvent(h, id, token, 'small', { blob: 'x'.repeat(1024) })).toBe(202);
    await wait(() => Boolean(latestOf(h.records, `yapaja/addon/${id}/small`)));
  });

  // --- acceptance 3: toggle takes effect immediately -----------------------------
  it('acceptance 3: the "In Home Assistant verfügbar" toggle takes effect on the VERY NEXT event -- no restart, no reconnect', async () => {
    const id = 'com.example.toggle';
    const token = installAddon(h, id);

    // Phase 1: default (enabled) -- the event arrives.
    expect(await publishEvent(h, id, token, 'phase1')).toBe(202);
    await wait(() => Boolean(latestOf(h.records, `yapaja/addon/${id}/phase1`)));

    // Flip the toggle off through the REAL REST endpoint (Store detail page's
    // "In Home Assistant verfügbar" control). NOTHING about the server or the
    // bridge is restarted here -- same `h.server`/same broker connection for
    // the rest of this test.
    const disableRes = await h.server.inject({ method: 'POST', url: `/api/v1/addons/${id}/mqtt/disable` });
    expect(disableRes.statusCode).toBe(200);
    expect(JSON.parse(disableRes.body).data.mqtt_enabled).toBe(false);

    // Phase 2: the VERY NEXT event, published immediately after, must NOT
    // reach MQTT.
    expect(await publishEvent(h, id, token, 'phase2')).toBe(202); // still accepted onto the bus
    await sleep(250);
    expect(latestOf(h.records, `yapaja/addon/${id}/phase2`)).toBeUndefined();

    // Re-enable, same running bridge -- immediately works again.
    const enableRes = await h.server.inject({ method: 'POST', url: `/api/v1/addons/${id}/mqtt/enable` });
    expect(enableRes.statusCode).toBe(200);
    expect(await publishEvent(h, id, token, 'phase3')).toBe(202);
    await wait(() => Boolean(latestOf(h.records, `yapaja/addon/${id}/phase3`)));

    // The Core's own MQTT connection to the broker was continuously healthy
    // throughout -- proof nothing was torn down/rebuilt to make the toggle work.
    const health = await h.server.inject({ method: 'GET', url: '/api/v1/health' });
    expect((JSON.parse(health.body) as { services: { mqtt: string } }).services.mqtt).toBe('ok');
  });

  // --- plausibility: topic-namespace containment ----------------------------------
  describe('plausibility: an add-on can never publish outside yapaja/addon/{id}/*', () => {
    it('a topic rejected by the upstream namespace guard (403) never reaches MQTT under any Core topic', async () => {
      const id = 'com.example.hostile-namespace';
      const token = installAddon(h, id);

      // `yapaja/cmd/*`/`yapaja/nav/*` ONLY -- never `yapaja/status`/
      // `yapaja/position`: those two are legitimately (re-)published by the
      // bridge's OWN connection lifecycle independent of any add-on activity
      // (e.g. a reconnect under load republishes `status` fresh -- see
      // `handleConnect()` in `bridge.ts`), so a before/after diff on them
      // would be racy under a busy full-suite run. This test never sends a
      // navigation command and no navigation is running, so `cmd`/`nav`
      // staying at an absolute zero is deterministic regardless of load.
      const forbiddenPrefixes = ['yapaja/cmd/', 'yapaja/nav/'];

      for (const hostileTopic of [
        '../cmd/destination',
        '/absolute',
        '*',
        'addon/some-other-addon/x',
      ]) {
        const res = await h.server.inject({
          method: 'POST',
          url: `/api/v1/addons/${id}/events`,
          headers: { authorization: `Bearer ${token}` },
          payload: { topic: hostileTopic, payload: { x: 1 } },
        });
        expect(res.statusCode).toBe(403);
      }

      await sleep(200);
      for (const prefix of forbiddenPrefixes) {
        expect(countOf(h.records, prefix)).toBe(0);
      }
    });

    it('a wildcard suffix the UPSTREAM guard allows onto the bus is still refused at the MQTT stage, AND the bridge connection survives it', async () => {
      const id = 'com.example.hostile-wildcard';
      const token = installAddon(h, id);

      // `normalizeAddonEventTopic` does not forbid `+`/`#` (only `*`, `..`,
      // leading/trailing `/`) -- these all reach the bus, and the REST layer
      // therefore accepts them (202), confirmed below.
      for (const wildcardTopic of ['+', '#', 'a/+/b', 'status/#']) {
        const status = await publishEvent(h, id, token, wildcardTopic, { x: 1 });
        expect(status).toBe(202);
      }

      await sleep(200);
      // None of them reached MQTT under ANY topic.
      expect(countOf(h.records, `yapaja/addon/${id}/`)).toBe(0);
      expect(h.records.some((r) => r.topic.includes('+') || r.topic.includes('#'))).toBe(false);

      // Crucially: the Core's OWN MqttBridge connection is still alive and
      // well -- a hostile add-on could not knock it off the broker (the
      // concrete failure mode this defense exists to prevent, see
      // `addonTopic.ts`'s doc comment and the raw-aedes reproduction test
      // below). Proven by a LEGITIMATE event right after still getting through.
      expect(await publishEvent(h, id, token, 'still-alive', { ok: true })).toBe(202);
      await wait(() => Boolean(latestOf(h.records, `yapaja/addon/${id}/still-alive`)));
      const health = await h.server.inject({ method: 'GET', url: '/api/v1/health' });
      expect((JSON.parse(health.body) as { services: { mqtt: string } }).services.mqtt).toBe('ok');
    });

    it('a suffix that merely SPELLS a reserved/core-looking path just nests harmlessly, never becomes the real topic', async () => {
      const id = 'com.example.hostile-spelling';
      const token = installAddon(h, id);

      for (const spelledSuffix of ['cmd/destination', 'nav/state', '$SYS/broker/uptime', 'status']) {
        expect(await publishEvent(h, id, token, spelledSuffix, { x: 1 })).toBe(202);
      }
      // Wait for the LAST one published -- MQTT preserves publish ORDER on a
      // single connection, so once this (the last) has arrived, every
      // earlier one is guaranteed to have arrived too (avoids a flaky
      // check-too-early race on the earlier topics).
      await wait(() => Boolean(latestOf(h.records, `yapaja/addon/${id}/status`)));

      // Every one of them landed EXACTLY under this add-on's own namespace,
      // never as the bare Core topic of the same name.
      expect(latestOf(h.records, 'yapaja/cmd/destination')).toBeUndefined();
      expect(latestOf(h.records, 'yapaja/nav/state')).toBeUndefined();
      expect(latestOf(h.records, `yapaja/addon/${id}/nav/state`)).toBeDefined();
      expect(latestOf(h.records, `yapaja/addon/${id}/$SYS/broker/uptime`)).toBeDefined();
    });
  });

  // --- retain semantics -----------------------------------------------------------
  it('an add-on event is never retained (transient, like yapaja/event/#)', async () => {
    const id = 'com.example.retain-check';
    const token = installAddon(h, id);
    expect(await publishEvent(h, id, token, 'once', { x: 1 })).toBe(202);
    await wait(() => Boolean(latestOf(h.records, `yapaja/addon/${id}/once`)));

    // A FRESH subscriber connecting afterwards must see NOTHING retained on
    // this add-on's namespace -- the only faithful way to check "retained"
    // (see `collectRetained`'s doc comment).
    const retained = await collectRetained(h.brokerUrl, `yapaja/addon/${id}/#`);
    expect(retained).toEqual([]);
  });
});

// --- why this matters: a raw reproduction of the underlying broker behaviour ---

describe('why buildAddonMqttTopic must reject +/# (raw aedes reproduction, not this repo\'s code)', () => {
  it('aedes disconnects a client that PUBLISHes a topic containing a wildcard character', async () => {
    const brokerCtx = await startBroker();
    const brokerUrl = `mqtt://127.0.0.1:${brokerCtx.port}`;
    const client = mqttConnect(brokerUrl, { reconnectPeriod: 0 });
    client.on('error', () => {});
    await new Promise<void>((resolve) => client.once('connect', () => resolve()));

    const closed = new Promise<void>((resolve) => client.once('close', () => resolve()));
    // This is EXACTLY the shape `buildAddonMqttTopic` refuses to hand to
    // `client.publish()` -- a Topic Name containing `#`. Per the MQTT spec
    // (MQTT-4.7.1-1) this is a protocol violation; aedes enforces it by
    // raising a client error and closing the connection (see its own
    // `test/topics.js`, "publish invalid topic with #").
    client.publish('yapaja/addon/some-addon/#', 'x', { qos: 0 });

    await Promise.race([closed, sleep(2000)]);
    expect(client.connected).toBe(false);

    await stopBroker(brokerCtx);
  });
});
