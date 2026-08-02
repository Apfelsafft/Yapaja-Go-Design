/**
 * `/ws/v1` WebSocket bridge: fans out EventBus topics to subscribed clients.
 * See docs/03-api-spec.md §3.
 *
 * Client -> Server: `{type:'subscribe', topics:[...]}`, `{type:'ping'}`.
 * Server -> Client: `{topic, payload, ts}` for subscribed topics, `{type:'pong'}`.
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import fastifyWebsocket from '@fastify/websocket';
import type { WebSocket, RawData } from 'ws';
import type { EventBus } from './index.js';
import { AuthGuard, extractWsToken } from '../auth/authGuard.js';

/**
 * Tracks how many `/ws/v1` clients are currently connected (E06-T3): the
 * "is a UI client connected?" signal `NavigationService` needs to decide
 * between showing the profile-change confirmation banner and auto-rerouting
 * headless. Deliberately minimal -- a plain counter, not a `Set<WebSocket>`,
 * since nothing needs to iterate or address individual sockets here.
 */
export class WsClientRegistry {
  private count = 0;

  increment(): void {
    this.count += 1;
  }

  decrement(): void {
    this.count = Math.max(0, this.count - 1);
  }

  /** Current number of open `/ws/v1` connections. */
  get connectedCount(): number {
    return this.count;
  }

  /** Structural `ClientPresence` (see `navigation/service.ts`): any client connected right now? */
  hasConnectedClients(): boolean {
    return this.count > 0;
  }
}

/**
 * E09-T3: the add-on-token principal on the WS side. Structural (no import
 * edge from `bus/` into `addons/`); `AddonAuthService` satisfies it.
 */
export interface WsAddonAuthHook {
  authenticate(token: string | null | undefined): WsAddonPrincipal | null;
  authorizeTopic(
    principal: WsAddonPrincipal,
    pattern: string,
  ): { allowed: true } | { allowed: false; code: string; message: string; requiredScope?: string };
}

export interface WsAddonPrincipal {
  addonId: string;
  scopes: ReadonlySet<string>;
  netFetchDeclarations: readonly string[];
}

export interface BusWebsocketPluginOptions {
  bus: EventBus;
  path?: string;
  /** E06-T3: connection-count tracker; omit to skip tracking (e.g. tests that don't need it). */
  registry?: WsClientRegistry;
  /**
   * E08-T3: token auth for the WS upgrade. When the guard reports auth is
   * enforced, a `?token=`/`token`-cookie is required and validated in
   * constant time; an unauthorized upgrade is closed with WS code 1008
   * (policy violation). Omit to skip WS auth entirely (e.g. isolated tests).
   */
  authGuard?: AuthGuard;
  /**
   * E09-T3: scoped add-on tokens. Checked BEFORE `authGuard` (and regardless
   * of whether the guard is enforced): a connection presenting an add-on
   * token is accepted, but every `subscribe` topic pattern is then checked
   * against that add-on's granted scopes -- a pattern outside them is
   * refused, logged, and NOT subscribed, while the rest of the batch still
   * applies. Omit to disable add-on WS auth.
   */
  addonAuth?: WsAddonAuthHook;
}

/** WS close code for a policy violation (RFC 6455) -- used for auth rejection. */
const WS_POLICY_VIOLATION = 1008;

interface ClientMessage {
  type?: string;
  topics?: unknown;
}

function parseClientMessage(raw: RawData): ClientMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw.toString());
    if (parsed && typeof parsed === 'object') {
      return parsed as ClientMessage;
    }
    return null;
  } catch {
    return null;
  }
}

const busWebsocketPluginImpl: FastifyPluginAsync<BusWebsocketPluginOptions> = async (
  fastify,
  opts,
) => {
  await fastify.register(fastifyWebsocket);

  const path = opts.path ?? '/ws/v1';
  const { bus, registry, authGuard, addonAuth } = opts;

  fastify.get(path, { websocket: true }, (socket: WebSocket, request: FastifyRequest) => {
    const presentedToken = extractWsToken(request.query, request.headers.cookie);

    // E09-T3: is this an ADD-ON token? Resolved first and unconditionally --
    // an add-on connection is scope-restricted even on a token-less (open
    // posture) install, exactly like the REST side.
    const addonPrincipal = addonAuth ? addonAuth.authenticate(presentedToken) : null;

    // E08-T3: authenticate the upgrade. A browser can't send an
    // `Authorization` header on a WS handshake, so the token arrives via the
    // `?token=` query param or a `token` cookie. Same "enforced only when a
    // token is configured (and not in ingress mode)" rule as the REST guard.
    if (!addonPrincipal && authGuard?.isEnforced()) {
      if (!authGuard.verify(presentedToken)) {
        // Reject the upgrade: close immediately, before any subscription is
        // set up and before the registry is incremented.
        socket.close(WS_POLICY_VIOLATION, 'unauthorized');
        return;
      }
    }

    registry?.increment();
    // Unsubscribe functions for the client's current topic subscriptions.
    let unsubscribers: Array<() => void> = [];

    const send = (data: unknown): void => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(data));
      }
    };

    const applySubscriptions = (topics: string[]): void => {
      for (const unsub of unsubscribers) unsub();
      // E09-T3: an add-on connection may only subscribe to patterns its
      // granted scopes cover (`addons/scopeMatrix.ts#authorizeAddonTopic`).
      // Refused patterns are reported back + logged and simply never
      // subscribed -- the socket stays open so a partially-scoped add-on
      // keeps working for the topics it IS allowed.
      const permitted = addonPrincipal
        ? topics.filter((topic) => {
            const decision = addonAuth?.authorizeTopic(addonPrincipal, topic);
            if (decision && !decision.allowed) {
              fastify.log.warn(
                {
                  addon_id: addonPrincipal.addonId,
                  topic,
                  code: decision.code,
                  required_scope: decision.requiredScope,
                },
                'add-on WS subscription refused by the scope matrix',
              );
              send({
                type: 'error',
                code: decision.code,
                topic,
                required_scope: decision.requiredScope,
                message: decision.message,
              });
              return false;
            }
            return true;
          })
        : topics;
      unsubscribers = permitted.map((topic) =>
        bus.subscribe(topic, (payload, actualTopic) => {
          send({ topic: actualTopic, payload, ts: new Date().toISOString() });
        }),
      );
    };

    socket.on('message', (raw: RawData) => {
      const msg = parseClientMessage(raw);
      if (!msg) return;

      if (msg.type === 'subscribe' && Array.isArray(msg.topics)) {
        const topics = msg.topics.filter((t): t is string => typeof t === 'string');
        applySubscriptions(topics);
      } else if (msg.type === 'ping') {
        send({ type: 'pong' });
      }
    });

    socket.on('close', () => {
      for (const unsub of unsubscribers) unsub();
      unsubscribers = [];
      registry?.decrement();
    });
  });
};

// Wrapped with fastify-plugin so the @fastify/websocket decorations
// (injectWS, websocketServer) it registers are visible on the parent
// instance instead of being trapped in this plugin's own encapsulation
// context -- needed for tests using `fastify.injectWS()` and for other
// future plugins (MQTT bridge, plugin host) that will want the same `ws`
// route registered once at the root.
export const busWebsocketPlugin = fp(busWebsocketPluginImpl, { name: 'bus-websocket-plugin' });
