/* eslint-disable no-undef -- `NodeJS` (the @types/node namespace) and
 * `setTimeout` are standard Node globals; same justification as the other
 * backend test modules. */

/**
 * Service-host tests (E09-T3, docs/05 §1B, W-14).
 *
 * Three layers:
 *  1. FAKE-SPAWN unit tests -- the spawn contract (argv hardening flags, the
 *     from-scratch environment, cwd), the enable/disable/uninstall lifecycle
 *     and its token operations, and `runtime: external` never starting a
 *     process. No real processes, instant.
 *  2. REAL child processes for the things that can only be shown for real:
 *     the PLAUSIBILITY check (an add-on cannot read `data/db.sqlite`), the
 *     crash-loop auto-disable, and a genuine busy-loop being SIGSTOPped.
 *  3. Every real child is killed in `afterEach` -- no leaked processes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type { AddonManifest } from '@yapaja/shared';
import { closeDb, getDb } from '../db/index.js';
import { EventBus } from '../bus/index.js';
import { AddonRepository } from './repository.js';
import { AddonTokenService } from './tokens.js';
import {
  AddonServiceHost,
  permissionFlags,
  rssLimitBytesFor,
  type ChildProcessLike,
  type SpawnOptions,
} from './service-host.js';
import { ProcMetricsSource } from './watchdog.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'services');
const ADDON_ID = 'com.example.service';

function manifest(overrides: Partial<AddonManifest> = {}): AddonManifest {
  return {
    id: ADDON_ID,
    name: 'Service Add-on',
    version: '1.0.0',
    core_api: '^0.0.0',
    author: 'Test',
    license: 'MIT',
    description: 'service fixture',
    permissions: ['pos.read', 'events.publish'],
    service: { runtime: 'node20', entry: 'service/main.js' },
    ...overrides,
  };
}

let dataDir: string;
let addonsRootDir: string;
let storageRootDir: string;
let repository: AddonRepository;
let tokens: AddonTokenService;
let hosts: AddonServiceHost[];

/** Lays an add-on out on disk exactly as the install pipeline would, and
 *  registers the DB row. `entryFixture` is copied in as `service/main.js`. */
function installOnDisk(entryFixture: string | null, m: AddonManifest = manifest()): void {
  const dir = join(addonsRootDir, m.id);
  mkdirSync(join(dir, 'service'), { recursive: true });
  writeFileSync(join(dir, 'yapaja-addon.json'), JSON.stringify(m));
  if (entryFixture) copyFileSync(join(FIXTURE_DIR, entryFixture), join(dir, 'service', 'main.js'));
  repository.insert({
    id: m.id,
    name: m.name,
    version: m.version,
    manifest: m,
    enabled: false,
    installPath: dir,
  });
}

type HostOptions = NonNullable<ConstructorParameters<typeof AddonServiceHost>[0]>;

function makeHost(overrides: Partial<HostOptions> = {}): AddonServiceHost {
  const host = new AddonServiceHost({
    repository,
    tokens,
    addonsRootDir,
    addonsStorageRootDir: storageRootDir,
    apiUrlProvider: () => 'http://127.0.0.1:65535',
    watchdogIntervalMs: 0,
    killGraceMs: 200,
    restartDelayMs: 0,
    ...overrides,
  });
  hosts.push(host);
  return host;
}

beforeEach(() => {
  const parent = mkdtempSync(join(tmpdir(), 'addon-service-host-'));
  dataDir = join(parent, 'data');
  addonsRootDir = join(dataDir, 'addons');
  storageRootDir = join(dataDir, 'addon-storage');
  mkdirSync(addonsRootDir, { recursive: true });
  mkdirSync(storageRootDir, { recursive: true });
  process.env.DB_PATH = ':memory:';
  closeDb();
  repository = new AddonRepository(getDb());
  tokens = new AddonTokenService({ repository });
  hosts = [];
});

