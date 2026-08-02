/**
 * Add-on service WATCHDOG (E09-T3, Wargame W-14: "Add-on > 25 % CPU über 60 s
 * => Drosselung + Warnung, > 5 Crashes => Auto-Disable"; plus an RSS ceiling).
 *
 * This module is PURE POLICY. It owns no timers, no `/proc` parsing, no signal
 * sending and no database -- all of that arrives through injected seams:
 *
 *   - {@link AddonMetricsSource} supplies `{cpuPercent, rssBytes}` per pid, so
 *     a test drives an "amok" add-on with a literal `{cpuPercent: 90}` instead
 *     of a real busy loop (a real busy-loop fixture is used in the integration
 *     test as evidence, but the POLICY tests are deterministic).
 *   - `now()` is an injected clock, so "60 s sustained" and "10 min crash
 *     window" are exercised by advancing a number -- no sleeps, no races.
 *   - {@link WatchdogActions} receives every effect (SIGSTOP/SIGCONT, restart,
 *     auto-disable, warning) so the policy can be asserted on directly.
 *
 * `tick()` is called by the service host's (unref'd) interval in production
 * and by the test by hand.
 *
 * THROTTLING is a real DUTY CYCLE, not a one-shot pause: once an add-on has
 * been over the CPU threshold for the sustained window, the watchdog alternates
 * SIGSTOP / SIGCONT (default 500 ms stopped / 1500 ms running => ~25 % of a
 * core) and re-samples at the end of every running phase. It leaves throttling
 * only once a sample comes back at or below the threshold. SIGSTOP is used
 * rather than a kill because a well-behaved-but-busy add-on (a big GPX export)
 * should be slowed down, not destroyed -- W-14 asks for "Drosselung", and the
 * kill path is reserved for the RSS ceiling and the crash loop.
 */

import { readFileSync } from 'node:fs';

/** One sample of a running add-on process. */
export interface AddonProcessMetrics {
  /** Percent of ONE core since the previous sample (0-100+, may exceed 100
   *  for a multi-threaded process). */
  cpuPercent: number;
  rssBytes: number;
}

export interface AddonMetricsSource {
  /** `null` when the process is gone / metrics are unavailable on this OS. */
  sample(pid: number): AddonProcessMetrics | null;
}

/** Every effect the watchdog can cause. The service host implements it. */
export interface WatchdogActions {
  /** SIGSTOP -- freeze the process. */
  throttle(addonId: string): void;
  /** SIGCONT -- let it run again. */
  resume(addonId: string): void;
  /** Kill + respawn (RSS ceiling). */
  restart(addonId: string, reason: string): void;
  /** Stop for good and clear the `enabled` flag (crash loop). */
  autoDisable(addonId: string, reason: string): void;
  /** Operator-visible warning: log + bus event + the UI status flag. */
  warn(addonId: string, event: AddonWatchdogEvent, detail: Record<string, unknown>): void;
}

export type AddonWatchdogEvent =
  | 'cpu_throttled'
  | 'cpu_throttle_released'
  | 'rss_exceeded'
  | 'crash'
  | 'auto_disabled';

export interface AddonWatchdogOptions {
  metrics: AddonMetricsSource;
  actions: WatchdogActions;
  /** Injected clock (ms). Defaults to `Date.now`. */
  now?: () => number;
  /** W-14: > 25 % CPU ... */
  cpuPercentThreshold?: number;
  /** ... sustained over 60 s => throttle. */
  cpuSustainedMs?: number;
  /** Duty cycle while throttling. */
  throttleStopMs?: number;
  throttleRunMs?: number;
  /** W-14: > 5 crashes within 10 min => auto-disable. */
  crashWindowMs?: number;
  maxCrashesPerWindow?: number;
  /** Manifest default when an add-on declares no RSS limit. */
  defaultRssLimitBytes?: number;
}

export const DEFAULT_CPU_PERCENT_THRESHOLD = 25;
export const DEFAULT_CPU_SUSTAINED_MS = 60_000;
export const DEFAULT_THROTTLE_STOP_MS = 500;
export const DEFAULT_THROTTLE_RUN_MS = 1_500;
export const DEFAULT_CRASH_WINDOW_MS = 10 * 60_000;
export const DEFAULT_MAX_CRASHES_PER_WINDOW = 5;
/** docs/05 §7 / W-14: 256 MB unless the manifest asks for less/more. */
export const DEFAULT_RSS_LIMIT_BYTES = 256 * 1024 * 1024;

