/* eslint-disable no-undef -- setTimeout is a standard Node global (typed via
 * @types/node); the shared eslint config's `globals` list predates this
 * backend module. Same justification as bridge.integration.test.ts. */

/**
 * HA discovery integration tests (E08-T2) against the SAME real, in-process
 * `aedes` broker harness `bridge.integration.test.ts` uses for E08-T1 --
 * real `mqtt.js` bridge, real `mqtt.js` "HA" subscriber, zero MQTT-protocol
 * mocking. Covers docs/tasks/E08-T2's mandatory integration acceptance:
 *
 *  1. On `<discoveryPrefix>/status` = `online`, every discovery config is
 *     (re)published retained (W-07, HA restart).
 *  2. `mqtt.discovery: false` (`discovery.enabled: false`) -> NOT a single
 *     discovery config is published, ever.
 *  3. `select.yapaja_profile`'s `options` reflect the live profile list and
 *     update when a profile is added (`event/profile_list_changed`).
 *  4. Publishing to a button's own DECLARED `command_topic`/`payload_press`
 *     actually drives the Core -- proves the discovery config's wiring
 *     matches E08-T1's real `commands.ts` handling, not just a plausible
 *     guess at the topic shape.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server, type Socket } from 'node:net';
import { Aedes } from 'aedes';
import { connect as mqttConnect, type MqttClient } from 'mqtt';
import type { Favorite, Route, RouteRequest, VehicleProfile } from '@yapaja/shared';
import { EventBus } from '../bus/index.js';
import { NavigationService, type RouteProvider, type RerouteProvider } from '../navigation/service.js';
import { encodePolyline6 } from '../routing/polyline.js';
import { haversineM, type LatLon } from '../navigation/geo.js';
import { MqttBridge, type MqttProfileLookup, type MqttFavoriteLookup } from './bridge.js';
import type { DiscoveryDevice } from './discovery.js';

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
      // Bare-string topics stay as raw text.
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

function allOf(records: Recorded[], topic: string): Recorded[] {
  return records.filter((r) => r.topic === topic);
}

/** See `bridge.integration.test.ts`'s doc comment: retention is only reliably
 *  observable via a FRESH subscribe, never a live delivery's `packet.retain`. */
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

// --- fixtures ----------------------------------------------------------------

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
    ...overrides,
  };
}

/** Mutable in-memory profile list -- `addProfile()` simulates a `POST
 *  /profiles` creation for the "options update on profile add" test. */
class StubProfileService implements MqttProfileLookup {
  private profiles: VehicleProfile[];

  constructor(profiles: VehicleProfile[]) {
    this.profiles = profiles;
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
    return found;
  }
  addProfile(profile: VehicleProfile): void {
    this.profiles = [...this.profiles, profile];
  }
}

class StubFavoriteService implements MqttFavoriteLookup {
  getAll(): Favorite[] {
    return [];
  }
}

/** A short, decodable route for driving `NavigationService.start()` (same shape as bridge.integration.test.ts). */
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

const DEVICE: DiscoveryDevice = {
  identifiers: ['yapaja_go'],
  name: 'Yapaja Go',
  sw_version: '9.9.9-test',
  configuration_url: 'http://homeassistant.local:8080',
};

const ALL_DISCOVERY_TOPICS = [
  'homeassistant/sensor/yapaja_speed/config',
  'homeassistant/sensor/yapaja_speed_limit/config',
  'homeassistant/binary_sensor/yapaja_speeding/config',
  'homeassistant/sensor/yapaja_eta/config',
  'homeassistant/sensor/yapaja_distance_remaining/config',
  'homeassistant/sensor/yapaja_instruction/config',
  'homeassistant/sensor/yapaja_instruction_distance/config',
  'homeassistant/sensor/yapaja_altitude/config',
  'homeassistant/sensor/yapaja_nav_state/config',
  'homeassistant/device_tracker/yapaja_vehicle/config',
  'homeassistant/sensor/yapaja_destination/config',
  'homeassistant/button/yapaja_stop/config',
  'homeassistant/button/yapaja_pause/config',
  'homeassistant/button/yapaja_resume/config',
  'homeassistant/select/yapaja_profile/config',
];

interface Harness {
  brokerCtx: BrokerCtx;
  subscriber: MqttClient;
  records: Recorded[];
  bus: EventBus;
  navigationService: NavigationService;
  routing: StubRoutingService;
  profileService: StubProfileService;
  bridge: MqttBridge;
}

async function buildHarness(discoveryEnabled: boolean): Promise<Harness> {
  const brokerCtx = await startBroker();
  const brokerUrl = `mqtt://127.0.0.1:${brokerCtx.port}`;

  const subscriber = mqttConnect(brokerUrl, { reconnectPeriod: 200 });
  subscriber.on('error', () => {});
  await new Promise<void>((resolve) => subscriber.once('connect', () => resolve()));
  await new Promise<void>((resolve, reject) =>
    subscriber.subscribe(['yapaja/#', 'homeassistant/#'], { qos: 1 }, (err) => (err ? reject(err) : resolve())),
  );
  const records = recordMessages(subscriber);

  const bus = new EventBus({ isProduction: false });
  const routing = new StubRoutingService();
  const navigationService = new NavigationService({ bus, routeProvider: routing, rerouteProvider: routing });
  const profileService = new StubProfileService([makeProfile()]);

  const bridge = new MqttBridge({
    bus,
    brokerUrl,
    prefix: 'yapaja',
    navigationService,
    profileService,
    favoriteService: new StubFavoriteService(),
    routeProvider: routing,
    rerouteProvider: routing,
    profileProvider: undefined,
    discovery: { enabled: discoveryEnabled, discoveryPrefix: 'homeassistant', device: DEVICE },
    reconnect: { minMs: 100, maxMs: 400 },
    connectTimeoutMs: 2000,
  });

  await waitUntil(() => bridge.isConnected());
  await waitUntil(() => Boolean(latestOf(records, 'yapaja/status')));

  return { brokerCtx, subscriber, records, bus, navigationService, routing, profileService, bridge };
}

