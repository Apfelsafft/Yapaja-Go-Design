/* eslint-disable no-undef -- setTimeout is a standard Node global (typed via
 * @types/node); the shared eslint config's `globals` list predates this
 * backend module. Same justification as position/service.ts. */

/**
 * MqttBridge integration tests (E08-T1) against a REAL, in-process MQTT
 * broker (`aedes`, a pure-Node MQTT broker library) rather than a Docker/
 * testcontainer setup -- the repo's CI has no broker service and no
 * testcontainers infrastructure, so this is the MQTT analogue of the
 * `fastify.inject()` in-process pattern the rest of the Core's integration
 * tests already use: a REAL `aedes` broker listens on a real (ephemeral)
 * loopback TCP port, the bridge connects with the REAL `mqtt.js` client, and
 * a second REAL `mqtt.js` client (standing in for Home Assistant) subscribes
 * and observes exactly what a real HA MQTT integration would see. Zero
 * mocking of the MQTT protocol itself.
 *
 * A `mosquitto`/real-HA end-to-end pass remains a reasonable NIGHTLY/manual
 * addition (mirrors how other tasks split "real infra -> nightly" vs.
 * "verifiable per-PR", e.g. E05-T4) but is out of scope for this mandatory,
 * Docker-free per-PR suite.
 *
 * Covers docs/03 §4's acceptance criteria:
 *  1. All status topics appear with schema-valid payloads during a
 *     (synthetic) drive.
 *  2. Every command takes effect AND `cmd/result` comes back, including the
 *     error case (unknown favorite -> ok:false).
 *  3. Killing the bridge's connection -> LWT fires (offline); reconnecting
 *     re-publishes the CURRENT state fresh (no stale leftovers).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server, type Socket } from 'node:net';
import { Aedes } from 'aedes';
import { connect as mqttConnect, type MqttClient } from 'mqtt';
import type { Favorite, Route, RouteRequest, VehicleProfile } from '@yapaja/shared';
import { EventBus } from '../bus/index.js';
import { NavigationService, type RouteProvider, type RerouteProvider, type ActiveProfileLookup } from '../navigation/service.js';
import { encodePolyline6 } from '../routing/polyline.js';
import { haversineM, type LatLon } from '../navigation/geo.js';
import { MqttBridge, type MqttProfileLookup, type MqttFavoriteLookup } from './bridge.js';

// --- test broker plumbing ---------------------------------------------------

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

async function waitUntil(predicate: () => boolean, timeoutMs = 3000, stepMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
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
      // Bare-string topics (status, nav/state) stay as raw text.
    }
    records.push({ topic, payload: parsed, raw, retain: Boolean(packet.retain) });
  });
  return records;
}

function latestOf(records: Recorded[], topic: string): Recorded | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i]!.topic === topic) return records[i];
  }
  return undefined;
}

/**
 * Per the MQTT spec (3.3.1.3), a broker MUST clear the RETAIN flag on any
 * PUBLISH it forwards to a client because of a matching LIVE publish -- the
 * flag on a delivered packet is only ever 1 when the message is being sent
 * because the client just (re-)subscribed and the broker is flushing its
 * retained-message store. So the only faithful way to test "was this stored
 * as a retained message on the broker" is a FRESH subscribe after the fact,
 * not `packet.retain` on an already-subscribed live delivery (that's always
 * 0 there, whatever the original publish's retain flag was).
 */