export interface AddonWatchdogStatus {
  pid: number | null;
  rssLimitBytes: number;
  /** Currently inside a throttle duty cycle. */
  throttled: boolean;
  /** How many SIGSTOP phases have been applied since throttling started. */
  throttleCycles: number;
  /** Crashes still inside the rolling window. */
  crashesInWindow: number;
  restarts: number;
  lastCpuPercent: number | null;
  lastRssBytes: number | null;
}

interface WatchdogState {
  pid: number | null;
  rssLimitBytes: number;
  /** When the CPU first went over the threshold in the current streak. */
  cpuOverSince: number | null;
  throttling: boolean;
  /** While throttling: when the current SIGSTOP phase ends. */
  stoppedUntil: number | null;
  /** While throttling: when the current running phase ends (=> re-sample). */
  runningUntil: number;
  throttleCycles: number;
  crashTimes: number[];
  restarts: number;
  lastCpuPercent: number | null;
  lastRssBytes: number | null;
}

export type CrashOutcome = 'restart' | 'auto_disabled';

export class AddonWatchdog {
  private readonly states = new Map<string, WatchdogState>();
  private readonly metrics: AddonMetricsSource;
  private readonly actions: WatchdogActions;
  private readonly now: () => number;
  private readonly cpuPercentThreshold: number;
  private readonly cpuSustainedMs: number;
  private readonly throttleStopMs: number;
  private readonly throttleRunMs: number;
  private readonly crashWindowMs: number;
  private readonly maxCrashesPerWindow: number;
  private readonly defaultRssLimitBytes: number;

  constructor(opts: AddonWatchdogOptions) {
    this.metrics = opts.metrics;
    this.actions = opts.actions;
    this.now = opts.now ?? ((): number => Date.now());
    this.cpuPercentThreshold = opts.cpuPercentThreshold ?? DEFAULT_CPU_PERCENT_THRESHOLD;
    this.cpuSustainedMs = opts.cpuSustainedMs ?? DEFAULT_CPU_SUSTAINED_MS;
    this.throttleStopMs = opts.throttleStopMs ?? DEFAULT_THROTTLE_STOP_MS;
    this.throttleRunMs = opts.throttleRunMs ?? DEFAULT_THROTTLE_RUN_MS;
    this.crashWindowMs = opts.crashWindowMs ?? DEFAULT_CRASH_WINDOW_MS;
    this.maxCrashesPerWindow = opts.maxCrashesPerWindow ?? DEFAULT_MAX_CRASHES_PER_WINDOW;
    this.defaultRssLimitBytes = opts.defaultRssLimitBytes ?? DEFAULT_RSS_LIMIT_BYTES;
  }

  /** Starts (or re-arms) supervision of `addonId`'s process. The CRASH
   *  history deliberately SURVIVES a re-register -- otherwise a crash loop
   *  (crash -> respawn -> register) would reset its own counter and never
   *  reach the auto-disable threshold. */
  register(addonId: string, pid: number, rssLimitBytes?: number): void {
    const existing = this.states.get(addonId);
    this.states.set(addonId, {
      pid,
      rssLimitBytes: rssLimitBytes ?? existing?.rssLimitBytes ?? this.defaultRssLimitBytes,
      cpuOverSince: null,
      throttling: false,
      stoppedUntil: null,
      runningUntil: this.now(),
      throttleCycles: 0,
      crashTimes: existing?.crashTimes ?? [],
      restarts: existing?.restarts ?? 0,
      lastCpuPercent: null,
      lastRssBytes: null,
    });
  }

  /** Forgets everything about an add-on (disable/uninstall). */
  unregister(addonId: string): void {
    this.states.delete(addonId);
  }

  /** Marks the process as gone without dropping the crash history. */
  markStopped(addonId: string): void {
    const state = this.states.get(addonId);
    if (!state) return;
    state.pid = null;
    state.throttling = false;
    state.stoppedUntil = null;
    state.cpuOverSince = null;
  }

  /** Counted restarts (RSS kills) -- not crashes. */
  noteRestart(addonId: string): void {
    const state = this.states.get(addonId);
    if (state) state.restarts += 1;
  }

