/* eslint-disable no-undef -- setTimeout/clearTimeout/Buffer are standard
 * Node globals (typed via @types/node); the shared eslint config's `globals`
 * list predates this backend module. Same justification as
 * position/service.ts and position/gpsd/index.ts. */

/**
 * MqttBridge (E08-T1, docs/03 §4 + Wargame W-06): mirrors the internal event
 * bus to MQTT for Home Assistant and accepts `yapaja/cmd/*` commands back.
 *
 * Connection lifecycle mirrors `position/gpsd/index.ts`'s `GpsdSource`
 * (same "own connect(), reconnect via scheduleReconnect() with doubling
 * backoff reset on success" shape), adapted for mqtt.js:
 *  - `reconnectPeriod: 0` disables mqtt.js's OWN fixed-interval reconnect so
 *    this class fully owns the schedule (W-06: 1s -> 2s -> ... capped at
 *    60s, reset to 1s on the next successful connect).
 *  - LWT (`will`): `{prefix}/status` -> `offline`, retained, set on every
 *    connection attempt so the broker holds it for as long as the bridge is
 *    disconnected (whether that's the very first attempt or any reconnect).
 *  - On every successful `connect` (initial OR reconnect): publish
 *    `{prefix}/status` -> `online` retained, then FRESH-republish every
 *    currently-known state topic (`this.lastKnown`) -- never an event
 *    replay/backlog, just whatever the bus's live state is AT THAT MOMENT.
 *    This is what keeps a retained topic from going stale after an outage:
 *    while disconnected, the bus keeps running (NavigationService etc. don't
 *    know or care whether MQTT is up) and `this.lastKnown` keeps tracking
 *    the latest value of every mapped topic regardless of connectivity.
 *
 * Never throws out of the constructor or any bus/MQTT callback -- a broker
 * that's unreachable, misconfigured, or that goes away mid-session is an
 * expected, non-fatal condition (docs/03 §4 acceptance #4: "App bleibt ohne
 * Broker voll funktional"); every failure is logged (pino) and swallowed.
 */
import { connect as mqttConnect, type IClientOptions, type MqttClient } from 'mqtt';
import type { Favorite, NavInstructionPayload, NavState, Position, VehicleProfile } from '@yapaja/shared';
import type { EventBus, ExtrapolatedPositionPayload } from '../bus/index.js';
import type { NavigationService, ActiveProfileLookup, RerouteProvider, RouteProvider } from '../navigation/service.js';
import {
  resolveDestinationAndRoute,
  isDestinationError,
  type DestinationSearchProvider,
} from '../navigation/destinationResolver.js';
import { isNavigationError } from '../navigation/errors.js';
import { isRoutingError } from '../routing/errors.js';
import { isRealPosition } from './position.js';
import { PositionPublishThrottle } from './rateThrottle.js';
import {
  buildAltitudePayload,
  buildDestinationPayload,
  buildEtaPayload,
  buildInstructionPayload,
  buildRouteSummaryPayload,
  buildSpeedPayload,
} from './mapping.js';
import {
  parseDestinationCommand,
  parseFavoriteCommand,
  parseNavigationCommand,
  parseProfileCommand,
  type NavigationCommandAction,
} from './commands.js';

const DEFAULT_PREFIX = 'yapaja';
const DEFAULT_MIN_BACKOFF_MS = 1000;
const DEFAULT_MAX_BACKOFF_MS = 60_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

/** Just the profile operations the bridge needs; `ProfileService` satisfies
 *  it (it already exposes exactly this shape). */
export interface MqttProfileLookup {
  getById(id: string): VehicleProfile | null;
  getAll(): VehicleProfile[];
  activate(id: string): VehicleProfile;
}

/** Just the favorite lookup the bridge needs; `FavoriteService` satisfies it. */
export interface MqttFavoriteLookup {
  getAll(): Favorite[];
}

export interface MqttBridgeLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

const noopLogger: MqttBridgeLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