async function collectRetained(brokerUrl: string, topicFilter: string, waitMs = 300): Promise<Recorded[]> {
  const client = mqttConnect(brokerUrl, { reconnectPeriod: 0 });
  // mqtt.js: an 'error' event with no listener throws UNCAUGHT (Node
  // EventEmitter semantics) -- always attach one, even a no-op, per mqtt.js's
  // own docs.
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

// --- test fixtures: a minimal in-memory "routing service" stub -------------

class StubRoutingService implements RouteProvider, RerouteProvider {
  private routes = new Map<string, Route>();
  private nextId = 1;

  seed(route: Route): void {
    this.routes.set(route.id, route);
  }

  getCachedRoute(id: string): Route | null {
    return this.routes.get(id) ?? null;
  }

  async createRoutes(request: RouteRequest): Promise<Route[]> {
    const origin: LatLon = { lat: 47.0, lon: 9.5 };
    const dest = request.destination;
    const distanceM = haversineM(origin, dest);
    const route: Route = {
      id: `stub-route-${this.nextId++}`,
      distance_m: distanceM,
      duration_s: distanceM / 15,
      geometry: encodePolyline6([origin, dest]),
      legs: [{ index: 0, distance_m: distanceM, duration_s: distanceM / 15 }],
      maneuvers: [
        {
          index: 0,
          type: 'continue',
          instruction: 'Depart',
          street_names: ['Teststraße'],
          distance_m: distanceM,
          begin_shape_index: 0,
        },
      ],
      speed_limits: [],
      warnings: [],
    };
    this.routes.set(route.id, route);
    return [route];
  }
}

function makeProfile(overrides: Partial<VehicleProfile> = {}): VehicleProfile {
  return {
    id: 'p1',
    name: 'Camper',
    height_m: 3.0,
    width_m: 2.2,
    length_m: 6.5,
    weight_t: 3.5,
    avg_speed_kmh: 85,
    hazmat: false,
    avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
    is_active: true,
    dimensions_confirmed_at: null,
    ...overrides,
  };
}

class StubProfileService implements MqttProfileLookup, ActiveProfileLookup {
  private profiles: VehicleProfile[];
  activated: string[] = [];

  constructor(profiles: VehicleProfile[]) {
    this.profiles = profiles;
  }

  getActive(): VehicleProfile | null {
    return this.profiles.find((p) => p.is_active) ?? null;
  }
  getById(id: string): VehicleProfile | null {
    return this.profiles.find((p) => p.id === id) ?? null;
  }
  getAll(): VehicleProfile[] {
    return this.profiles;
  }
  activate(id: string): VehicleProfile {
    const found = this.profiles.find((p) => p.id === id);
    if (!found) throw new Error(`Profile ${id} not found`);
    this.profiles = this.profiles.map((p) => ({ ...p, is_active: p.id === id }));
    this.activated.push(id);
    return found;
  }
}

class StubFavoriteService implements MqttFavoriteLookup {
  constructor(private readonly favorites: Favorite[]) {}
  getAll(): Favorite[] {
    return this.favorites;
  }
}

/** A short, decodable route for driving through `NavigationService.start()`. */
function buildDriveRoute(points: LatLon[]): Route {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineM(points[i - 1]!, points[i]!);
  return {
    id: 'drive-route-1',
    distance_m: total,
    duration_s: total / 15,
    geometry: encodePolyline6(points),
    legs: [{ index: 0, distance_m: total, duration_s: total / 15 }],
    maneuvers: [
      {
        index: 0,
        type: 'continue',
        instruction: 'Depart',
        street_names: ['Fahrweg'],
        distance_m: total,
        begin_shape_index: 0,
      },
    ],
    speed_limits: [],
    warnings: [],
  };
}

function routePoints(): LatLon[] {
  const pts: LatLon[] = [];
  for (let i = 0; i <= 10; i++) pts.push({ lat: 47.0 + i * 0.001, lon: 9.5 });
  return pts;
}

// --- shared per-test harness -------------------------------------------------

interface Harness {
  brokerCtx: BrokerCtx;
  subscriber: MqttClient;
  records: Recorded[];
  bus: EventBus;
  navigationService: NavigationService;
  routing: StubRoutingService;
  profileService: StubProfileService;
  favoriteService: StubFavoriteService;
  bridge: MqttBridge;
}

async function buildHarness(): Promise<Harness> {
  const brokerCtx = await startBroker();
  const brokerUrl = `mqtt://127.0.0.1:${brokerCtx.port}`;

  // Subscriber connects FIRST so it is the broker's connection #0 and the
  // bridge (connected next) is deterministically connection #1 -- the
  // reconnect test relies on being able to sever exactly the bridge's socket.
  const subscriber = mqttConnect(brokerUrl, { reconnectPeriod: 200 });
  subscriber.on('error', () => {});
  await new Promise<void>((resolve) => subscriber.once('connect', () => resolve()));
  await new Promise<void>((resolve, reject) =>
    subscriber.subscribe('yapaja/#', { qos: 1 }, (err) => (err ? reject(err) : resolve())),
  );
  const records = recordMessages(subscriber);

  const bus = new EventBus({ isProduction: false });
  const routing = new StubRoutingService();
  const navigationService = new NavigationService({ bus, routeProvider: routing, rerouteProvider: routing });
  const profileService = new StubProfileService([makeProfile()]);
  const favoriteService = new StubFavoriteService([
    { id: 'f1', name: 'Zuhause', latlng: { lat: 47.02, lon: 9.51 }, icon: 'home', category: 'home', sort_order: 0 },
  ]);

  const bridge = new MqttBridge({
    bus,
    brokerUrl,
    prefix: 'yapaja',
    navigationService,
    profileService,
    favoriteService,
    routeProvider: routing,
    rerouteProvider: routing,
    profileProvider: profileService,
    reconnect: { minMs: 100, maxMs: 400 },
    connectTimeoutMs: 2000,
  });

  await waitUntil(() => bridge.isConnected());
  await waitUntil(() => Boolean(latestOf(records, 'yapaja/status')));

  return { brokerCtx, subscriber, records, bus, navigationService, routing, profileService, favoriteService, bridge };
}

async function teardownHarness(h: Harness): Promise<void> {
  h.bridge.dispose();
  h.navigationService.dispose();
  h.subscriber.end(true);
  await stopBroker(h.brokerCtx);
}

// --- tests -------------------------------------------------------------------

describe('MqttBridge (aedes in-process broker)', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await buildHarness();
  });

  afterEach(async () => {
    await teardownHarness(h);
  });

  it('publishes yapaja/status=online retained on connect (LWT counterpart)', async () => {
    const status = latestOf(h.records, 'yapaja/status');
    expect(status?.raw).toBe('online');

    // Retention itself is only observable via a FRESH subscribe (see
    // `collectRetained`'s doc comment) -- a late-joining HA instance must see
    // "online" immediately, without waiting for the next live publish.
    const brokerUrl = `mqtt://127.0.0.1:${h.brokerCtx.port}`;
    const retained = await collectRetained(brokerUrl, 'yapaja/status');
    expect(retained).toHaveLength(1);
    expect(retained[0]!.raw).toBe('online');
    expect(retained[0]!.retain).toBe(true);
  });

  it('acceptance #1: all status topics appear with schema-valid payloads during a drive', async () => {
    h.routing.seed(buildDriveRoute(routePoints()));
    h.navigationService.start({ route_id: 'drive-route-1' });

    // Drive a handful of fixes along the route (real bus publishes, same
    // shape PositionService would emit).
    const points = routePoints();
    for (let i = 0; i < points.length; i++) {
      h.bus.publish('pos/update', {
        lat: points[i]!.lat,
        lon: points[i]!.lon,
        alt: 400 + i,
        speed: 15,
        heading: 0,
        accuracy: 5,
        source: 'simulator',
        fix: '3d',
        ts: new Date().toISOString(),
      });
      await sleep(15);
    }

    // Directly exercise the remaining bus topics the bridge maps (their
    // natural trigger conditions are narrow; publishing them here still runs
    // the REAL bridge -> real mqtt.js -> real aedes -> subscriber pipeline).
    h.bus.publish('nav/instruction', {
      maneuver: {
        index: 0,
        type: 'turn_left',
        instruction: 'Links abbiegen auf B27',
        street_names: ['B27'],
        distance_m: 200,
        begin_shape_index: 0,
      },
      distance_m: 150,
      say: 'In 150 Metern links abbiegen',
    });
    h.bus.publish('route/deviation', { at: { lat: 47.0, lon: 9.5 }, cross_track_m: 40, ts: new Date().toISOString() });
    h.bus.publish('event/arrived', { route_id: 'drive-route-1', destination: null, ts: new Date().toISOString() });
    h.bus.publish('event/gps_lost', { lastSource: 'simulator' });

    await waitUntil(() => Boolean(latestOf(h.records, 'yapaja/event/gps_lost')));
    await sleep(50);

    // Live-delivery payload-shape checks (content only; MQTT retain-flag
    // semantics on an already-subscribed live delivery are always 0 per
    // spec regardless of the publish's own retain flag -- see
    // `collectRetained`'s doc comment for the retained-ness checks below).
    const positionMsg = latestOf(h.records, 'yapaja/position');
    expect(positionMsg).toBeDefined();
    expect(typeof (positionMsg!.payload as { lat: number }).lat).toBe('number');

    const navStateMsg = latestOf(h.records, 'yapaja/nav/state')!;
    expect(['idle', 'routing', 'navigating', 'paused', 'arrived', 'off_route']).toContain(navStateMsg.raw);

    const etaMsg = latestOf(h.records, 'yapaja/nav/eta')!;
    expect(etaMsg.payload).toHaveProperty('eta');
    expect(etaMsg.payload).toHaveProperty('duration_remaining_s');
    expect(etaMsg.payload).toHaveProperty('distance_remaining_m');

    const speedMsg = latestOf(h.records, 'yapaja/nav/speed')!;
    expect(speedMsg.payload).toHaveProperty('speeding');

    const altitudeMsg = latestOf(h.records, 'yapaja/nav/altitude')!;
    expect(altitudeMsg.payload).toHaveProperty('altitude_m');

    expect(latestOf(h.records, 'yapaja/nav/destination')).toBeDefined();

    const summaryMsg = latestOf(h.records, 'yapaja/route/summary')!;
    expect(summaryMsg.payload).toEqual({
      distance_m: expect.any(Number),
      duration_s: expect.any(Number),
      via: ['Fahrweg'],
    });

    const instructionMsg = latestOf(h.records, 'yapaja/nav/instruction')!;
    expect(instructionMsg.payload).toEqual({
      type: 'turn_left',
      instruction: 'Links abbiegen auf B27',
      street_names: ['B27'],
      distance_m: 150,
      icon: 'mdi:arrow-left-top',
    });

    for (const eventTopic of ['yapaja/event/deviation', 'yapaja/event/arrived', 'yapaja/event/gps_lost']) {
      expect(latestOf(h.records, eventTopic), `${eventTopic} should have been published`).toBeDefined();
    }

    // Retained-ness (docs/03 §4: retain ✔ for state topics, ✘ for events) --
    // only reliably observable via a fresh subscribe (see `collectRetained`).
    const brokerUrl = `mqtt://127.0.0.1:${h.brokerCtx.port}`;
    const retained = await collectRetained(brokerUrl, 'yapaja/#');
    const retainedTopics = new Set(retained.map((r) => r.topic));
    for (const stateTopic of [
      'yapaja/status',
      'yapaja/position',
      'yapaja/nav/state',
      'yapaja/nav/eta',
      'yapaja/nav/speed',
      'yapaja/nav/altitude',
      'yapaja/nav/destination',
      'yapaja/route/summary',
      'yapaja/nav/instruction',
    ]) {
      expect(retainedTopics.has(stateTopic), `${stateTopic} should be retained`).toBe(true);
    }
    for (const eventTopic of ['yapaja/event/deviation', 'yapaja/event/arrived', 'yapaja/event/gps_lost']) {
      expect(retainedTopics.has(eventTopic), `${eventTopic} must NOT be retained`).toBe(false);
    }
  });

  it('acceptance #2: cmd/destination takes effect and cmd/result confirms it', async () => {
    h.records.length = 0;
    h.subscriber.publish(
      'yapaja/cmd/destination',
      JSON.stringify({ lat: 47.05, lon: 9.55, autostart: true, request_id: 'req-dest-1' }),
    );

    await waitUntil(() => Boolean(latestOf(h.records, 'yapaja/cmd/result')));
    const result = latestOf(h.records, 'yapaja/cmd/result')!;
    expect(result.payload).toEqual({ cmd: 'destination', ok: true, request_id: 'req-dest-1' });
    expect(h.navigationService.getStatus()).toBe('navigating');
  });

  it('acceptance #2: cmd/navigation pause/resume/stop take effect with results', async () => {
    h.routing.seed(buildDriveRoute(routePoints()));
    h.navigationService.start({ route_id: 'drive-route-1' });
    h.records.length = 0;

    h.subscriber.publish('yapaja/cmd/navigation', 'pause');
    await waitUntil(() => h.records.filter((r) => r.topic === 'yapaja/cmd/result').length >= 1);
    expect(h.navigationService.getStatus()).toBe('paused');
    expect(latestOf(h.records, 'yapaja/cmd/result')!.payload).toEqual({ cmd: 'navigation', ok: true });

    h.subscriber.publish('yapaja/cmd/navigation', 'resume');
    await waitUntil(() => h.records.filter((r) => r.topic === 'yapaja/cmd/result').length >= 2);
    expect(h.navigationService.getStatus()).toBe('navigating');

    h.subscriber.publish('yapaja/cmd/navigation', 'stop');
    await waitUntil(() => h.records.filter((r) => r.topic === 'yapaja/cmd/result').length >= 3);
    expect(h.navigationService.getStatus()).toBe('idle');
  });

  it('acceptance #2: cmd/profile activates a profile by name', async () => {
    h.records.length = 0;
    h.subscriber.publish('yapaja/cmd/profile', JSON.stringify({ name: 'Camper' }));
    await waitUntil(() => Boolean(latestOf(h.records, 'yapaja/cmd/result')));
    expect(latestOf(h.records, 'yapaja/cmd/result')!.payload).toEqual({ cmd: 'profile', ok: true });
    expect(h.profileService.activated).toEqual(['p1']);
  });

  it('acceptance #2: cmd/favorite starts a route to a known favorite', async () => {
    h.records.length = 0;
    h.subscriber.publish('yapaja/cmd/favorite', JSON.stringify({ name: 'Zuhause' }));
    await waitUntil(() => Boolean(latestOf(h.records, 'yapaja/cmd/result')));
    expect(latestOf(h.records, 'yapaja/cmd/result')!.payload).toEqual({ cmd: 'favorite', ok: true });
    expect(h.navigationService.getStatus()).toBe('navigating');
  });

  it('acceptance #2 (error case): cmd/favorite with an unknown name -> ok:false, never crashes', async () => {
    h.records.length = 0;
    h.subscriber.publish('yapaja/cmd/favorite', JSON.stringify({ name: 'Nirgendwo', request_id: 'req-fav-err' }));
    await waitUntil(() => Boolean(latestOf(h.records, 'yapaja/cmd/result')));
    const result = latestOf(h.records, 'yapaja/cmd/result')!;
    expect(result.payload).toMatchObject({ cmd: 'favorite', ok: false, request_id: 'req-fav-err' });
    expect((result.payload as { error: string }).error).toMatch(/Nirgendwo/);
    // The bridge itself must still be perfectly healthy after a failed command.
    expect(h.bridge.isConnected()).toBe(true);
  });

  it('acceptance #2 (error case): cmd/profile with an unknown id -> ok:false', async () => {
    h.records.length = 0;
    h.subscriber.publish('yapaja/cmd/profile', JSON.stringify({ id: 'does-not-exist' }));
    await waitUntil(() => Boolean(latestOf(h.records, 'yapaja/cmd/result')));
    expect(latestOf(h.records, 'yapaja/cmd/result')!.payload).toMatchObject({ cmd: 'profile', ok: false });
  });
});