  /**
   * Records an UNEXPECTED exit. Returns `'auto_disabled'` when this crash
   * pushed the add-on past `maxCrashesPerWindow` inside `crashWindowMs`
   * (W-14: "> 5 Crashes" -- so the 6th within the window disables it), else
   * `'restart'`.
   */
  recordCrash(addonId: string, detail: Record<string, unknown> = {}): CrashOutcome {
    const now = this.now();
    const state = this.states.get(addonId) ?? this.ensure(addonId);
    state.pid = null;
    state.throttling = false;
    state.stoppedUntil = null;
    state.cpuOverSince = null;
    state.crashTimes = state.crashTimes.filter((t) => now - t < this.crashWindowMs);
    state.crashTimes.push(now);
    this.actions.warn(addonId, 'crash', { ...detail, crashes_in_window: state.crashTimes.length });

    if (state.crashTimes.length > this.maxCrashesPerWindow) {
      const reason = `${state.crashTimes.length} crashes within ${Math.round(this.crashWindowMs / 60_000)} min`;
      this.actions.warn(addonId, 'auto_disabled', { reason, crashes_in_window: state.crashTimes.length });
      this.actions.autoDisable(addonId, reason);
      return 'auto_disabled';
    }
    return 'restart';
  }

  /** One supervision pass over every registered, running add-on. */
  tick(): void {
    const now = this.now();
    for (const [addonId, state] of this.states) {
      if (state.pid === null) continue;

      if (state.throttling) {
        this.tickThrottling(addonId, state, now);
        continue;
      }

      const sample = this.metrics.sample(state.pid);
      if (!sample) continue;
      state.lastCpuPercent = sample.cpuPercent;
      state.lastRssBytes = sample.rssBytes;

      // RSS ceiling: kill + restart. Checked before CPU -- an add-on eating
      // RAM is the more urgent threat on an N100 with 8 GB.
      if (sample.rssBytes > state.rssLimitBytes) {
        this.actions.warn(addonId, 'rss_exceeded', {
          rss_bytes: sample.rssBytes,
          limit_bytes: state.rssLimitBytes,
        });
        state.restarts += 1;
        state.pid = null;
        state.cpuOverSince = null;
        this.actions.restart(addonId, `RSS ${sample.rssBytes} > limit ${state.rssLimitBytes}`);
        continue;
      }

      if (sample.cpuPercent > this.cpuPercentThreshold) {
        if (state.cpuOverSince === null) {
          state.cpuOverSince = now;
        } else if (now - state.cpuOverSince >= this.cpuSustainedMs) {
          // Sustained over the window -> enter the throttle duty cycle.
          state.throttling = true;
          state.throttleCycles = 1;
          state.cpuOverSince = null;
          this.actions.warn(addonId, 'cpu_throttled', {
            cpu_percent: sample.cpuPercent,
            threshold: this.cpuPercentThreshold,
            sustained_ms: this.cpuSustainedMs,
          });
          this.actions.throttle(addonId);
          state.stoppedUntil = now + this.throttleStopMs;
        }
      } else {
        state.cpuOverSince = null;
      }
    }
  }

  private tickThrottling(addonId: string, state: WatchdogState, now: number): void {
    if (state.stoppedUntil !== null) {
      if (now >= state.stoppedUntil) {
        this.actions.resume(addonId);
        state.stoppedUntil = null;
        state.runningUntil = now + this.throttleRunMs;
      }
      return;
    }
    if (now < state.runningUntil) return;

    const sample = state.pid === null ? null : this.metrics.sample(state.pid);
    if (sample) {
      state.lastCpuPercent = sample.cpuPercent;
      state.lastRssBytes = sample.rssBytes;
    }
    if (!sample || sample.cpuPercent <= this.cpuPercentThreshold) {
      state.throttling = false;
      state.cpuOverSince = null;
      this.actions.warn(addonId, 'cpu_throttle_released', {
        cpu_percent: sample?.cpuPercent ?? null,
        cycles: state.throttleCycles,
      });
      return;
    }
    // Still hot -> next SIGSTOP phase.
    state.throttleCycles += 1;
    this.actions.throttle(addonId);
    state.stoppedUntil = now + this.throttleStopMs;
  }

  getStatus(addonId: string): AddonWatchdogStatus | null {
    const state = this.states.get(addonId);
    if (!state) return null;
    const now = this.now();
    return {
      pid: state.pid,
      rssLimitBytes: state.rssLimitBytes,
      throttled: state.throttling,
      throttleCycles: state.throttleCycles,
      crashesInWindow: state.crashTimes.filter((t) => now - t < this.crashWindowMs).length,
      restarts: state.restarts,
      lastCpuPercent: state.lastCpuPercent,
      lastRssBytes: state.lastRssBytes,
    };
  }