export interface MqttReconnectOptions {
  /** Initial/minimum backoff, ms. Default 1000 (W-06: "1s"). */
  minMs?: number;
  /** Backoff cap, ms. Default 60000 (W-06: "60s"). */
  maxMs?: number;
}

export interface MqttBridgeOptions {
  bus: EventBus;
  brokerUrl: string;
  username?: string;
  password?: string;
  /** Default `'yapaja'`. */
  prefix?: string;

  navigationService: NavigationService;
  profileService: MqttProfileLookup;
  favoriteService: MqttFavoriteLookup;
  /** Route lookup for `yapaja/route/summary` (RoutingService satisfies it). */
  routeProvider?: RouteProvider;
  /** Reroute/route-compute entry point for `cmd/destination` + `cmd/favorite`
   *  (the SAME shared RoutingService instance production wires everywhere else). */
  rerouteProvider?: RerouteProvider;
  /** Active-profile lookup for `cmd/destination`'s profile default (ProfileService satisfies it). */
  profileProvider?: ActiveProfileLookup;
  /** Geocoder for `cmd/destination`'s `query` field (SearchService satisfies it). */
  searchProvider?: DestinationSearchProvider;

  logger?: MqttBridgeLogger;
  reconnect?: MqttReconnectOptions;
  connectTimeoutMs?: number;
  /** Injectable mqtt.js `connect` for tests (points at an in-process aedes broker). */
  connectFn?: (url: string, opts: IClientOptions) => MqttClient;
}

/**
 * MQTT bridge (E08-T1). Construct only when a broker is configured
 * (`resolveMqttConfig` returning non-null, see `config.ts`) -- `index.ts`
 * skips construction entirely otherwise, which is how acceptance criterion 4
 * ("no broker configured -> Core runs normally") is satisfied: there is
 * simply no bridge instance in that case.
 */
export class MqttBridge {
  private readonly bus: EventBus;
  private readonly brokerUrl: string;
  private readonly username?: string;
  private readonly password?: string;
  private readonly prefix: string;
  private readonly logger: MqttBridgeLogger;
  private readonly minBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly connectTimeoutMs: number;
  private readonly connectFn: (url: string, opts: IClientOptions) => MqttClient;

  private readonly navigationService: NavigationService;
  private readonly profileService: MqttProfileLookup;
  private readonly favoriteService: MqttFavoriteLookup;
  private readonly routeProvider?: RouteProvider;
  private readonly destinationDeps: {
    navigationService: NavigationService;
    rerouteProvider?: RerouteProvider;
    profileProvider?: ActiveProfileLookup;
    searchProvider?: DestinationSearchProvider;
    logger: MqttBridgeLogger;
  };

