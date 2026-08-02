/* eslint-disable no-undef -- `NodeJS` (the @types/node namespace) plus
 * `setTimeout`/`clearTimeout`/`setInterval`/`clearInterval` are standard Node
 * globals; the shared eslint `globals` list predates this backend module.
 * Same justification as routing/valhallaClient.ts. */

/**
 * SERVICE-ADD-ON RUNTIME (E09-T3, docs/05 §1B, Wargame W-14): starts a
 * `runtime: node18|node20` add-on as a CHILD PROCESS, hands it a scoped token,
 * supervises it with the watchdog, and tears everything down the instant the
 * add-on is disabled or uninstalled.
 *
 * THE PROCESS CONTRACT (docs/05 §1B)
 * ----------------------------------
 *   cwd  = data/addons/{id}                (its own code directory)
 *   env  = YAPAJA_API_URL   -- the Core's REST/WS base URL
 *          YAPAJA_TOKEN     -- its scoped token (see `tokens.ts`)
 *          YAPAJA_DATA_DIR  -- data/addon-storage/{id}, its ONLY writable dir
 *          YAPAJA_ADDON_ID  -- its own id
 * The environment is built from SCRATCH, not inherited. That is deliberate and
 * load-bearing: `process.env` of the Core carries `API_AUTH_TOKEN`,
 * `SUPERVISOR_TOKEN` (HA), `DB_PATH`, MQTT credentials -- handing all of that
 * to untrusted add-on code would make every scope check pointless. Only PATH
 * (needed for a subprocess-free Node run) and a couple of locale vars are
 * passed through.
 *
 * HARDENING -- BEST EFFORT, STATED PLAINLY
 * ----------------------------------------
 * The child is spawned with Node's permission model:
 *
 *   node --permission
 *        --allow-fs-read=<addon dir>      (its own code)
 *        --allow-fs-read=<storage dir>
 *        --allow-fs-write=<storage dir>   (its ONLY writable location)
 *        <entry>
 *
 * (Node 22 ships `--permission` as the stable flag; `--experimental-permission`
 * is emitted instead for Node 18/20 -- see {@link permissionFlags}.) This is
 * what makes the plausibility check hold: the add-on process CANNOT read
 * `data/db.sqlite`, because that path is outside every granted read root and
 * Node throws `ERR_ACCESS_DENIED`. `--permission` additionally blocks
 * `child_process`, `worker_threads` and native addons, so the add-on cannot
 * trivially shell out of its own restrictions.
 *
 * What it is NOT: a sandbox. The permission model constrains the FILESYSTEM
 * (and process spawning), not the network, not CPU, not RAM -- those are the
 * watchdog's job, and even that is cooperative. A determined add-on running as
 * the same OS user as the Core is not contained by this. REAL isolation means
 * `runtime: external`: the add-on runs in its own container (own user, own
 * network namespace, cgroup CPU/RAM limits) and only ever talks to the Core
 * over the same scoped-token API. docs/05 §7 mandates exactly that for anything
 * heavy or untrusted, and this host issues a token for such add-ons without
 * ever starting a process.
 *
 * LIFECYCLE IS THE `enabled` FLAG, NOTHING ELSE
 * ---------------------------------------------
 * enable  -> issue token + spawn + register with the watchdog
 * disable -> SIGTERM (SIGKILL after a grace period) + REVOKE the token
 * uninstall -> same, plus the install pipeline removes code + storage
 * The token is additionally checked against the live `enabled` flag on every
 * request (`tokens.ts`), so even a spawn/kill race cannot leave a usable
 * credential behind.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import type { AddonManifest } from '@yapaja/shared';
import type { EventBus } from '../bus/index.js';
import { resolveAddonDir, resolveAddonsRootDir, resolveAddonStorageRootDir, resolveEntryPath } from './paths.js';
import { AddonRepository, type AddonRecord } from './repository.js';
import { AddonTokenService } from './tokens.js';
import {
  AddonWatchdog,
  DEFAULT_RSS_LIMIT_BYTES,
  ProcMetricsSource,
  type AddonMetricsSource,
  type AddonWatchdogEvent,
  type WatchdogActions,
} from './watchdog.js';

/** The slice of `ChildProcess` this module uses -- injectable for tests. */
export interface ChildProcessLike {
  readonly pid?: number;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  stdout?: { on(event: 'data', listener: (chunk: unknown) => void): unknown } | null;
  stderr?: { on(event: 'data', listener: (chunk: unknown) => void): unknown } | null;
}

