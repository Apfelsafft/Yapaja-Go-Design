/**
 * DeadReckoningController: extrapolates the vehicle's position for up to
 * `maxWindowMs` after GPS is lost (W-01, docs/08-wargame.md), publishing
 * `pos/extrapolated` fixes tagged `extrapolated: true` while an active route
 * exists to extrapolate along.
 *
 * Deliberately publishes on its own `pos/extrapolated` topic, never on
 * `pos/update` -- an extrapolated fix must never be mistaken for a real one.
 * This matters beyond the puck's gray styling: the future MQTT bridge
 * (E08) only republishes `pos/update` as `yapaja/position`, so keeping
 * extrapolation on its own topic means a dead-reckoned guess is never
 * forwarded to external consumers as a real fix. See
 * deadReckoning.test.ts's `it.todo` for the explicit invariant that
 * documents this once the MQTT mapping exists.
 *
 * The actual extrapolation math (route-aware dead reckoning) ships in
 * E04-T6; until then `noopDeadReckoningProvider` always returns null, so in
 * production the puck simply freezes -- matches the "no active route"
 * branch of W-01 for every session today.
 */

/* eslint-disable no-undef -- setInterval/clearInterval are standard Node
 * globals; see the identical rationale comment in ./service.ts. Using
 * globalThis timers (rather than importing from 'node:timers') matters here
 * too: vi.useFakeTimers() patches globalThis, not the 'node:timers' module
 * exports, and this controller's tests rely on fake timers. */

import type { Position } from '@yapaja/shared';
import type { EventBus, GpsSourceChangedPayload } from '../bus/index.js';
import type { PositionService } from './service.js';

/** Extrapolates a position forward from the last real fix after GPS is lost. */
export interface DeadReckoningProvider {
  /**
   * Extrapolated position `elapsedMs` after GPS was lost, or null when no
   * extrapolation is possible (e.g. no active route to extrapolate along).
   */
  extrapolate(lastFix: Position, elapsedMs: number): Position | null;
}

/**
 * Placeholder provider used until E04-T6 ships the real route-based
 * implementation: always declines to extrapolate, so the puck freezes
 * instead of guessing (W-01's "ohne aktive Route" branch).
 */
export const noopDeadReckoningProvider: DeadReckoningProvider = {
  extrapolate: () => null,
};

export type ExtrapolatedPosition = Position & { extrapolated: true };

export interface DeadReckoningLogger {
  warn: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface DeadReckoningControllerOptions {
  bus: EventBus;
  service: PositionService;
  /** Default: `noopDeadReckoningProvider` (no extrapolation until E04-T6). */
  provider?: DeadReckoningProvider;
  /** Extrapolation stops after this many ms without a real fix. Default 30000 (W-01). */
  maxWindowMs?: number;
  /** How often extrapolated fixes are computed/published. Default 1 Hz. */
  rateHz?: number;
  logger?: DeadReckoningLogger;
}

const DEFAULT_MAX_WINDOW_MS = 30_000;
const DEFAULT_RATE_HZ = 1;

export class DeadReckoningController {
  private readonly bus: EventBus;
  private readonly service: PositionService;
  private readonly provider: DeadReckoningProvider;
  private readonly maxWindowMs: number;
  private readonly tickIntervalMs: number;
  private readonly logger: DeadReckoningLogger;

  private readonly unsubscribers: Array<() => void>;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private lastFix: Position | null = null;
  private lossStartMs: number | null = null;

  constructor(opts: DeadReckoningControllerOptions) {
    this.bus = opts.bus;
    this.service = opts.service;
    this.provider = opts.provider ?? noopDeadReckoningProvider;
    this.maxWindowMs = opts.maxWindowMs ?? DEFAULT_MAX_WINDOW_MS;
    this.tickIntervalMs = 1000 / (opts.rateHz ?? DEFAULT_RATE_HZ);
    this.logger = opts.logger ?? {
      warn: (msg, meta) => console.warn(msg, meta ?? ''),
    };

    this.unsubscribers = [
      this.bus.subscribe('event/gps_lost', () => this.handleGpsLost()),
      this.bus.subscribe('pos/update', () => this.stopExtrapolation()),
      this.bus.subscribe('event/gps_source_changed', (payload: GpsSourceChangedPayload) => {
        if (payload.to !== null) this.stopExtrapolation();
      }),
    ];
  }

  /** Clears the tick timer and all bus subscriptions; call on shutdown/test teardown. */
  dispose(): void {
    this.clearTimer();
    for (const unsub of this.unsubscribers) unsub();
  }

  private handleGpsLost(): void {
    const lastFix = this.service.getLast();
    if (!lastFix) {
      // Defensive: PositionService only fires gps_lost after a source was
      // active, which implies getLast() is set -- but never extrapolate
      // from nothing.
      this.logger.warn('DeadReckoningController: gps_lost fired with no last fix, skipping');
      return;
    }
    this.lastFix = lastFix;
    this.lossStartMs = Date.now();
    this.startTicking();
  }

  private startTicking(): void {
    this.clearTimer();
    this.tickTimer = setInterval(() => this.tick(), this.tickIntervalMs);
    this.tickTimer.unref?.();
  }

  private tick(): void {
    if (this.lastFix === null || this.lossStartMs === null) {
      this.stopExtrapolation();
      return;
    }

    const elapsedMs = Date.now() - this.lossStartMs;
    if (elapsedMs > this.maxWindowMs) {
      this.stopExtrapolation();
      return;
    }

    const extrapolated = this.provider.extrapolate(this.lastFix, elapsedMs);
    if (extrapolated !== null) {
      // Own topic, not `pos/update` -- see module docstring: keeps
      // dead-reckoned guesses out of the future MQTT `yapaja/position`
      // mapping (E08), which only republishes `pos/update`.
      const payload: ExtrapolatedPosition = { ...extrapolated, extrapolated: true };
      this.bus.publish('pos/extrapolated', payload);
    }
  }

  private stopExtrapolation(): void {
    this.clearTimer();
    this.lastFix = null;
    this.lossStartMs = null;
  }

  private clearTimer(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }
}