  private client: MqttClient | null = null;
  private connected = false;
  private disposed = false;
  private backoffMs: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Latest known payload (already JSON/text-encoded) per RETAINED topic --
   *  updated by the bus subscriptions below regardless of MQTT connectivity,
   *  and fully republished on every (re)connect. Never holds `event/*`
   *  (transient, never retained/replayed). */
  private readonly lastKnown = new Map<string, string>();
  private readonly positionThrottle = new PositionPublishThrottle();
  private lastRouteId: string | null = null;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(opts: MqttBridgeOptions) {
    this.bus = opts.bus;
    this.brokerUrl = opts.brokerUrl;
    this.username = opts.username;
    this.password = opts.password;
    this.prefix = opts.prefix ?? DEFAULT_PREFIX;
    this.logger = opts.logger ?? noopLogger;
    this.minBackoffMs = opts.reconnect?.minMs ?? DEFAULT_MIN_BACKOFF_MS;
    this.maxBackoffMs = opts.reconnect?.maxMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.connectFn = opts.connectFn ?? mqttConnect;
    this.backoffMs = this.minBackoffMs;

    this.navigationService = opts.navigationService;
    this.profileService = opts.profileService;
    this.favoriteService = opts.favoriteService;
    this.routeProvider = opts.routeProvider;
    this.destinationDeps = {
      navigationService: opts.navigationService,
      rerouteProvider: opts.rerouteProvider,
      profileProvider: opts.profileProvider,
      searchProvider: opts.searchProvider,
      logger: this.logger,
    };

    this.subscribeBus();
    this.connect();
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Health-service entry (`GET /api/v1/health`'s `services.mqtt`, mirroring
   *  the `services: { db: ... }` pattern already used there). */
  getHealthStatus(): 'ok' | 'down' {
    return this.connected ? 'ok' : 'down';
  }

  /** Unsubscribes from the bus, clears timers, and disconnects the MQTT
   *  client (publishing `{prefix}/status` -> `offline` retained first when
   *  currently connected, so a graceful Core shutdown shows "offline" just
   *  like an ungraceful one does via the LWT). Safe to call repeatedly. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers.length = 0;

    const client = this.client;
    this.client = null;
    if (!client) return;
    client.removeAllListeners();
    // mqtt.js/Node EventEmitter semantics: an 'error' event with ZERO
    // listeners throws an UNCAUGHT exception, not a swallowed one -- and the
    // publish+end below can itself hit a write error (e.g. the broker
    // connection already died from the other side). Re-attach a listener
    // BEFORE doing anything else so a late write failure during shutdown is
    // logged, never a crash.
    client.on('error', (err) => {
      this.logger.warn('mqtt: error during dispose', { error: err.message });
    });
    const wasConnected = this.connected;
    this.connected = false;
    try {
      if (wasConnected) {
        client.publish(`${this.prefix}/status`, 'offline', { qos: 1, retain: true }, () => {
          client.end(true);
        });
      } else {
        client.end(true);
      }
    } catch (err) {
      this.logger.warn('mqtt: error during dispose', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // --- Connection lifecycle -------------------------------------------------

  private connect(): void {
    if (this.disposed) return;

    let client: MqttClient;
    try {
      client = this.connectFn(this.brokerUrl, {
        username: this.username,
        password: this.password,
        reconnectPeriod: 0, // W-06: we own the backoff schedule, not mqtt.js.
        connectTimeout: this.connectTimeoutMs,
        will: {
          topic: `${this.prefix}/status`,
          payload: 'offline',
          qos: 1,
          retain: true,
        },
      });
    } catch (err) {
      this.logger.error('mqtt: failed to create client', {
        error: err instanceof Error ? err.message : String(err),
      });
      this.scheduleReconnect();
      return;
    }
    this.client = client;

    client.on('connect', () => this.handleConnect());
    client.on('message', (topic: string, payload: Buffer) => {
      this.handleMessage(topic, payload).catch((err: unknown) => {
        this.logger.error('mqtt: unexpected error handling message', {
          topic,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });
    client.on('error', (err) => {
      this.logger.warn('mqtt: client error', { error: err.message });
    });
    client.on('close', () => this.handleClose());
  }

  private handleConnect(): void {
    this.connected = true;
    this.backoffMs = this.minBackoffMs;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.logger.info('mqtt: connected', { brokerUrl: this.brokerUrl, prefix: this.prefix });

    // Fresh state, never a backlog replay (W-06): publish `online`, then
    // whatever the bus's CURRENT state is for every topic seen so far.
    this.publishRetained(`${this.prefix}/status`, 'online');
    this.republishAllRetained();

    this.client?.subscribe(`${this.prefix}/cmd/#`, { qos: 1 }, (err) => {
      if (err) {
        this.logger.warn('mqtt: cmd subscribe failed', { error: err.message });
      }
    });
  }

  private handleClose(): void {
    const wasConnected = this.connected;
    this.connected = false;
    this.client = null;
    if (wasConnected) {
      this.logger.warn('mqtt: connection closed, will reconnect', { prefix: this.prefix });
    }
    if (this.disposed) return;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.maxBackoffMs, this.backoffMs * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  // --- Bus -> MQTT (state mirroring) ----------------------------------------

  private subscribeBus(): void {
    this.unsubscribers.push(
      this.bus.subscribe('pos/update', (pos) => this.onPositionUpdate(pos)),
      this.bus.subscribe('nav/state', (state) => this.onNavState(state)),
      this.bus.subscribe('nav/instruction', (payload) => this.onNavInstruction(payload)),
      this.bus.subscribe('route/deviation', (payload) => this.publishEvent('deviation', payload)),
      this.bus.subscribe('event/arrived', (payload) => this.publishEvent('arrived', payload)),
      this.bus.subscribe('event/gps_lost', (payload) => this.publishEvent('gps_lost', payload)),
      this.bus.subscribe('event/gps_lost_paused', (payload) =>
        this.publishEvent('gps_lost_paused', payload),
      ),
      this.bus.subscribe('event/reroute_failed', (payload) => this.publishEvent('reroute_failed', payload)),
      this.bus.subscribe('event/reroute_loop', (payload) => this.publishEvent('reroute_loop', payload)),
    );
  }

  private onPositionUpdate(pos: Position | ExtrapolatedPositionPayload): void {
    // Defense-in-depth (see `position.ts`'s doc comment): only 'pos/update'
    // is subscribed above, so this should always be true.
    if (!isRealPosition(pos)) return;
    if (!this.positionThrottle.shouldPublish(pos.speed, Date.now())) return;
    this.publishRetained(`${this.prefix}/position`, pos);
  }

  private onNavState(state: NavState): void {
    this.publishRetained(`${this.prefix}/nav/state`, state.status);
    this.publishRetained(`${this.prefix}/nav/eta`, buildEtaPayload(state));
    this.publishRetained(`${this.prefix}/nav/speed`, buildSpeedPayload(state));
    this.publishRetained(`${this.prefix}/nav/altitude`, buildAltitudePayload(state));
    this.publishRetained(`${this.prefix}/nav/destination`, buildDestinationPayload(state));
    this.maybePublishRouteSummary(state);
  }

  /** `yapaja/route/summary`, published once per NEW route_id (docs/03 §4:
   *  "bei neuer Route") -- fires for both a fresh `start()` and any reroute,
   *  since both surface as a route_id change on `nav/state`. */
  private maybePublishRouteSummary(state: NavState): void {
    if (state.route_id === this.lastRouteId) return;
    this.lastRouteId = state.route_id;
    if (!state.route_id || !this.routeProvider) return;
    const route = this.routeProvider.getCachedRoute(state.route_id);
    if (!route) return;
    this.publishRetained(`${this.prefix}/route/summary`, buildRouteSummaryPayload(route));
  }

  private onNavInstruction(payload: NavInstructionPayload): void {
    this.publishRetained(`${this.prefix}/nav/instruction`, buildInstructionPayload(payload));
  }

  /** `yapaja/event/#` -- transient, retain ✘ (docs/03 §4), never tracked in `lastKnown`. */
  private publishEvent(name: string, payload: unknown): void {
    this.safePublish(`${this.prefix}/event/${name}`, JSON.stringify(payload), {
      retain: false,
      qos: 1,
    });
  }

  private publishRetained(topic: string, payload: unknown): void {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.lastKnown.set(topic, text);
    this.safePublish(topic, text, { retain: true, qos: 1 });
  }

  private republishAllRetained(): void {
    for (const [topic, payload] of this.lastKnown) {
      this.safePublish(topic, payload, { retain: true, qos: 1 });
    }
  }

  private safePublish(topic: string, payload: string, opts: { retain: boolean; qos: 0 | 1 | 2 }): void {
    const client = this.client;
    if (!client) return;
    try {
      client.publish(topic, payload, opts, (err) => {
        if (err) this.logger.warn('mqtt: publish failed', { topic, error: err.message });
      });
    } catch (err) {
      this.logger.warn('mqtt: publish threw', {
        topic,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // --- MQTT -> Core (commands) -----------------------------------------------

  private async handleMessage(topic: string, payload: Buffer): Promise<void> {
    const cmdPrefix = `${this.prefix}/cmd/`;
    if (!topic.startsWith(cmdPrefix)) return;
    const cmdName = topic.slice(cmdPrefix.length);
    await this.handleCommand(cmdName, payload);
  }

  private async handleCommand(cmdName: string, raw: Buffer): Promise<void> {
    let requestId: string | undefined;
    try {
      switch (cmdName) {
        case 'destination': {
          const parsed = parseDestinationCommand(raw);
          if (!parsed.ok) throw new Error(parsed.error);
          requestId = parsed.value.requestId;
          await resolveDestinationAndRoute(this.destinationDeps, {
            latlng: parsed.value.latlng,
            query: parsed.value.query,
            autostart: parsed.value.autostart,
          });
          break;
        }
        case 'navigation': {
          const parsed = parseNavigationCommand(raw);
          if (!parsed.ok) throw new Error(parsed.error);
          requestId = parsed.value.requestId;
          this.runNavigationAction(parsed.value.action);
          break;
        }
        case 'profile': {
          const parsed = parseProfileCommand(raw);
          if (!parsed.ok) throw new Error(parsed.error);
          requestId = parsed.value.requestId;
          this.runProfileCommand(parsed.value.id, parsed.value.name);
          break;
        }
        case 'favorite': {
          const parsed = parseFavoriteCommand(raw);
          if (!parsed.ok) throw new Error(parsed.error);
          requestId = parsed.value.requestId;
          await this.runFavoriteCommand(parsed.value.name);
          break;
        }
        default:
          this.logger.warn('mqtt: unknown cmd subtopic', { cmdName });
          return;
      }
      this.publishResult(cmdName, true, undefined, requestId);
    } catch (err) {
      const message = errorMessage(err);
      this.logger.warn('mqtt: command failed', { cmd: cmdName, error: message });
      this.publishResult(cmdName, false, message, requestId);
    }
  }

  /**
   * `"start"` has no route/destination of its own to attach to (docs/03 §4
   * only specifies the bare action) -- interpreted here as "start the
   * currently-idle, still-recoverable route" (the same W-19
   * `getRecoverableRoute()` a reload-recovery prompt would offer), which is
   * the only well-defined "start with zero further input" case the existing
   * service surface supports. `cmd/destination` / `cmd/favorite` (with
   * `autostart: true`, the favorite path always uses it) cover "start
   * navigating to somewhere new".
   */
  private runNavigationAction(action: NavigationCommandAction): void {
    switch (action) {
      case 'pause':
        this.navigationService.pause();
        return;
      case 'resume':
        this.navigationService.resume();
        return;
      case 'stop':
        this.navigationService.stop();
        return;
      case 'start': {
        const recovered = this.navigationService.getRecoverableRoute();
        if (!recovered) {
          throw new Error(
            'No prepared/recoverable route to start -- use cmd/destination or cmd/favorite instead',
          );
        }
        this.navigationService.start({
          route_id: recovered.route_id,
          destination: recovered.destination,
        });
        return;
      }
    }
  }

  private runProfileCommand(id?: string, name?: string): void {
    const profile = id
      ? this.profileService.getById(id)
      : (this.profileService.getAll().find((p) => p.name === name) ?? null);
    if (!profile) {
      throw new Error(id ? `Profile "${id}" not found` : `Profile "${name}" not found`);
    }
    this.profileService.activate(profile.id);
  }

  private async runFavoriteCommand(name: string): Promise<void> {
    const favorite = this.favoriteService.getAll().find((f) => f.name === name);
    if (!favorite) {
      throw new Error(`Favorite "${name}" not found`);
    }
    // "Route zu benanntem Favoriten starten" (docs/03 §4) -- always autostart,
    // unlike cmd/destination where it's opt-in.
    await resolveDestinationAndRoute(this.destinationDeps, {
      latlng: favorite.latlng,
      autostart: true,
    });
  }

  private publishResult(cmd: string, ok: boolean, error?: string, requestId?: string): void {
    const payload: Record<string, unknown> = { cmd, ok };
    if (error !== undefined) payload.error = error;
    if (requestId !== undefined) payload.request_id = requestId;
    this.safePublish(`${this.prefix}/cmd/result`, JSON.stringify(payload), {
      retain: false,
      qos: 1,
    });
  }
}

function errorMessage(err: unknown): string {
  if (isDestinationError(err) || isRoutingError(err) || isNavigationError(err)) {
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