  private ensure(addonId: string): WatchdogState {
    const state: WatchdogState = {
      pid: null,
      rssLimitBytes: this.defaultRssLimitBytes,
      cpuOverSince: null,
      throttling: false,
      stoppedUntil: null,
      runningUntil: this.now(),
      throttleCycles: 0,
      crashTimes: [],
      restarts: 0,
      lastCpuPercent: null,
      lastRssBytes: null,
    };
    this.states.set(addonId, state);
    return state;
  }
}

// ---------------------------------------------------------------------------
// The real, Linux `/proc`-based metrics source
// ---------------------------------------------------------------------------

/** Injectable file reader so the parser itself is unit-testable. */
export type ProcReader = (path: string) => string;

export interface ProcMetricsSourceOptions {
  readFile?: ProcReader;
  now?: () => number;
  /** `sysconf(_SC_CLK_TCK)`; 100 on every mainstream Linux. */
  clockTicksPerSecond?: number;
  pageSizeBytes?: number;
}

/**
 * Reads `/proc/<pid>/stat` and derives CPU% BETWEEN CONSECUTIVE SAMPLES (the
 * only meaningful reading -- a single sample would report the process's
 * lifetime average and never trip a "sustained over 60 s" rule). Returns
 * `null` on the first sample for a pid (no baseline yet), when the process is
 * gone, or on a non-Linux host (no `/proc`), in which case the watchdog simply
 * has nothing to act on -- it never guesses.
 */
export class ProcMetricsSource implements AddonMetricsSource {
  private readonly readFile: ProcReader;
  private readonly now: () => number;
  private readonly clockTicks: number;
  private readonly pageSize: number;
  private readonly last = new Map<number, { ticks: number; at: number }>();

  constructor(opts: ProcMetricsSourceOptions = {}) {
    // Lazy `require`-free default: `readFileSync` is imported by the caller in
    // production; here we bind it once so tests can substitute a fake.
    this.readFile = opts.readFile ?? defaultProcReader;
    this.now = opts.now ?? ((): number => Date.now());
    this.clockTicks = opts.clockTicksPerSecond ?? 100;
    this.pageSize = opts.pageSizeBytes ?? 4096;
  }

  sample(pid: number): AddonProcessMetrics | null {
    let raw: string;
    try {
      raw = this.readFile(`/proc/${pid}/stat`);
    } catch {
      this.last.delete(pid);
      return null;
    }
    const parsed = parseProcStat(raw);
    if (!parsed) return null;

    const at = this.now();
    const rssBytes = parsed.rssPages * this.pageSize;
    const previous = this.last.get(pid);
    this.last.set(pid, { ticks: parsed.cpuTicks, at });
    if (!previous || at <= previous.at) {
      // No baseline yet -> report RSS only, CPU 0 (never a false positive).
      return { cpuPercent: 0, rssBytes };
    }
    const elapsedSeconds = (at - previous.at) / 1000;
    const cpuSeconds = (parsed.cpuTicks - previous.ticks) / this.clockTicks;
    const cpuPercent = Math.max(0, (cpuSeconds / elapsedSeconds) * 100);
    return { cpuPercent, rssBytes };
  }

  forget(pid: number): void {
    this.last.delete(pid);
  }
}

function defaultProcReader(path: string): string {
  return readFileSync(path, 'utf8');
}

export interface ParsedProcStat {
  cpuTicks: number;
  rssPages: number;
}

/**
 * Parses the fields we need out of `/proc/<pid>/stat`. The process NAME (field
 * 2) is wrapped in parentheses and may itself contain spaces AND parentheses
 * (`(my (weird) proc)`), so parsing starts after the LAST `)` -- the standard,
 * correct way. After that point `fields[0]` is field 3 (state), so field N is
 * `fields[N - 3]`: utime = 14, stime = 15, rss (pages) = 24 (proc(5)).
 */
export function parseProcStat(raw: string): ParsedProcStat | null {
  const close = raw.lastIndexOf(')');
  if (close === -1) return null;
  const fields = raw.slice(close + 1).trim().split(/\s+/);
  const utime = Number(fields[14 - 3]);
  const stime = Number(fields[15 - 3]);
  const rssPages = Number(fields[24 - 3]);
  if (!Number.isFinite(utime) || !Number.isFinite(stime) || !Number.isFinite(rssPages)) return null;
  return { cpuTicks: utime + stime, rssPages };
}
