/**
 * END-TO-END service add-on (E09-T3, acceptance criterion 1): a real
 * `buildServer()` LISTENING on an ephemeral port, a real add-on package on
 * disk, and a real Node child process that
 *
 *   - is started by `POST /api/v1/addons/{id}/enable`,
 *   - authenticates with the scoped token the Core put in its environment,
 *   - subscribes to `pos/update` over `/ws/v1` (needs `pos.read`),
 *   - publishes `addon/{id}/*` events over REST (needs `events.publish`),
 *   - and is killed -- with its token revoked -- by `POST .../disable`.
 *
 * Everything the fixture does goes through the PUBLIC API with the scoped
 * token; there is no privileged channel (docs/05 §1B).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type { AddonManifest } from '@yapaja/shared';
import { buildServer } from '../index.js';
import { closeDb } from '../db/index.js';
import { AddonRepository } from './repository.js';
import { AddonTokenService } from './tokens.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'services');
const ADDON_ID = 'com.example.tracker';

const MANIFEST: AddonManifest = {
  id: ADDON_ID,
  name: 'Track Recorder',
  version: '1.0.0',
  core_api: '^0.0.0',
  author: 'Test',
  license: 'MIT',
  description: 'subscribes to positions, publishes its own events',
  permissions: ['pos.read', 'events.publish'],
  service: { runtime: 'node20', entry: 'service/main.js' },
};

let parentDir: string;
let server: FastifyInstance;
let repository: AddonRepository;
let tokens: AddonTokenService;

/** Waits until `predicate` holds, or fails the test after `timeoutMs`. */
async function waitFor(label: string, predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(50);
  }
  throw new Error(`timed out waiting for: ${label}`);
}

describe('service add-on lifecycle, end to end (E09-T3)', () => {
  beforeEach(async () => {
    parentDir = mkdtempSync(join(tmpdir(), 'addon-service-e2e-'));
    const addonsDir = join(parentDir, 'data', 'addons');
    process.env.ADDONS_DIR = addonsDir;
    process.env.ADDON_STORAGE_DIR = join(parentDir, 'data', 'addon-storage');
    process.env.DB_PATH = ':memory:';
    closeDb();

    // Lay the add-on out exactly as the install pipeline would.
    const dir = join(addonsDir, ADDON_ID);
    mkdirSync(join(dir, 'service'), { recursive: true });
    writeFileSync(join(dir, 'yapaja-addon.json'), JSON.stringify(MANIFEST));
    copyFileSync(join(FIXTURE_DIR, 'pos-subscriber.js'), join(dir, 'service', 'main.js'));

    server = await buildServer();
    // A REAL port: the child process talks to the Core over HTTP/WS.
    await server.listen({ port: 0, host: '127.0.0.1' });
    repository = new AddonRepository();
    tokens = new AddonTokenService({ repository });
    repository.insert({
      id: ADDON_ID,
      name: MANIFEST.name,
      version: MANIFEST.version,
      manifest: MANIFEST,
      enabled: false,
      installPath: dir,
    });
  });

  afterEach(async () => {
    // `onClose` stops every add-on child -- no leaked processes.
    await server.close();
    await delay(100);
    closeDb();
    delete process.env.ADDONS_DIR;
    delete process.env.ADDON_STORAGE_DIR;
    rmSync(parentDir, { recursive: true, force: true });
  });

  it('starts on enable, works through the public API, and stops on disable', async () => {
    const events: Array<{ topic: string; payload: unknown }> = [];
    // Observe what the add-on publishes onto the Core's bus. `injectWS`
    // needs the instance ready, which `listen()` already guaranteed.
    const socket = await server.injectWS('/ws/v1');
    socket.send(JSON.stringify({ type: 'subscribe', topics: [`addon/${ADDON_ID}/*`] }));
    await delay(50);
    socket.on('message', (data) => {
      events.push(JSON.parse(data.toString()) as { topic: string; payload: unknown });
    });

    // --- ENABLE -> the process starts ------------------------------------
    const enable = await server.inject({ method: 'POST', url: `/api/v1/addons/${ADDON_ID}/enable` });
    expect(enable.statusCode).toBe(200);

    const statusOf = async (): Promise<Record<string, unknown>> =>
      JSON.parse((await server.inject({ method: 'GET', url: `/api/v1/addons/${ADDON_ID}/service` })).body).data;

    const started = await statusOf();
    expect(started.running).toBe(true);
    expect(started.pid).toBeTruthy();
    expect(started.external).toBe(false);

    // The add-on published `addon/{id}/started` -- proof that it received a
    // working scoped token and used the public REST API with it.
    await waitFor('the add-on to publish addon/{id}/started', () =>
      events.some((e) => e.topic === `addon/${ADDON_ID}/started`),
    );

    // --- it really is subscribed to positions -----------------------------
    await server.inject({
      method: 'POST',
      url: '/api/v1/position/browser',
      payload: {
        lat: 52.5,
        lon: 13.4,
        alt: 30,
        speed: 5,
        heading: 10,
        accuracy: 3,
        fix: '3d',
        ts: new Date().toISOString(),
      },
    });
    await waitFor('the add-on to republish the position it saw', () =>
      events.some((e) => e.topic === `addon/${ADDON_ID}/pos-seen`),
    );

    // --- DISABLE -> the process stops, the token dies ----------------------
    const pid = started.pid as number;
    const disable = await server.inject({ method: 'POST', url: `/api/v1/addons/${ADDON_ID}/disable` });
    expect(disable.statusCode).toBe(200);

    expect(tokens.getInfo(ADDON_ID)).toBeNull(); // revoked synchronously
    const stopped = await statusOf();
    expect(stopped.running).toBe(false);
    await waitFor('the child process to be gone', () => !isAlive(pid));

    // And nothing new arrives from it any more.
    const countAfterDisable = events.length;
    await server.inject({
      method: 'POST',
      url: '/api/v1/position/browser',
      payload: {
        lat: 52.6,
        lon: 13.5,
        alt: 30,
        speed: 5,
        heading: 10,
        accuracy: 3,
        fix: '3d',
        ts: new Date().toISOString(),
      },
    });
    await delay(300);
    expect(events.length).toBe(countAfterDisable);

    socket.terminate();
  }, 40_000);
});

/** `kill(pid, 0)` -- liveness probe without sending a signal. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