describe('MqttBridge reconnect (acceptance #3, Wargame W-06)', () => {
  it('severing the connection fires the LWT (offline); reconnect republishes CURRENT state fresh', async () => {
    const h = await buildHarness();
    try {
      // Establish some retained state before severing the connection.
      h.routing.seed(buildDriveRoute(routePoints()));
      h.navigationService.start({ route_id: 'drive-route-1' });
      h.bus.publish('pos/update', {
        lat: 47.001,
        lon: 9.5,
        alt: 410,
        speed: 12,
        heading: 0,
        accuracy: 5,
        source: 'simulator',
        fix: '3d',
        ts: new Date().toISOString(),
      });
      await waitUntil(() => Boolean(latestOf(h.records, 'yapaja/nav/state')));
      const stateBefore = latestOf(h.records, 'yapaja/nav/state')!.raw;
      expect(stateBefore).toBe('navigating');

      // Sever exactly the bridge's TCP connection (connection #1; the
      // subscriber, connected first in buildHarness(), is #0) -- simulates
      // "the bridge's link to the broker died" (e.g. a broker restart),
      // WITHOUT tearing down the whole broker (the subscriber needs to stay
      // connected to observe the Will message the broker publishes).
      expect(h.brokerCtx.connections.length).toBeGreaterThanOrEqual(2);
      h.records.length = 0;
      h.brokerCtx.connections[1]!.destroy();

      // 1. LWT fires: the broker publishes the bridge's Will to yapaja/status.
      await waitUntil(() => {
        const msg = latestOf(h.records, 'yapaja/status');
        return Boolean(msg && msg.raw === 'offline');
      });
      expect(h.bridge.isConnected()).toBe(false);
      // Confirm it was stored as a retained message too (a late-joining HA
      // instance must see "offline" immediately), via a fresh subscribe.
      const brokerUrlForRetainCheck = `mqtt://127.0.0.1:${h.brokerCtx.port}`;
      const retainedWhileOffline = await collectRetained(brokerUrlForRetainCheck, 'yapaja/status');
      expect(retainedWhileOffline[0]?.raw).toBe('offline');
      expect(retainedWhileOffline[0]?.retain).toBe(true);

      // Change the underlying state WHILE disconnected -- the retained topic
      // must reflect THIS value after reconnect, not whatever was retained
      // before the outage (docs/03 §4 W-06: "kein Event-Replay", fresh state
      // only). Navigation is paused while offline.
      h.navigationService.pause();

      // 2. Reconnect (bridge's own backoff, minMs:100/maxMs:400 in this
      // harness): status -> online again, plus every retained topic
      // freshly republished.
      await waitUntil(() => h.bridge.isConnected(), 5000);
      await waitUntil(() => {
        const msg = latestOf(h.records, 'yapaja/status');
        return Boolean(msg && msg.raw === 'online');
      });
      await sleep(100); // let the full republish pass land

      const navStateAfter = latestOf(h.records, 'yapaja/nav/state')!;
      expect(navStateAfter.raw).toBe('paused'); // PLAUSIBILITY: retained == current, not the stale 'navigating'.

      expect(latestOf(h.records, 'yapaja/position')).toBeDefined();
      expect(latestOf(h.records, 'yapaja/nav/eta')).toBeDefined();

      // PLAUSIBILITY (docs/03 §4): the RETAINED yapaja/nav/state -- what a
      // late-joining HA instance would actually see -- must also be the
      // current 'paused', never the stale pre-outage 'navigating'.
      const brokerUrl = `mqtt://127.0.0.1:${h.brokerCtx.port}`;
      const retainedAfter = await collectRetained(brokerUrl, 'yapaja/nav/state');
      expect(retainedAfter[0]?.raw).toBe('paused');
      expect(retainedAfter[0]?.retain).toBe(true);
    } finally {
      await teardownHarness(h);
    }
  }, 15000);
});
