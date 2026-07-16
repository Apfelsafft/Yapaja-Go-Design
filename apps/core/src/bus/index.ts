/**
 * Internal typed publish/subscribe event bus (ADR-010).
 *
 * The core runs a single internal event bus. The WebSocket server, the
 * future MQTT bridge and the future plugin host are all subscribers of the
 * *same* bus so every transport observes identical payload shapes -- there
 * is exactly one place (`packages/shared`) where a payload schema lives.
 */

import {
  validateNavState,
  validateNavInstruction,
  validatePosition,
  type LatLng,
  type NavState,
  type NavInstructionPayload,
  type Position,
} from '@yapaja/shared';

/**
 * Topics with a statically-known payload shape. More topics will be added
 * by later tasks (`route/*`, `addon/*`, ...); `BusTopic` below stays open to
 * those without requiring changes to this module.
 */
export type KnownBusTopic =
  | 'pos/update'
  | 'pos/extrapolated'
  | 'event/gps_lost'
  | 'event/gps_source_changed'
  | 'system/health'
  | 'nav/state'
  | 'nav/instruction'
  | 'event/arrived'
  | 'event/nav_recovered_route_available'
  // E04-T4 rerouting lifecycle:
  | 'route/deviation'
  | 'route/updated'
  | 'event/reroute_loop'
  | 'event/reroute_failed'
  // E06-T1/T3: profile activation + the profile-change-during-navigation
  // reroute coupling.
  | 'event/profile_changed'
  | 'event/profile_change_pending';

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

/** A destination reference carried by navigation events. */
export interface NavDestination {
  latlng: LatLng;
  name: string | null;
}

/** `event/arrived` (E04-T1): fired EXACTLY once when the destination is reached. */
export interface ArrivedPayload {
  route_id: string;
  destination: NavDestination | null;
  /** ISO 8601 UTC timestamp of the arrival. */
  ts: string;
}

/**
 * `event/nav_recovered_route_available` (E04-T1, W-19): fired on startup when a
 * previously-active navigation's route is still available in the cache, so the
 * UI can offer to resume. The core itself stays `idle` (no ghost navigation).
 */
export interface NavRecoveredRoutePayload {
  route_id: string;
  destination: NavDestination | null;
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

/**
 * `route/deviation` (E04-T4): published the moment a deviation is CONFIRMED
 * (sustained cross-track/heading violation over ≥5 s AND ≥5 fixes) — a transient
 * blip or 15 m GPS noise never reaches this. Precedes the reroute attempt.
 */
export interface RouteDeviationPayload {
  /** Where the confirmed deviation was observed. */
  at: LatLng;
  /** Cross-track offset from the original route at confirmation, metres. */
  cross_track_m: number;
  /** ISO 8601 UTC timestamp of the confirmation. */
  ts: string;
}

/**
 * `route/updated` (E04-T4, extended E06-T3): the navigation switched onto a
 * freshly computed route. `reason: 'reroute'` is a confirmed-deviation
 * auto-reroute (E04-T4); `reason: 'profile_change'` is the E06-T3 profile-
 * change-during-navigation coupling (either UI-confirmed or headless auto-yes).
 */
export interface RouteUpdatedPayload {
  reason: 'reroute' | 'profile_change';
  /** Id of the new (cached) route now being navigated. */
  route_id: string;
  /**
   * E06-T3 warning-banner input: present ONLY for `reason: 'profile_change'`
   * when the new route's `duration_s` exceeds the replaced route's by more
   * than 15% (docs/03 §2 "Warnbanner falls neue Route deutlich länger").
   * Rounded percentage, e.g. `23` for +23%. The reroute is applied regardless
   * -- this is advisory, never a block.
   */
  duration_warning_pct?: number;
}

/**
 * `event/profile_changed` (E06-T1, consumed by E06-T3): published whenever
 * `PUT /profiles/{id}/activate` switches the single active profile -- fired
 * from `ProfileService#onProfileChanged`, regardless of whether a navigation
 * is active. `NavigationService` is the only current subscriber (couples it
 * to a reroute decision while `navigating`/`paused`); the WS bridge also fans
 * it straight out to any connected UI (e.g. the profile chip / list refresh).
 */
export interface ProfileChangedPayload {
  id: string;
  name: string;
}

/**
 * `event/profile_change_pending` (E06-T3): published INSTEAD OF an immediate
 * reroute when the active profile changes while `navigating`/`paused` AND at
 * least one UI (WS) client is connected -- the confirmation-banner trigger
 * ("Mit '‹name›' neu berechnen?"). Carries both the new and the PREVIOUS
 * profile so the UI's "Abbrechen" action can reactivate the previous one
 * without any extra round-trip to look it up.
 */
export interface ProfileChangePendingPayload {
  profile_id: string;
  profile_name: string;
  previous_profile_id: string;
  previous_profile_name: string;
}

/**
 * `event/reroute_loop` (E04-T4, W-05): three reroutes clustered within ~200 m in
 * 5 min — auto-rerouting that spot is disabled and the UI offers the E03-T4
 * "avoid this segment" action instead.
 */
export interface RerouteLoopPayload {
  suggestion: 'avoid_segment';
  /** The looping spot (centre of the clustered deviations). */
  at: LatLng;
  /** ISO 8601 UTC timestamp. */
  ts: string;
}

/**
 * `event/reroute_failed` (E04-T4): the reroute request could not be computed
 * (Valhalla down / no route). Navigation KEEPS the old route; a retry is
 * scheduled `retry_in_ms` from now.
 */
export interface RerouteFailedPayload {
  /** Human-readable failure reason (never silently swallowed). */
  reason: string;
  /** ISO 8601 UTC timestamp of the failure. */
  ts: string;
  /** Milliseconds until the scheduled retry. */
  retry_in_ms: number;
}

/** Maps each known topic to its payload type. */
export interface BusPayloadMap {
  'pos/update': Position;
  'pos/extrapolated': ExtrapolatedPositionPayload;
  'event/gps_lost': GpsLostPayload;
  'event/gps_source_changed': GpsSourceChangedPayload;
  'system/health': SystemHealthPayload;
  'nav/state': NavState;
  'nav/instruction': NavInstructionPayload;
  'event/arrived': ArrivedPayload;
  'event/nav_recovered_route_available': NavRecoveredRoutePayload;
  'route/deviation': RouteDeviationPayload;
  'route/updated': RouteUpdatedPayload;
  'event/reroute_loop': RerouteLoopPayload;
  'event/reroute_failed': RerouteFailedPayload;
  'event/profile_changed': ProfileChangedPayload;
  'event/profile_change_pending': ProfileChangePendingPayload;
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
  // Every published `nav/state` is schema-checked (E04-T1): a malformed
  // navigation state is a programming bug and must never reach a subscriber.
  'nav/state': (data: unknown): boolean => validateNavState(data),
  // Same rationale for `nav/instruction` (E04-T3): a malformed announcement
  // must never reach a WS/MQTT subscriber.
  'nav/instruction': (data: unknown): boolean => validateNavInstruction(data),
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
