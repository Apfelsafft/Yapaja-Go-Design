/**
 * `/ws/v1` WebSocket bridge: fans out EventBus topics to subscribed clients.
 * See docs/03-api-spec.md §3.
 *
 * Client -> Server: `{type:'subscribe', topics:[...]}`, `{type:'ping'}`.
 * Server -> Client: `{topic, payload, ts}` for subscribed topics, `{type:'pong'}`.
 */

import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import fastifyWebsocket from '@fastify/websocket';
import type { WebSocket, RawData } from 'ws';
import type { EventBus } from './index.js';

export interface BusWebsocketPluginOptions {
  bus: EventBus;
  path?: string;
}

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
  const { bus } = opts;

  fastify.get(path, { websocket: true }, (socket: WebSocket) => {
    // Unsubscribe functions for the client's current topic subscriptions.
    let unsubscribers: Array<() => void> = [];

    const send = (data: unknown): void => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(data));
      }
    };

    const applySubscriptions = (topics: string[]): void => {
      for (const unsub of unsubscribers) unsub();
      unsubscribers = topics.map((topic) =>
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
