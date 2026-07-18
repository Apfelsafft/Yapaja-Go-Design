/* eslint-disable no-undef -- setTimeout is a standard Node global (typed via
 * @types/node); the shared eslint config's `globals` list predates this
 * backend module. Same justification as position/service.ts. */

/**
 * Acceptance criterion 4 (docs/03 §4, E08-T1): "App bleibt ohne Broker voll
 * funktional" -- the Core must run 100% normally with NO MQTT broker
 * configured. Covers both layers:
 *  - `resolveMqttConfig` returning `null` (already unit-tested in
 *    config.test.ts) means `buildServer()` never constructs an `MqttBridge`
 *    at all.
 *  - `MqttBridge` itself, when constructed against an unreachable/invalid
 *    broker (e.g. a misconfigured URL), must never throw synchronously or
 *    block startup -- every connection failure is async and swallowed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { closeDb } from '../db/index.js';
import { buildServer } from '../index.js';
import { EventBus } from '../bus/index.js';
import { NavigationService, type RouteProvider } from '../navigation/service.js';
import { MqttBridge } from './bridge.js';

describe('Core startup with NO MQTT broker configured', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    process.env.DB_PATH = ':memory:';
    closeDb();
    delete process.env.MQTT_BROKER_URL;
    delete process.env.MQTT_USERNAME;
    delete process.env.MQTT_PASSWORD;
    delete process.env.MQTT_PREFIX;
  });

  afterEach(() => {
    closeDb();
    process.env = { ...savedEnv };
  });

  it('buildServer() boots and serves /api/v1/health normally, reporting mqtt as disabled', async () => {
    const fastify = await buildServer();
    const response = await fastify.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string; services: Record<string, string> };
    expect(body.status).toBe('ok');
    expect(body.services.mqtt).toBe('disabled');

    await fastify.close();
  });

  it('every other route still works with no broker configured (e.g. navigation state)', async () => {
    const fastify = await buildServer();
    const response = await fastify.inject({ method: 'GET', url: '/api/v1/navigation/state' });
    expect(response.statusCode).toBe(200);
    await fastify.close();
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('MqttBridge constructed against an unreachable broker', () => {
  it('never throws synchronously from the constructor, and the async ECONNREFUSED is swallowed (never crashes)', async () => {
    const bus = new EventBus({ isProduction: false });
    const routeProvider: RouteProvider = { getCachedRoute: () => null };
    const navigationService = new NavigationService({ bus, routeProvider });

    let bridge: MqttBridge | undefined;
    expect(() => {
      bridge = new MqttBridge({
        bus,
        // Port 1 on loopback: nothing listens there -- guaranteed ECONNREFUSED,
        // resolved fully asynchronously by the underlying socket/mqtt.js.
        brokerUrl: 'mqtt://127.0.0.1:1',
        navigationService,
        profileService: {
          getById: () => null,
          getAll: () => [],
          activate: () => {
            throw new Error('unused');
          },
        },
        favoriteService: { getAll: () => [] },
        reconnect: { minMs: 50, maxMs: 200 },
        connectTimeoutMs: 200,
      });
    }).not.toThrow();

    expect(bridge?.isConnected()).toBe(false);
    expect(bridge?.getHealthStatus()).toBe('down');

    // Let the real async ECONNREFUSED (and at least one backoff retry) play
    // out; the process must stay alive and the bridge must still just report
    // "down", never throw/reject uncaught.
    await sleep(150);
    expect(bridge?.isConnected()).toBe(false);
    expect(bridge?.getHealthStatus()).toBe('down');

    bridge?.dispose();
    navigationService.dispose();
  });
});