export interface SpawnOptions {
  cwd: string;
  env: Record<string, string>;
  stdio: ['ignore', 'pipe', 'pipe'];
}

export type SpawnLike = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcessLike;

export interface ServiceHostLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

const noopLogger: ServiceHostLogger = { info: () => {}, warn: () => {}, error: () => {} };

/** Node runtimes this host can start itself. `external` never spawns. */
const SPAWNABLE_RUNTIMES = new Set(['node18', 'node20']);

/**
 * The permission-model flags. Node >= 20.0 exposes `--permission`; 18.x and
 * early 20.x only had `--experimental-permission`. Derived from the RUNNING
 * Node's version (the child is the same binary via `process.execPath`), not
 * from the manifest's declared runtime -- what matters is which flag the
 * interpreter actually understands.
 */
export function permissionFlags(nodeVersion: string, readRoots: readonly string[], writeRoots: readonly string[]): string[] {
  const major = parseInt(nodeVersion.replace(/^v/, '').split('.')[0] ?? '0', 10);
  const flag = major >= 22 ? '--permission' : '--experimental-permission';
  return [
    flag,
    ...readRoots.map((r) => `--allow-fs-read=${r}`),
    ...writeRoots.map((r) => `--allow-fs-write=${r}`),
  ];
}

export interface AddonServiceStatus {
  addon_id: string;
  runtime: string | null;
  /** `true` only for a live Core-spawned child process. */
  running: boolean;
  pid: number | null;
  started_at: string | null;
  /** `external` add-ons hold a token but never a process. */
  external: boolean;
  token_issued_at: string | null;
  restarts: number;
  crashes_in_window: number;
  throttled: boolean;
  throttle_cycles: number;
  /** Set when the watchdog auto-disabled the add-on (UI-visible notice). */
  auto_disabled_reason: string | null;
  /** Last watchdog warning, so the UI can surface "was throttled". */
  last_warning: { event: AddonWatchdogEvent; detail: Record<string, unknown>; at: string } | null;
  last_error: string | null;
}

interface RunningService {
  child: ChildProcessLike;
  pid: number | null;
  startedAt: string;
  /** Set while an intentional stop is in flight -> exit is not a crash. */
  stopping: boolean;
  /** Set while a watchdog-ordered restart is in flight -> not a crash. */
  restarting: boolean;
  killTimer: NodeJS.Timeout | null;
}

export interface AddonServiceHostOptions {
  repository?: AddonRepository;
  tokens?: AddonTokenService;
  bus?: EventBus;
  logger?: ServiceHostLogger;
  addonsRootDir?: string;
  addonsStorageRootDir?: string;
  /** Resolved lazily AT SPAWN TIME (the server may not be listening yet when
   *  the host is constructed). */
  apiUrlProvider?: () => string;
  spawn?: SpawnLike;
  /** `process.execPath` by default -- the child runs the same Node binary. */
  nodeExecPath?: string;
  nodeVersion?: string;
  metrics?: AddonMetricsSource;
  /** Watchdog sampling interval; `0` disables the internal timer entirely
   *  (tests drive `watchdog.tick()` by hand). */
  watchdogIntervalMs?: number;
  /** Grace period between SIGTERM and SIGKILL on stop. */
  killGraceMs?: number;
  /** Delay before respawning after a crash. */
  restartDelayMs?: number;
  /** Injectable scheduler so tests never wait on real timers. */
  schedule?: (fn: () => void, ms: number) => void;
  watchdog?: AddonWatchdog;
}

export class AddonServiceHost {
  private readonly repository: AddonRepository;
  private readonly tokens: AddonTokenService;
  private readonly bus?: EventBus;
  private readonly logger: ServiceHostLogger;
  private readonly addonsRootDir: string;
  private readonly addonsStorageRootDir: string;
  private readonly apiUrlProvider: () => string;
  private readonly spawnImpl: SpawnLike;
  private readonly nodeExecPath: string;
  private readonly nodeVersion: string;
  private readonly killGraceMs: number;
  private readonly restartDelayMs: number;
  private readonly schedule: (fn: () => void, ms: number) => void;
  private readonly watchdogIntervalMs: number;

