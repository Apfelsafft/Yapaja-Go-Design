/**
 * PositionService: registry of position sources, priority-based failover,
 * rate-limited `pos/update` publishing and `event/gps_lost` /
 * `event/gps_source_changed` transitions.
 *
 * Concrete sources (gpsd client, browser ingestion, simulator) are added in
 * later tasks. This service only owns the registry, the active-source
 * selection and the publishing behavior around it (ADR-007).
 */

import { checkPosition, validatePosition, type Position } from '@yapaja/shared';
import type { EventBus } from '../bus/index.js';

/* eslint-disable no-undef -- setTimeout/setInterval/clear* are standard Node
 * globals; the shared eslint config's `globals` list predates this backend
 * module and only covers console/process/DOM. Using the real globalThis
 * timer functions (rather than importing from 'node:timers') matters here:
 * vi.useFakeTimers() patches globalThis, not the 'node:timers' module
 * exports, and this service's tests rely on fake timers. */

export type PositionSourceName = 'gpsd' | 'browser' | 'simulator' | 'ha_tracker';

export const POSITION_SOURCE_NAMES: readonly PositionSourceName[] = [
  'gpsd',
  'browser',
  'ha_tracker',
  'simulator',
];

/**
 * Registrable position source. Only carries identity for now; concrete
 * source implementations attach their own lifecycle in later tasks and call
 * `PositionService.pushFix()` to deliver fixes.
 */
export interface PositionSource {
  name: PositionSourceName;
}

export interface SourceStatus {
  name: PositionSourceName;
  active: boolean;
  lastFixTs: string | null;
}

export interface PositionServiceLogger {
  warn: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface PositionServiceOptions {
  bus: EventBus;
  /**
   * Highest priority first. Default: gpsd > browser > ha_tracker > simulator
   * (ADR-007, um `ha_tracker` erweitert).
   *
   * WARUM `ha_tracker` UNTER `browser` STEHT: die Home-Assistant-Companion-App
   * meldet in Intervallen, nicht fortlaufend. Fuer eine Abbiegeansage in
   * 200 m ist das zu traege. Sie ist die Quelle, die es GIBT, wenn der
   * Browser keine liefert -- etwa weil er den GPS-Sensor ohne HTTPS gar nicht
   * freigibt -- und nicht die, die einen laufenden Browser-Fix ersetzt.
   */
  priority?: PositionSourceName[];
  /** A source counts as "active" if it delivered a fix within this window. */
  activeWindowMs?: number;
  /** How often staleness is re-evaluated even without a new incoming fix. */
  checkIntervalMs?: number;
  /** Publish rate for `pos/update`. Clamped to (0, 5] Hz; default 1 Hz. */
  rateHz?: number;
  logger?: PositionServiceLogger;
}

interface SourceState {
  lastFix: Position | null;
  lastFixTs: number | null;
}

const DEFAULT_PRIORITY: PositionSourceName[] = ['gpsd', 'browser', 'ha_tracker', 'simulator'];
const DEFAULT_ACTIVE_WINDOW_MS = 5000;
const DEFAULT_CHECK_INTERVAL_MS = 250;
const DEFAULT_RATE_HZ = 1;
const MAX_RATE_HZ = 5;

export class PositionService {
  private readonly bus: EventBus;
  private readonly priority: PositionSourceName[];
  private readonly activeWindowMs: number;
  private readonly rateHz: number;
  private readonly logger: PositionServiceLogger;

  private readonly registered = new Map<PositionSourceName, PositionSource>();
  private readonly sourceStates = new Map<PositionSourceName, SourceState>();

  private forcedSource: PositionSourceName | null = null;
  private activeSource: PositionSourceName | null = null;
  private lastPosition: Position | null = null;
  private gpsLostFired = false;

  private lastPublishAtMs = -Infinity;
  private pendingPosition: Position | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private checkTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: PositionServiceOptions) {
    this.bus = opts.bus;
    this.priority = opts.priority ?? DEFAULT_PRIORITY;
    this.activeWindowMs = opts.activeWindowMs ?? DEFAULT_ACTIVE_WINDOW_MS;
    this.rateHz = Math.min(MAX_RATE_HZ, Math.max(0.1, opts.rateHz ?? DEFAULT_RATE_HZ));
    this.logger = opts.logger ?? {
      warn: (msg, meta) => console.warn(msg, meta ?? ''),
    };

    for (const name of POSITION_SOURCE_NAMES) {
      this.sourceStates.set(name, { lastFix: null, lastFixTs: null });
    }

    const checkIntervalMs = opts.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
    this.checkTimer = setInterval(() => this.handleTick(), checkIntervalMs);
    this.checkTimer.unref?.();
  }

  registerSource(source: PositionSource): void {
    this.registered.set(source.name, source);
  }

  getRegisteredSources(): PositionSource[] {
    return [...this.registered.values()];
  }