async function teardownHarness(h: Harness): Promise<void> {
  h.bridge.dispose();
  h.navigationService.dispose();
  h.subscriber.end(true);
  await stopBroker(h.brokerCtx);
}

// --- tests -------------------------------------------------------------------

describe('MqttBridge HA discovery (E08-T2, aedes in-process broker)', () => {
  let h: Harness;

  afterEach(async () => {
    if (h) await teardownHarness(h);
  });

  it('publishes all 15 discovery configs, retained, on connect', async () => {
    h = await buildHarness(true);
    await waitUntil(() => allOf(h.records, ALL_DISCOVERY_TOPICS[0]!).length >= 1);
    await sleep(100);

    for (const discoveryTopic of ALL_DISCOVERY_TOPICS) {
      expect(latestOf(h.records, discoveryTopic), `${discoveryTopic} should have been published`).toBeDefined();
    }

    const brokerUrl = `mqtt://127.0.0.1:${h.brokerCtx.port}`;
    const retained = await collectRetained(brokerUrl, 'homeassistant/#');
    const retainedTopics = new Set(retained.map((r) => r.topic));
    for (const discoveryTopic of ALL_DISCOVERY_TOPICS) {
      expect(retainedTopics.has(discoveryTopic), `${discoveryTopic} should be retained`).toBe(true);
    }
  });

  it('mqtt.discovery:false -> NOT a single discovery config is published', async () => {
    h = await buildHarness(false);
    // Drive some normal state traffic too -- discovery being off must not
    // affect E08-T1's state topics at all (real NavigationService.start(),
    // same as bridge.integration.test.ts, so `nav/state` is genuinely valid).
    h.routing.seed(buildDriveRoute(routePoints()));
    h.navigationService.start({ route_id: 'drive-route-1' });
    await waitUntil(() => Boolean(latestOf(h.records, 'yapaja/nav/state')));
    await sleep(200);

    const homeassistantRecords = h.records.filter((r) => r.topic.startsWith('homeassistant/'));
    expect(homeassistantRecords).toEqual([]);

    const brokerUrl = `mqtt://127.0.0.1:${h.brokerCtx.port}`;
    const retained = await collectRetained(brokerUrl, 'homeassistant/#');
    expect(retained).toEqual([]);
  });

  it('republishes every discovery config when homeassistant/status = online (W-07, HA restart)', async () => {
    h = await buildHarness(true);
    await waitUntil(() => Boolean(latestOf(h.records, 'homeassistant/select/yapaja_profile/config')));
    h.records.length = 0;

    h.subscriber.publish('homeassistant/status', 'online', { qos: 1 });

    await waitUntil(() => allOf(h.records, 'homeassistant/select/yapaja_profile/config').length >= 1);
    await sleep(100);
    for (const discoveryTopic of ALL_DISCOVERY_TOPICS) {
      expect(latestOf(h.records, discoveryTopic), `${discoveryTopic} should have been republished`).toBeDefined();
    }
  });

  it("select.yapaja_profile's options reflect the live profile list and update when a profile is added", async () => {
    h = await buildHarness(true);
    await waitUntil(() => Boolean(latestOf(h.records, 'homeassistant/select/yapaja_profile/config')));

    const initial = latestOf(h.records, 'homeassistant/select/yapaja_profile/config')!;
    expect((initial.payload as { options: string[] }).options).toEqual(['Camper']);

    h.records.length = 0;
    h.profileService.addProfile(
      makeProfile({ id: 'p2', name: 'Alkoven 7.5t', is_active: false }),
    );
    h.bus.publish('event/profile_list_changed', {});

    await waitUntil(() => Boolean(latestOf(h.records, 'homeassistant/select/yapaja_profile/config')));
    const updated = latestOf(h.records, 'homeassistant/select/yapaja_profile/config')!;
    expect((updated.payload as { options: string[] }).options).toEqual(['Camper', 'Alkoven 7.5t']);

    // Only the select entity was republished -- no other discovery topic.
    const otherDiscoveryTopics = h.records.filter(
      (r) => r.topic.startsWith('homeassistant/') && r.topic !== 'homeassistant/select/yapaja_profile/config',
    );
    expect(otherDiscoveryTopics).toEqual([]);
  });

  it("a publish to button.yapaja_stop's OWN declared command_topic/payload_press actually stops navigation", async () => {
    h = await buildHarness(true);
    await waitUntil(() => Boolean(latestOf(h.records, 'homeassistant/button/yapaja_stop/config')));

    const buttonConfig = latestOf(h.records, 'homeassistant/button/yapaja_stop/config')!.payload as {
      command_topic: string;
      payload_press: string;
    };

    h.routing.seed(buildDriveRoute(routePoints()));
    h.navigationService.start({ route_id: 'drive-route-1' });
    expect(h.navigationService.getStatus()).toBe('navigating');

    h.records.length = 0;
    // Drive the command purely from the discovery config's OWN declared
    // topic/payload -- not a hardcoded `yapaja/cmd/navigation`/`'stop'`
    // literal -- proving the discovery wiring matches commands.ts for real.
    h.subscriber.publish(buttonConfig.command_topic, buttonConfig.payload_press);

    await waitUntil(() => Boolean(latestOf(h.records, 'yapaja/cmd/result')));
    expect(latestOf(h.records, 'yapaja/cmd/result')!.payload).toEqual({ cmd: 'navigation', ok: true });
    expect(h.navigationService.getStatus()).toBe('idle');
  });
});
