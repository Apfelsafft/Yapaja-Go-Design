/**
 * Watchdog policy tests (E09-T3, W-14). Fully DETERMINISTIC: the clock is a
 * plain number the test advances, and the metrics source returns whatever
 * `{cpuPercent, rssBytes}` the test dictates -- no sleeps, no busy loops, no
 * timing races. (A real busy-loop fixture is exercised separately in
 * `service-host.test.ts` as end-to-end evidence.)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AddonWatchdog,
  DEFAULT_CPU_PERCENT_THRESHOLD,
  DEFAULT_CPU_SUSTAINED_MS,
  DEFAULT_RSS_LIMIT_BYTES,
  ProcMetricsSource,
  parseProcStat,
  type AddonProcessMetrics,
  type AddonWatchdogEvent,
  type WatchdogActions,
} from './watchdog.js';

const ADDON = 'com.example.amok';
const MB = 1024 * 1024;

interface Recorded {
  throttle: string[];
  resume: string[];
  restart: Array<{ addonId: string; reason: string }>;
  autoDisable: Array<{ addonId: string; reason: string }>;
  warn: Array<{ addonId: string; event: AddonWatchdogEvent; detail: Record<string, unknown> }>;
}

function harness(overrides: Partial<AddonProcessMetrics> = {}): {
  clock: { now: number };
  sample: AddonProcessMetrics;
  setSample: (s: Partial<AddonProcessMetrics>) => void;
  recorded: Recorded;
  watchdog: AddonWatchdog;
  advance: (ms: number) => void;
} {
  const clock = { now: 1_000_000 };
  let sample: AddonProcessMetrics = { cpuPercent: 1, rssBytes: 10 * MB, ...overrides };
  const recorded: Recorded = { throttle: [], resume: [], restart: [], autoDisable: [], warn: [] };
  const actions: WatchdogActions = {
    throttle: (id) => recorded.throttle.push(id),
    resume: (id) => recorded.resume.push(id),
    restart: (addonId, reason) => recorded.restart.push({ addonId, reason }),
    autoDisable: (addonId, reason) => recorded.autoDisable.push({ addonId, reason }),
    warn: (addonId, event, detail) => recorded.warn.push({ addonId, event, detail }),
  };
  const watchdog = new AddonWatchdog({
    metrics: { sample: () => sample },
    actions,
    now: () => clock.now,
  });
  return {
    clock,
    get sample(): AddonProcessMetrics {
      return sample;
    },
    setSample: (s) => {
      sample = { ...sample, ...s };
    },
    recorded,
    watchdog,
    advance: (ms) => {
      clock.now += ms;
    },
  };
}

describe('AddonWatchdog (E09-T3, W-14)', () => {
  describe('CPU > 25% sustained over 60 s => throttle + warning', () => {
    let h: ReturnType<typeof harness>;

    beforeEach(() => {
      h = harness();
      h.watchdog.register(ADDON, 4242);
    });

    it('does NOT throttle a brief CPU spike', () => {
      h.setSample({ cpuPercent: 95 });
      h.watchdog.tick();
      h.advance(30_000); // half the window
      h.watchdog.tick();
      h.setSample({ cpuPercent: 3 }); // calmed down
      h.advance(60_000);
      h.watchdog.tick();
      expect(h.recorded.throttle).toEqual([]);
      expect(h.recorded.warn).toEqual([]);
    });

    it('does not throttle at exactly the 25% threshold (strictly greater)', () => {
      h.setSample({ cpuPercent: DEFAULT_CPU_PERCENT_THRESHOLD });
      for (let i = 0; i < 10; i++) {
        h.watchdog.tick();
        h.advance(10_000);
      }
      expect(h.recorded.throttle).toEqual([]);
    });

    it('throttles (SIGSTOP) + warns once CPU stays over 25% for 60 s', () => {
      h.setSample({ cpuPercent: 90 });
      h.watchdog.tick(); // streak starts here
      h.advance(DEFAULT_CPU_SUSTAINED_MS - 1);
      h.watchdog.tick();
      expect(h.recorded.throttle).toEqual([]); // one ms short

      h.advance(1);
      h.watchdog.tick();
      expect(h.recorded.throttle).toEqual([ADDON]);
      const warning = h.recorded.warn.find((w) => w.event === 'cpu_throttled');
      expect(warning).toBeDefined();
      expect(warning?.detail.cpu_percent).toBe(90);
      expect(warning?.detail.threshold).toBe(DEFAULT_CPU_PERCENT_THRESHOLD);
      expect(h.watchdog.getStatus(ADDON)?.throttled).toBe(true);
    });

    it('runs SIGSTOP/SIGCONT DUTY CYCLES while the add-on stays hot, and releases when it calms down', () => {
      h.setSample({ cpuPercent: 90 });
      h.watchdog.tick();
      h.advance(DEFAULT_CPU_SUSTAINED_MS);
      h.watchdog.tick(); // -> throttling, cycle 1 (SIGSTOP)
      expect(h.recorded.throttle).toHaveLength(1);

      // End of the stopped phase -> SIGCONT.
      h.advance(500);
      h.watchdog.tick();
      expect(h.recorded.resume).toEqual([ADDON]);

      // End of the running phase, still hot -> SIGSTOP again (cycle 2).
      h.advance(1_500);
      h.watchdog.tick();
      expect(h.recorded.throttle).toHaveLength(2);
      expect(h.watchdog.getStatus(ADDON)?.throttleCycles).toBe(2);

      // It calms down: resume, then release at the next re-sample.
      h.advance(500);
      h.watchdog.tick(); // SIGCONT
      h.setSample({ cpuPercent: 4 });
      h.advance(1_500);
      h.watchdog.tick();
      expect(h.recorded.warn.some((w) => w.event === 'cpu_throttle_released')).toBe(true);
      expect(h.watchdog.getStatus(ADDON)?.throttled).toBe(false);
      expect(h.recorded.resume).toHaveLength(2);
      // Never killed -- throttling slows an add-on down, it does not destroy it.
      expect(h.recorded.restart).toEqual([]);
      expect(h.recorded.autoDisable).toEqual([]);
    });
  });

  describe('RSS limit => kill + restart', () => {
    it('restarts the process when RSS exceeds the manifest limit', () => {
      const h = harness();
      h.watchdog.register(ADDON, 4242, 64 * MB);
      h.setSample({ rssBytes: 63 * MB });
      h.watchdog.tick();
      expect(h.recorded.restart).toEqual([]);

      h.setSample({ rssBytes: 65 * MB });
      h.watchdog.tick();
      expect(h.recorded.restart).toHaveLength(1);
      expect(h.recorded.restart[0].addonId).toBe(ADDON);
      const warning = h.recorded.warn.find((w) => w.event === 'rss_exceeded');
      expect(warning?.detail.rss_bytes).toBe(65 * MB);
      expect(warning?.detail.limit_bytes).toBe(64 * MB);
      expect(h.watchdog.getStatus(ADDON)?.restarts).toBe(1);
    });

    it('defaults to a 256 MB limit when the manifest declares none', () => {
      const h = harness();
      h.watchdog.register(ADDON, 4242);
      expect(h.watchdog.getStatus(ADDON)?.rssLimitBytes).toBe(DEFAULT_RSS_LIMIT_BYTES);
      h.setSample({ rssBytes: DEFAULT_RSS_LIMIT_BYTES - 1 });
      h.watchdog.tick();
      expect(h.recorded.restart).toEqual([]);
      h.setSample({ rssBytes: DEFAULT_RSS_LIMIT_BYTES + 1 });
      h.watchdog.tick();
      expect(h.recorded.restart).toHaveLength(1);
    });

    it('stops sampling a restarted process until it is re-registered', () => {
      const h = harness();
      h.watchdog.register(ADDON, 4242, 64 * MB);
      h.setSample({ rssBytes: 200 * MB });
      h.watchdog.tick();
      h.watchdog.tick();
      h.watchdog.tick();
      expect(h.recorded.restart).toHaveLength(1);
    });
  });

  describe('> 5 crashes in 10 min => auto-disable', () => {
    it('restarts up to 5 crashes and auto-disables on the 6th', () => {
      const h = harness();
      h.watchdog.register(ADDON, 1);
      for (let i = 1; i <= 5; i++) {
        expect(h.watchdog.recordCrash(ADDON, { code: 1 })).toBe('restart');
        h.advance(1_000);
        h.watchdog.register(ADDON, 100 + i); // respawn
      }
      expect(h.watchdog.getStatus(ADDON)?.crashesInWindow).toBe(5);
      expect(h.recorded.autoDisable).toEqual([]);

      expect(h.watchdog.recordCrash(ADDON, { code: 1 })).toBe('auto_disabled');
      expect(h.recorded.autoDisable).toHaveLength(1);
      expect(h.recorded.autoDisable[0].addonId).toBe(ADDON);
      expect(h.recorded.autoDisable[0].reason).toContain('6 crashes');
      expect(h.recorded.warn.some((w) => w.event === 'auto_disabled')).toBe(true);
    });

    it('a respawn does NOT reset the crash history (otherwise a loop never trips)', () => {
      const h = harness();
      for (let i = 0; i < 5; i++) {
        h.watchdog.register(ADDON, 100 + i);
        h.watchdog.recordCrash(ADDON);
      }
      h.watchdog.register(ADDON, 999);
      expect(h.watchdog.getStatus(ADDON)?.crashesInWindow).toBe(5);
    });

    it('forgets crashes older than the 10-minute window', () => {
      const h = harness();
      h.watchdog.register(ADDON, 1);
      for (let i = 0; i < 5; i++) {
        h.watchdog.recordCrash(ADDON);
        h.advance(60_000);
      }
      // 5 crashes, the oldest 5 min ago -> still inside the window.
      expect(h.watchdog.getStatus(ADDON)?.crashesInWindow).toBe(5);
      h.advance(9 * 60_000); // the first four fall out of the window
      expect(h.watchdog.recordCrash(ADDON)).toBe('restart');
      expect(h.recorded.autoDisable).toEqual([]);
    });

    it('every crash is reported as a warning (operator-visible)', () => {
      const h = harness();
      h.watchdog.register(ADDON, 1);
      h.watchdog.recordCrash(ADDON, { code: 1, signal: null });
      const warning = h.recorded.warn.find((w) => w.event === 'crash');
      expect(warning?.detail.code).toBe(1);
      expect(warning?.detail.crashes_in_window).toBe(1);
    });
  });

  describe('bookkeeping', () => {
    it('ignores add-ons with no live pid', () => {
      const h = harness();
      h.watchdog.register(ADDON, 1);
      h.watchdog.markStopped(ADDON);
      h.setSample({ cpuPercent: 100, rssBytes: 10_000 * MB });
      h.advance(DEFAULT_CPU_SUSTAINED_MS * 2);
      h.watchdog.tick();
      expect(h.recorded.throttle).toEqual([]);
      expect(h.recorded.restart).toEqual([]);
    });

    it('unregister() forgets everything', () => {
      const h = harness();
      h.watchdog.register(ADDON, 1);
      h.watchdog.unregister(ADDON);
      expect(h.watchdog.getStatus(ADDON)).toBeNull();
    });
  });
});

describe('ProcMetricsSource (/proc parsing)', () => {
  const STAT = '1234 (node) S 1 1234 1234 0 -1 4194304 5000 0 0 0 250 130 0 0 20 0 11 0 900 700000000 65536 ...';

  it('parses utime/stime/rss out of a /proc/<pid>/stat line', () => {
    const parsed = parseProcStat(STAT);
    expect(parsed).toEqual({ cpuTicks: 250 + 130, rssPages: 65536 });
  });

  it('handles a process name containing spaces and parentheses', () => {
    const weird = STAT.replace('(node)', '(my (weird) proc)');
    expect(parseProcStat(weird)?.cpuTicks).toBe(380);
  });

  it('returns null for garbage', () => {
    expect(parseProcStat('no parens here')).toBeNull();
    expect(parseProcStat('1 (x) S a b c')).toBeNull();
  });

  /** Builds a syntactically real stat line with utime/stime/rss placed at the
   *  proc(5) field positions 14/15/24. */
  function statLine(utime: number, stime: number, rssPages: number): string {
    const fields = new Array(30).fill('0'); // fields[i] is proc field i + 3
    fields[14 - 3] = String(utime);
    fields[15 - 3] = String(stime);
    fields[24 - 3] = String(rssPages);
    return `1 (node) S ${fields.slice(1).join(' ')}`;
  }

  it('derives CPU% from the DELTA between two samples', () => {
    let ticks = 1000;
    let now = 0;
    const source = new ProcMetricsSource({
      readFile: () => statLine(ticks, 0, 1000),
      now: () => now,
      clockTicksPerSecond: 100,
      pageSizeBytes: 4096,
    });
    const first = source.sample(1);
    expect(first).toEqual({ cpuPercent: 0, rssBytes: 1000 * 4096 });

    // 1 second later, 50 ticks of CPU consumed = 0.5 s = 50%.
    now = 1000;
    ticks += 50;
    expect(source.sample(1)?.cpuPercent).toBeCloseTo(50, 5);
  });

  it('returns null when the process is gone', () => {
    const source = new ProcMetricsSource({
      readFile: () => {
        throw new Error('ENOENT');
      },
    });
    expect(source.sample(999999)).toBeNull();
  });
});