  /**
   * Deliver a fix from `source`. Invalid (schema) or implausible fixes are
   * dropped and logged -- sources are external/untrusted input, so unlike
   * `EventBus.publish` (an internal API where a bad payload signals a
   * programming bug) we never throw here, even outside production.
   */
  pushFix(source: PositionSourceName, position: Position): void {
    if (!validatePosition(position)) {
      this.logger.warn('PositionService: dropped fix with invalid schema', { source });
      return;
    }
    if (position.fix === 'none') {
      // No usable fix: never published, and does not count as source activity.
      return;
    }
    const plausibility = checkPosition(position);
    if (!plausibility.ok) {
      this.logger.warn('PositionService: dropped implausible fix', {
        source,
        violations: plausibility.violations,
      });
      return;
    }

    const state = this.sourceStates.get(source);
    /* istanbul ignore next -- sourceStates is pre-seeded for every PositionSourceName in the constructor */
    if (!state) return;
    state.lastFix = position;
    state.lastFixTs = Date.now();

    const newActive = this.recomputeActiveSource();
    // Only publish when this fix is the one that's actually driving the
    // currently active source -- avoids re-publishing an unchanged position
    // from a lower-priority source or on every periodic staleness check.
    if (newActive === source) {
      this.lastPosition = position;
      this.publishThrottled(position);
    }
  }

  getLast(): Position | null {
    return this.lastPosition;
  }

  getSources(): SourceStatus[] {
    const now = Date.now();
    return POSITION_SOURCE_NAMES.map((name) => {
      const state = this.sourceStates.get(name);
      const lastFixTs = state?.lastFixTs ?? null;
      return {
        name,
        active: this.isSourceActive(name, now),
        lastFixTs: lastFixTs !== null ? new Date(lastFixTs).toISOString() : null,
      };
    });
  }

  getActiveSource(): PositionSourceName | null {
    return this.activeSource;
  }

  getForcedSource(): PositionSourceName | null {
    return this.forcedSource;
  }

  /** Whether `name` could become the active source right now (not forced to a different one). */
  isSourceSelectable(name: PositionSourceName): boolean {
    return this.forcedSource === null || this.forcedSource === name;
  }

  setForcedSource(name: PositionSourceName | null): void {
    this.forcedSource = name;
    this.recomputeActiveSource();
  }

  /** Clears timers; call on shutdown/test teardown to avoid leaks. */
  dispose(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  private isSourceActive(name: PositionSourceName, now: number): boolean {
    const state = this.sourceStates.get(name);
    return !!state && state.lastFixTs !== null && now - state.lastFixTs <= this.activeWindowMs;
  }

  /**
   * Re-evaluates which source is active and fires the corresponding
   * transition events. Does not publish `pos/update` itself -- callers
   * decide whether the recomputation should also trigger a publish.
   */
  private recomputeActiveSource(): PositionSourceName | null {
    const now = Date.now();
    const candidates = this.forcedSource ? [this.forcedSource] : this.priority;

    let newActive: PositionSourceName | null = null;
    for (const name of candidates) {
      if (this.isSourceActive(name, now)) {
        newActive = name;
        break;
      }
    }

    const previousActive = this.activeSource;
    if (newActive !== previousActive) {
      this.activeSource = newActive;
      this.bus.publish('event/gps_source_changed', { from: previousActive, to: newActive });
    }

    if (newActive === null) {
      // Only a transition *from* an active source counts as "lost" -- never
      // having had a fix at all is not a loss transition.
      if (previousActive !== null && !this.gpsLostFired) {
        this.gpsLostFired = true;
        this.bus.publish('event/gps_lost', { lastSource: previousActive });
      }
    } else {
      this.gpsLostFired = false;
    }

    return newActive;
  }

  /**
   * Periodic staleness check (runs even without new incoming fixes). Only
   * publishes when it actually causes a failover to a different source --
   * otherwise it would re-publish an unchanged position on every tick.
   */
  private handleTick(): void {
    const previousActive = this.activeSource;
    const newActive = this.recomputeActiveSource();
    if (newActive !== null && newActive !== previousActive) {
      const state = this.sourceStates.get(newActive);
      if (state?.lastFix) {
        this.lastPosition = state.lastFix;
        this.publishThrottled(state.lastFix);
      }
    }
  }

  /** Trailing-edge throttle: publishes at most `rateHz` times/second; the latest fix wins. */
  private publishThrottled(position: Position): void {
    const minIntervalMs = 1000 / this.rateHz;
    const now = Date.now();
    const elapsed = now - this.lastPublishAtMs;

    if (elapsed >= minIntervalMs) {
      this.lastPublishAtMs = now;
      this.bus.publish('pos/update', position);
      return;
    }

    this.pendingPosition = position;
    if (this.pendingTimer) return; // trailing publish already scheduled; last value wins

    const delay = minIntervalMs - elapsed;
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      const pending = this.pendingPosition;
      this.pendingPosition = null;
      if (pending) {
        this.lastPublishAtMs = Date.now();
        this.bus.publish('pos/update', pending);
      }
    }, delay);
  }
}
