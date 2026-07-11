/**
 * Internal typed publish/subscribe event bus (ADR-010).
 *
 * The core runs a single internal event bus. The WebSocket server, the
 * future MQTT bridge and the future plugin host are all subscribers of the
 * *same* bus so every transport observes identical payload shapes -- there
 * is exactly one place (`packages/shared`) where a payload schema lives.
 */

import { validatePosition, type Position } from '@yapaja/shared';

/**
 * Topics with a statically-known payload shape. More topics will be added
 * by later tasks (`nav/*`, `route/*`, `addon/*`, ...); `BusTopic` below
 * stays open to those without requiring changes to this module.
 */
export type KnownBusTopic =
  | 'pos/update'
  | 'pos/extrapolated'
  | 'event/gps_lost'
  | 'event/gps_source_changed'
  | 'system/health';

export interface GpsLostPayload {
  /** Source that was active immediately before the fix was lost, if any. */
  lastSource: 'gpsd' | 'browser' | 'simulator' | null;
}

export interface GpsSourceChangedPayload {
  from: 'gpsd' | 'browser' | 'simulator' | null;
  to: 'gpsd' | 'browser' | 'simulator' | null;
}

export interface SystemHealthPayload {
  status: 'ok' | 'degraded' | 'down';
  services: Record<string, string>;
}

/**
 * Dead-reckoned position (E02-T5, W-01): same shape as `Position` plus a
 * discriminating `extrapolated: true`. Kept structural (no import from
 * `../position/`) to avoid a bus <-> position module cycle -- the position
 * module imports `EventBus`/`BusPayloadMap` from here, not the other way
 * round. `../position/deadReckoning.ts` re-exports the identical alias as
 * `ExtrapolatedPosition`.
 */
export type ExtrapolatedPositionPayload = Position & { extrapolated: true };

/** Maps each known topic to its payload type. */
export interface BusPayloadMap {
  'pos/update': Position;
  'pos/extrapolated': ExtrapolatedPositionPayload;
  'event/gps_lost': GpsLostPayload;
  'event/gps_source_changed': GpsSourceChangedPayload;
  'system/health': SystemHealthPayload;
}

/**
 * Topic identifier accepted by publish/subscribe. Kept as a plain `string`
 * (rather than a closed union) so future topics don't require touching this
 * file; `KnownBusTopic` overloads below still give strong payload typing
 * for the topics that already have one.
 */
export type BusTopic = string;

export type BusHandler<P = unknown> = (payload: P, topic: string) => void;

export interface EventBusLogger {
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

const defaultLogger: EventBusLogger = {
  warn: (msg, meta) => console.warn(msg, meta ?? ''),
  error: (msg, meta) => console.error(msg, meta ?? ''),
};

type TopicValidator = (data: unknown) => boolean;

/**
 * Per-topic payload validators. Only topics with a schema in
 * `@yapaja/shared` are validated here; unlisted topics pass through
 * unchecked until a schema is added for them (see task E02-T1 scope note).
 */
const topicValidators: Partial<Record<KnownBusTopic, TopicValidator>> = {
  'pos/update': (data: unknown): boolean =>
    validatePosition(data) && (data as Position).fix !== 'none',
  // `positionSchema` (packages/shared/src/schemas/position.ts) declares
  // `additionalProperties: false`, so `validatePosition()` rejects any
  // object carrying the extra `extrapolated` field outright. The
  // `extrapolated` key is stripped before delegating to `validatePosition`
  // so the rest of the Position shape is still checked; `packages/shared`
  // itself is out of scope for this task and stays unchanged.
  'pos/extrapolated': (data: unknown): boolean => {
    if (!data || typeof data !== 'object') return false;
    const { extrapolated, ...base } = data as Record<string, unknown>;
    return extrapolated === true && validatePosition(base) && (base as Position).fix !== 'none';
  },
};

interface Subscription {
  pattern: string;
  handler: BusHandler;
}

/** Exact match, or prefix match when `pattern` ends with `*` (e.g. `pos/*`, `*`). */
function topicMatches(pattern: string, topic: string): boolean {
  if (pattern === topic) return true;
  if (pattern.endsWith('*')) {
    return topic.startsWith(pattern.slice(0, -1));
  }
  return false;
}

export interface EventBusOptions {
  logger?: EventBusLogger;
  /** Overrides the NODE_ENV-based throw/drop decision; mainly for tests. */
  isProduction?: boolean;
}

export class EventBus {
  private subscriptions: Subscription[] = [];
  private readonly logger: EventBusLogger;
  private readonly isProduction: boolean;

  constructor(opts: EventBusOptions = {}) {
    this.logger = opts.logger ?? defaultLogger;
    this.isProduction = opts.isProduction ?? process.env.NODE_ENV === 'production';
  }

  publish<T extends KnownBusTopic>(topic: T, payload: BusPayloadMap[T]): void;
  publish(topic: string, payload: unknown): void;
  publish(topic: string, payload: unknown): void {
    const validator = topicValidators[topic as KnownBusTopic];
    if (validator && !validator(payload)) {
      const message = `EventBus: invalid payload for topic "${topic}"`;
      if (this.isProduction) {
        this.logger.error(message, { topic, payload });
        return;
      }
      throw new Error(message);
    }

    // Snapshot so a handler that (un)subscribes during dispatch can't affect
    // this dispatch pass.
    for (const sub of [...this.subscriptions]) {
      if (!topicMatches(sub.pattern, topic)) continue;
      try {
        sub.handler(payload, topic);
      } catch (err) {
        this.logger.error(`EventBus: handler for pattern "${sub.pattern}" threw`, {
          topic,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  subscribe<T extends KnownBusTopic>(pattern: T, handler: BusHandler<BusPayloadMap[T]>): () => void;
  subscribe(pattern: string, handler: BusHandler): () => void;
  subscribe(pattern: string, handler: BusHandler): () => void {
    const sub: Subscription = { pattern, handler: handler as BusHandler };
    this.subscriptions.push(sub);
    return (): void => {
      const idx = this.subscriptions.indexOf(sub);
      if (idx !== -1) this.subscriptions.splice(idx, 1);
    };
  }

  /** Number of active subscriptions; mainly useful for leak-detection in tests. */
  get subscriberCount(): number {
    return this.subscriptions.length;
  }
}