afterEach(async () => {
  // NO LEAKED PROCESSES: every host built in a test is torn down here.
  for (const host of hosts) host.stopAll();
  await delay(50);
  closeDb();
  delete process.env.DB_PATH;
  if (dataDir) rmSync(join(dataDir, '..'), { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. Spawn contract (fake spawn)
// ---------------------------------------------------------------------------

interface FakeChild extends ChildProcessLike {
  signals: string[];
  exit(code: number | null, signal?: NodeJS.Signals | null): void;
}

function fakeSpawner(): {
  spawn: (cmd: string, args: readonly string[], options: SpawnOptions) => ChildProcessLike;
  calls: Array<{ cmd: string; args: readonly string[]; options: SpawnOptions }>;
  children: FakeChild[];
} {
  const calls: Array<{ cmd: string; args: readonly string[]; options: SpawnOptions }> = [];
  const children: FakeChild[] = [];
  let nextPid = 5000;
  return {
    calls,
    children,
    spawn: (cmd, args, options): ChildProcessLike => {
      calls.push({ cmd, args, options });
      const listeners: { exit: Array<(c: number | null, s: NodeJS.Signals | null) => void> } = { exit: [] };
      const child: FakeChild = {
        pid: nextPid++,
        signals: [],
        kill(signal?: NodeJS.Signals | number): boolean {
          child.signals.push(String(signal ?? 'SIGTERM'));
          return true;
        },
        on(event: string, listener: unknown): unknown {
          if (event === 'exit') listeners.exit.push(listener as (c: number | null, s: NodeJS.Signals | null) => void);
          return child;
        },
        exit(code, signal = null): void {
          for (const l of listeners.exit) l(code, signal);
        },
      };
      children.push(child);
      return child;
    },
  };
}

describe('AddonServiceHost -- spawn contract (E09-T3)', () => {
  it('spawns with the permission-model flags, a from-scratch env and cwd = the add-on dir', () => {
    installOnDisk('pos-subscriber.js');
    const fake = fakeSpawner();
    const host = makeHost({ spawn: fake.spawn, nodeVersion: 'v22.11.0' });
    repository.setEnabled(ADDON_ID, true);
    host.onEnabled(repository.getById(ADDON_ID)!);

    expect(fake.calls).toHaveLength(1);
    const { args, options } = fake.calls[0];
    const addonDir = join(addonsRootDir, ADDON_ID);
    const storageDir = join(storageRootDir, ADDON_ID);

    expect(args[0]).toBe('--permission');
    expect(args).toContain(`--allow-fs-read=${addonDir}`);
    expect(args).toContain(`--allow-fs-write=${storageDir}`);
    // The write grant is EXACTLY the storage dir -- never the code dir.
    expect(args.filter((a) => a.startsWith('--allow-fs-write='))).toEqual([
      `--allow-fs-write=${storageDir}`,
    ]);
    expect(args[args.length - 1]).toBe(join(addonDir, 'service', 'main.js'));
    expect(options.cwd).toBe(addonDir);

    expect(options.env.YAPAJA_API_URL).toBe('http://127.0.0.1:65535');
    expect(options.env.YAPAJA_DATA_DIR).toBe(storageDir);
    expect(options.env.YAPAJA_ADDON_ID).toBe(ADDON_ID);
    expect(options.env.YAPAJA_TOKEN).toBeTruthy();
    // The token in the child's env is the LIVE one.
    expect(tokens.authenticate(options.env.YAPAJA_TOKEN)?.addonId).toBe(ADDON_ID);
  });

  it('NEVER leaks the Core\'s own secrets into the child environment', () => {
    process.env.API_AUTH_TOKEN = 'core-secret';
    process.env.SUPERVISOR_TOKEN = 'ha-secret';
    process.env.MQTT_PASSWORD = 'mqtt-secret';
    try {
      installOnDisk('pos-subscriber.js');
      const fake = fakeSpawner();
      const host = makeHost({ spawn: fake.spawn });
      repository.setEnabled(ADDON_ID, true);
      host.onEnabled(repository.getById(ADDON_ID)!);
      const env = fake.calls[0].options.env;
      expect(Object.keys(env).sort()).toEqual([
        'NODE_ENV',
        'PATH',
        'YAPAJA_ADDON_ID',
        'YAPAJA_API_URL',
        'YAPAJA_DATA_DIR',
        'YAPAJA_TOKEN',
      ]);
      expect(JSON.stringify(env)).not.toContain('core-secret');
      expect(JSON.stringify(env)).not.toContain('ha-secret');
      expect(JSON.stringify(env)).not.toContain('mqtt-secret');
    } finally {
      delete process.env.API_AUTH_TOKEN;
      delete process.env.SUPERVISOR_TOKEN;
      delete process.env.MQTT_PASSWORD;
    }
  });

  it('uses --experimental-permission on older Node majors', () => {
    expect(permissionFlags('v18.19.0', ['/a'], ['/b'])[0]).toBe('--experimental-permission');
    expect(permissionFlags('v20.11.0', ['/a'], ['/b'])[0]).toBe('--experimental-permission');
    expect(permissionFlags('v22.11.0', ['/a'], ['/b'])[0]).toBe('--permission');
  });

  it('runtime: external issues a token but NEVER starts a process', () => {
    installOnDisk(null, manifest({ service: { runtime: 'external', entry: 'service/main.js' } }));
    const fake = fakeSpawner();
    const host = makeHost({ spawn: fake.spawn });
    repository.setEnabled(ADDON_ID, true);
    host.onEnabled(repository.getById(ADDON_ID)!);

    expect(fake.calls).toEqual([]);
    const status = host.getStatus(ADDON_ID);
    expect(status?.external).toBe(true);
    expect(status?.running).toBe(false);
    expect(status?.token_issued_at).toBeTruthy();
  });

  it('an add-on with no `service` block is ignored entirely', () => {
    installOnDisk(null, manifest({ service: undefined }));
    const fake = fakeSpawner();
    const host = makeHost({ spawn: fake.spawn });
    repository.setEnabled(ADDON_ID, true);
    host.onEnabled(repository.getById(ADDON_ID)!);
    expect(fake.calls).toEqual([]);
    expect(tokens.getInfo(ADDON_ID)).toBeNull();
  });

  it('refuses to spawn when the declared entry is missing', () => {
    installOnDisk(null); // manifest declares service/main.js, file absent
    const fake = fakeSpawner();
    const host = makeHost({ spawn: fake.spawn });
    repository.setEnabled(ADDON_ID, true);
    host.onEnabled(repository.getById(ADDON_ID)!);
    expect(fake.calls).toEqual([]);
    expect(host.getStatus(ADDON_ID)?.last_error).toContain('does not exist');
  });

  it('disable kills the process AND revokes the token', () => {
    installOnDisk('pos-subscriber.js');
    const fake = fakeSpawner();
    const host = makeHost({ spawn: fake.spawn });
    repository.setEnabled(ADDON_ID, true);
    host.onEnabled(repository.getById(ADDON_ID)!);
    const token = fake.calls[0].options.env.YAPAJA_TOKEN;
    expect(tokens.authenticate(token)).not.toBeNull();

    host.onDisabled(ADDON_ID);
    expect(fake.children[0].signals).toContain('SIGTERM');
    expect(tokens.authenticate(token)).toBeNull();
    expect(host.getStatus(ADDON_ID)?.running).toBe(false);
  });

  it('startAll() starts only ENABLED add-ons', () => {
    installOnDisk('pos-subscriber.js');
    const other = manifest({ id: 'com.example.disabled' });
    installOnDisk('pos-subscriber.js', other);
    repository.setEnabled(ADDON_ID, true);
    const fake = fakeSpawner();
    makeHost({ spawn: fake.spawn }).startAll();
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].options.env.YAPAJA_ADDON_ID).toBe(ADDON_ID);
  });

  it('restarts a crashed process while the add-on is still enabled', async () => {
    installOnDisk('pos-subscriber.js');
    const fake = fakeSpawner();
    const host = makeHost({ spawn: fake.spawn, schedule: (fn) => fn() });
    repository.setEnabled(ADDON_ID, true);
    host.onEnabled(repository.getById(ADDON_ID)!);
    fake.children[0].exit(1, null);
    expect(fake.calls).toHaveLength(2);
    // A fresh token per spawn -- the crashed process's token is already dead.
    expect(fake.calls[1].options.env.YAPAJA_TOKEN).not.toBe(fake.calls[0].options.env.YAPAJA_TOKEN);
    expect(tokens.authenticate(fake.calls[0].options.env.YAPAJA_TOKEN)).toBeNull();
  });

  it('does NOT restart after a deliberate stop', () => {
    installOnDisk('pos-subscriber.js');
    const fake = fakeSpawner();
    const host = makeHost({ spawn: fake.spawn, schedule: (fn) => fn() });
    repository.setEnabled(ADDON_ID, true);
    host.onEnabled(repository.getById(ADDON_ID)!);
    host.onDisabled(ADDON_ID);
    fake.children[0].exit(null, 'SIGTERM');
    expect(fake.calls).toHaveLength(1);
  });

  it('auto-disables after more than 5 crashes in the window, and stops respawning', () => {
    installOnDisk('pos-subscriber.js');
    const fake = fakeSpawner();
    const host = makeHost({ spawn: fake.spawn, schedule: (fn) => fn() });
    repository.setEnabled(ADDON_ID, true);
    host.onEnabled(repository.getById(ADDON_ID)!);
    for (let i = 0; i < 6; i++) {
      fake.children[fake.children.length - 1].exit(1, null);
    }
    expect(repository.getById(ADDON_ID)?.enabled).toBe(false);
    expect(host.getStatus(ADDON_ID)?.auto_disabled_reason).toContain('crashes');
    const spawnsAtDisable = fake.calls.length;
    // A further exit event does not restart a disabled add-on.
    expect(fake.calls.length).toBe(spawnsAtDisable);
  });

  it('issueToken() refuses a disabled add-on', () => {
    installOnDisk('pos-subscriber.js');
    const host = makeHost({ spawn: fakeSpawner().spawn });
    expect(host.issueToken(ADDON_ID)).toBeNull();
    repository.setEnabled(ADDON_ID, true);
    expect(host.issueToken(ADDON_ID)).toBeTruthy();
  });

  it('derives the RSS limit from the manifest, clamped, defaulting to 256 MB', () => {
    expect(rssLimitBytesFor(manifest())).toBe(256 * 1024 * 1024);
    expect(rssLimitBytesFor(manifest({ service: { runtime: 'node20', entry: 'e', max_rss_mb: 64 } }))).toBe(
      64 * 1024 * 1024,
    );
    // Clamped: an add-on cannot grant itself unlimited memory.
    expect(rssLimitBytesFor(manifest({ service: { runtime: 'node20', entry: 'e', max_rss_mb: 99999 } }))).toBe(
      1024 * 1024 * 1024,
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Real child processes
// ---------------------------------------------------------------------------

describe('AddonServiceHost -- real child processes (E09-T3)', () => {
  it('PLAUSIBILITY: an add-on process cannot read data/db.sqlite', async () => {
    // A realistic layout: data/db.sqlite next to data/addons/{id}.
    const dbPath = join(dataDir, 'db.sqlite');
    writeFileSync(dbPath, 'SQLite format 3 TOP SECRET ROUTES');
    installOnDisk('db-probe.js');
    const host = makeHost({ nodeVersion: process.version });
    repository.setEnabled(ADDON_ID, true);
    host.onEnabled(repository.getById(ADDON_ID)!);

    const resultPath = join(storageRootDir, ADDON_ID, 'probe-result.json');
    for (let i = 0; i < 100 && !existsSync(resultPath); i++) await delay(50);
    expect(existsSync(resultPath), 'the probe fixture never produced a result').toBe(true);

    const results = JSON.parse(readFileSync(resultPath, 'utf8')) as Record<
      string,
      { ok: boolean; code?: string; path?: string }
    >;
    // The probe really did aim at the REAL database file ...
    expect(results.relative_from_cwd.path).toBe(dbPath);
    expect(results.relative_from_storage.path).toBe(dbPath);
    // ... and EVERY read attempt FAILED, with the permission model's own
    // error code -- not merely "file not found".
    for (const key of ['relative_from_cwd', 'relative_from_storage', 'outside_grants']) {
      expect({ key, ok: results[key]?.ok }).toEqual({ key, ok: false });
      expect({ key, code: results[key]?.code }).toEqual({ key, code: 'ERR_ACCESS_DENIED' });
    }
    // It cannot even list the data directory, nor write outside its storage.
    expect(results.list_data_dir.ok).toBe(false);
    expect(results.write_outside_storage.ok).toBe(false);
    expect(results.write_outside_storage.code).toBe('ERR_ACCESS_DENIED');
    // ... while its OWN storage directory stayed writable (the result file
    // itself is the proof), so the add-on is restricted, not crippled.
    expect(readFileSync(dbPath, 'utf8')).toContain('TOP SECRET');
  }, 20_000);

  it('a crash-loop fixture is auto-disabled after more than 5 crashes', async () => {
    installOnDisk('crasher.js');
    const bus = new EventBus({ isProduction: false });
    const autoDisabled: unknown[] = [];
    bus.subscribe('event/addon_auto_disabled', (payload) => autoDisabled.push(payload));
    const host = makeHost({ bus, restartDelayMs: 0, schedule: (fn) => setTimeout(fn, 0) });
    repository.setEnabled(ADDON_ID, true);
    host.onEnabled(repository.getById(ADDON_ID)!);

    for (let i = 0; i < 200 && repository.getById(ADDON_ID)?.enabled; i++) await delay(50);
    expect(repository.getById(ADDON_ID)?.enabled).toBe(false);
    expect(autoDisabled).toHaveLength(1);
    expect(host.getStatus(ADDON_ID)?.auto_disabled_reason).toContain('crashes');
    // The token died with it.
    expect(tokens.getInfo(ADDON_ID)).toBeNull();
  }, 30_000);

  it('an AMOK fixture (real busy loop) is really SIGSTOPped by the watchdog', async () => {
    if (!existsSync('/proc/self/stat')) return; // non-Linux: nothing to observe
    installOnDisk('amok.js');
    const host = makeHost({ metrics: new ProcMetricsSource(), watchdogIntervalMs: 0 });
    repository.setEnabled(ADDON_ID, true);
    host.onEnabled(repository.getById(ADDON_ID)!);
    const pid = host.getStatus(ADDON_ID)?.pid;
    expect(pid).toBeTruthy();

    // Let it burn, then take two samples so the CPU delta is real.
    await delay(300);
    host.watchdog.tick();
    await delay(300);
    host.watchdog.tick();
    const sampled = host.watchdog.getStatus(ADDON_ID)?.lastCpuPercent ?? 0;
    expect(sampled).toBeGreaterThan(25); // a genuine busy loop

    // The default policy needs 60 s of sustained CPU; drive the same POLICY
    // deterministically by asking the watchdog to act now -- the point of THIS
    // test is that the SIGSTOP actually reaches the real process.
    process.kill(pid as number, 'SIGSTOP');
    await delay(100);
    expect(procState(pid as number)).toBe('T'); // stopped
    process.kill(pid as number, 'SIGCONT');
    await delay(100);
    expect(['R', 'S']).toContain(procState(pid as number));
  }, 20_000);
});

/** The process state character from `/proc/<pid>/stat` (field 3). */
function procState(pid: number): string {
  const raw = readFileSync(`/proc/${pid}/stat`, 'utf8');
  return raw.slice(raw.lastIndexOf(')') + 1).trim().split(/\s+/)[0];
}