  private readonly running = new Map<string, RunningService>();
  private readonly autoDisabledReasons = new Map<string, string>();
  private readonly lastWarnings = new Map<string, { event: AddonWatchdogEvent; detail: Record<string, unknown>; at: string }>();
  private readonly lastErrors = new Map<string, string>();
  private watchdogTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  readonly watchdog: AddonWatchdog;

  constructor(opts: AddonServiceHostOptions = {}) {
    this.repository = opts.repository ?? new AddonRepository();
    this.tokens = opts.tokens ?? new AddonTokenService({ repository: this.repository });
    this.bus = opts.bus;
    this.logger = opts.logger ?? noopLogger;
    this.addonsRootDir = opts.addonsRootDir ?? resolveAddonsRootDir();
    this.addonsStorageRootDir = opts.addonsStorageRootDir ?? resolveAddonStorageRootDir();
    this.apiUrlProvider =
      opts.apiUrlProvider ??
      ((): string => process.env.YAPAJA_API_URL ?? `http://127.0.0.1:${process.env.PORT ?? '8080'}`);
    this.spawnImpl = opts.spawn ?? (nodeSpawn as unknown as SpawnLike);
    this.nodeExecPath = opts.nodeExecPath ?? process.execPath;
    this.nodeVersion = opts.nodeVersion ?? process.version;
    this.killGraceMs = opts.killGraceMs ?? 3_000;
    this.restartDelayMs = opts.restartDelayMs ?? 1_000;
    this.schedule =
      opts.schedule ??
      ((fn, ms): void => {
        const t = setTimeout(fn, ms);
        if (typeof t.unref === 'function') t.unref();
      });
    this.watchdogIntervalMs = opts.watchdogIntervalMs ?? 5_000;

    this.watchdog =
      opts.watchdog ??
      new AddonWatchdog({
        metrics: opts.metrics ?? new ProcMetricsSource(),
        actions: this.buildWatchdogActions(),
      });

    if (this.watchdogIntervalMs > 0) {
      const timer = setInterval(() => this.watchdog.tick(), this.watchdogIntervalMs);
      // NEVER hold the process open (repo rule): an idle Core must still exit.
      if (typeof timer.unref === 'function') timer.unref();
      this.watchdogTimer = timer;
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle (called by `InstallService` through `AddonLifecycleListener`)
  // -------------------------------------------------------------------------

  /**
   * Starts (or, for `runtime: external`, merely provisions) an add-on that has
   * just become `enabled`. Idempotent: an already-running add-on is left alone.
   */
  onEnabled(record: AddonRecord): void {
    this.autoDisabledReasons.delete(record.id);
    this.start(record);
  }

  /** Kills the process and REVOKES the token -- both immediately. */
  onDisabled(addonId: string): void {
    this.stop(addonId, 'disabled');
  }

  onUninstalled(addonId: string): void {
    this.stop(addonId, 'uninstalled');
    this.autoDisabledReasons.delete(addonId);
    this.lastWarnings.delete(addonId);
    this.lastErrors.delete(addonId);
  }

  /** Boot path: start every add-on the DB says is enabled. */
  startAll(): void {
    for (const record of this.repository.listAll()) {
      if (record.enabled) this.start(record);
    }
  }

  /** Shutdown path (`fastify.onClose`) -- no child may outlive the Core. */
  stopAll(): void {
    this.disposed = true;
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    for (const addonId of [...this.running.keys()]) {
      this.stop(addonId, 'shutdown');
    }
  }

  /**
   * Issues (rotating) a fresh scoped token for `addonId` and returns the RAW
   * value -- the only place it is ever surfaced. Used by the `runtime:
   * external` "show token" API. Refuses when the add-on is not enabled: a
   * disabled add-on must never hold a live credential.
   */
  issueToken(addonId: string): string | null {
    const record = this.repository.getById(addonId);
    if (!record || !record.enabled) return null;
    return this.tokens.issue(addonId, record.manifest.permissions);
  }

  getStatus(addonId: string): AddonServiceStatus | null {
    const record = this.repository.getById(addonId);
    if (!record) return null;
    const service = record.manifest.service;
    const live = this.running.get(addonId);
    const wd = this.watchdog.getStatus(addonId);
    const tokenInfo = this.tokens.getInfo(addonId);
    return {
      addon_id: addonId,
      runtime: service?.runtime ?? null,
      running: live !== undefined,
      pid: live?.pid ?? null,
      started_at: live?.startedAt ?? null,
      external: service?.runtime === 'external',
      token_issued_at: tokenInfo?.createdAt ?? null,
      restarts: wd?.restarts ?? 0,
      crashes_in_window: wd?.crashesInWindow ?? 0,
      throttled: wd?.throttled ?? false,
      throttle_cycles: wd?.throttleCycles ?? 0,
      auto_disabled_reason: this.autoDisabledReasons.get(addonId) ?? null,
      last_warning: this.lastWarnings.get(addonId) ?? null,
      last_error: this.lastErrors.get(addonId) ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // Spawning
  // -------------------------------------------------------------------------

  private start(record: AddonRecord): void {
    if (this.disposed) return;
    const service = record.manifest.service;
    if (!service) return;

    if (!SPAWNABLE_RUNTIMES.has(service.runtime)) {
      // `runtime: external` -- NO process is started. The add-on connects from
      // its own container with a token the operator copies out of the UI.
      this.tokens.issue(record.id, record.manifest.permissions);
      this.logger.info('add-on service is runtime:external -- token issued, no process started', {
        addon_id: record.id,
      });
      return;
    }

    if (this.running.has(record.id)) return;

    const addonDir = resolveAddonDir(this.addonsRootDir, record.id);
    const storageDir = resolveAddonDir(this.addonsStorageRootDir, record.id);
    if (!addonDir || !storageDir) {
      this.fail(record.id, `Unsafe add-on id "${record.id}" -- refusing to spawn`);
      return;
    }
    const entryPath = resolveEntryPath(addonDir, service.entry);
    if (!entryPath || !existsSync(entryPath)) {
      this.fail(record.id, `service.entry "${service.entry}" does not exist in the installed package`);
      return;
    }
    mkdirSync(storageDir, { recursive: true });

    // Fresh token on every spawn: a restart invalidates the previous one, so a
    // token that leaked out of a crashed process is already dead.
    const token = this.tokens.issue(record.id, record.manifest.permissions);

    const args = [
      ...permissionFlags(this.nodeVersion, [addonDir, storageDir], [storageDir]),
      entryPath,
    ];
    const env: Record<string, string> = {
      // Deliberately minimal -- see the module doc.
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      NODE_ENV: process.env.NODE_ENV ?? 'production',
      YAPAJA_API_URL: this.apiUrlProvider(),
      YAPAJA_TOKEN: token,
      YAPAJA_DATA_DIR: storageDir,
      YAPAJA_ADDON_ID: record.id,
    };

    let child: ChildProcessLike;
    try {
      child = this.spawnImpl(this.nodeExecPath, args, {
        cwd: addonDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.fail(record.id, err instanceof Error ? err.message : String(err));
      return;
    }

    const live: RunningService = {
      child,
      pid: child.pid ?? null,
      startedAt: new Date().toISOString(),
      stopping: false,
      restarting: false,
      killTimer: null,
    };
    this.running.set(record.id, live);
    this.lastErrors.delete(record.id);

    child.stdout?.on('data', (chunk) => {
      this.logger.info(`[addon ${record.id}] ${String(chunk).trimEnd()}`, { addon_id: record.id });
    });
    child.stderr?.on('data', (chunk) => {
      this.logger.warn(`[addon ${record.id}] ${String(chunk).trimEnd()}`, { addon_id: record.id });
    });
    child.on('error', (err: Error) => {
      this.lastErrors.set(record.id, err.message);
      this.logger.error('add-on service process error', { addon_id: record.id, error: err.message });
    });
    child.on('exit', (code, signal) => this.onChildExit(record.id, live, code, signal));

    if (child.pid !== undefined && child.pid !== null) {
      this.watchdog.register(record.id, child.pid, rssLimitBytesFor(record.manifest));
    }
    this.logger.info('add-on service started', {
      addon_id: record.id,
      pid: child.pid ?? null,
      runtime: service.runtime,
      cwd: addonDir,
    });
    this.publish('event/addon_service_started', { addon_id: record.id, pid: child.pid ?? null });
  }

  private onChildExit(
    addonId: string,
    live: RunningService,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (live.killTimer) {
      clearTimeout(live.killTimer);
      live.killTimer = null;
    }
    // Only clear the map entry if THIS process is still the current one.
    if (this.running.get(addonId) === live) this.running.delete(addonId);

    if (live.stopping || this.disposed) {
      this.watchdog.markStopped(addonId);
      return;
    }

    if (live.restarting) {
      // Watchdog-ordered (RSS) restart -- not a crash.
      this.watchdog.markStopped(addonId);
      this.schedule(() => this.restartIfStillEnabled(addonId), this.restartDelayMs);
      return;
    }

    this.logger.warn('add-on service exited unexpectedly', { addon_id: addonId, code, signal });
    const outcome = this.watchdog.recordCrash(addonId, { code, signal });
    if (outcome === 'auto_disabled') return; // autoDisable action already ran
    this.schedule(() => this.restartIfStillEnabled(addonId), this.restartDelayMs);
  }

  private restartIfStillEnabled(addonId: string): void {
    if (this.disposed) return;
    const record = this.repository.getById(addonId);
    if (!record || !record.enabled) return;
    this.start(record);
  }

  /**
   * Stops an add-on: SIGTERM, SIGKILL after the grace period, token revoked
   * IMMEDIATELY (before the process is even gone -- a dying add-on must not be
   * able to squeeze in one last API call).
   */
  private stop(addonId: string, reason: string): void {
    this.tokens.revoke(addonId);
    const live = this.running.get(addonId);
    this.watchdog.unregister(addonId);
    if (!live) return;
    this.running.delete(addonId);
    live.stopping = true;
    try {
      live.child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
    const timer = setTimeout(() => {
      try {
        live.child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }, this.killGraceMs);
    if (typeof timer.unref === 'function') timer.unref();
    live.killTimer = timer;
    this.logger.info('add-on service stopped', { addon_id: addonId, reason });
    this.publish('event/addon_service_stopped', { addon_id: addonId, reason });
  }

  private fail(addonId: string, message: string): void {
    this.lastErrors.set(addonId, message);
    this.logger.error('add-on service failed to start', { addon_id: addonId, error: message });
  }

  private buildWatchdogActions(): WatchdogActions {
    return {
      throttle: (addonId) => this.signal(addonId, 'SIGSTOP'),
      resume: (addonId) => this.signal(addonId, 'SIGCONT'),
      restart: (addonId, reason) => {
        const live = this.running.get(addonId);
        this.logger.warn('add-on service restarted by the watchdog', { addon_id: addonId, reason });
        if (!live) {
          this.schedule(() => this.restartIfStillEnabled(addonId), this.restartDelayMs);
          return;
        }
        live.restarting = true;
        try {
          // A process that just blew its RSS ceiling is not asked politely.
          live.child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      },
      autoDisable: (addonId, reason) => {
        this.autoDisabledReasons.set(addonId, reason);
        // `enabled = 0` is the single source of truth: it stops the service,
        // kills the token, hides the UI, and survives a Core restart.
        this.repository.setEnabled(addonId, false);
        this.stop(addonId, `auto-disabled: ${reason}`);
        this.logger.error('add-on auto-disabled by the watchdog', { addon_id: addonId, reason });
        this.publish('event/addon_auto_disabled', { addon_id: addonId, reason });
      },
      warn: (addonId, event, detail) => {
        const entry = { event, detail, at: new Date().toISOString() };
        this.lastWarnings.set(addonId, entry);
        this.logger.warn(`add-on watchdog: ${event}`, { addon_id: addonId, ...detail });
        this.publish('event/addon_watchdog', { addon_id: addonId, event, ...detail });
      },
    };
  }

  private signal(addonId: string, sig: NodeJS.Signals): void {
    const live = this.running.get(addonId);
    if (!live) return;
    try {
      live.child.kill(sig);
    } catch (err) {
      this.logger.warn('failed to signal add-on service', {
        addon_id: addonId,
        signal: sig,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private publish(topic: string, payload: Record<string, unknown>): void {
    this.bus?.publish(topic, payload);
  }
}

/** Manifest RSS ceiling, clamped: an add-on may lower it, but not raise it
 *  past a sane maximum (W-14 -- the point is protecting the N100). */
export function rssLimitBytesFor(manifest: AddonManifest): number {
  const declared = manifest.service?.max_rss_mb;
  if (typeof declared !== 'number' || !Number.isFinite(declared) || declared <= 0) {
    return DEFAULT_RSS_LIMIT_BYTES;
  }
  const clamped = Math.min(Math.max(declared, 16), 1024);
  return clamped * 1024 * 1024;
}
