/**
 * Integration tests for the /ws/v1 WebSocket bridge, using
 * @fastify/websocket's `injectWS` test helper (no real network port needed).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { setTimeout } from 'node:timers';
import { EventBus } from './index.js';
import { busWebsocketPlugin } from './ws.js';

async function waitForMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('/ws/v1 bus bridge', () => {
  let fastify: FastifyInstance;
  let bus: EventBus;

  beforeEach(async () => {
    fastify = Fastify();
    bus = new EventBus({ isProduction: false });
    await fastify.register(busWebsocketPlugin, { bus });
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  it('delivers only subscribed topics to the client', async () => {
    const socket = await fastify.injectWS('/ws/v1');

    socket.send(JSON.stringify({ type: 'subscribe', topics: ['pos/*'] }));
    // Give the server a tick to process the subscribe message.
    await delay(20);

    const messagePromise = waitForMessage(socket);
    bus.publish('event/gps_lost', { lastSource: null }); // not subscribed -> must NOT arrive
    bus.publish('pos/update', {
      lat: 52.5,
      lon: 13.4,
      alt: 30,
      speed: 5,
      heading: 10,
      accuracy: 3,
      source: 'gpsd',
      fix: '3d',
      ts: new Date().toISOString(),
    });

    const received = (await messagePromise) as { topic: string; payload: unknown; ts: string };
    expect(received.topic).toBe('pos/update');
    expect(received.ts).toBeDefined();

    socket.terminate();
  });

  it('does not deliver a topic the client never subscribed to', async () => {
    const socket = await fastify.injectWS('/ws/v1');
    socket.send(JSON.stringify({ type: 'subscribe', topics: ['event/gps_lost'] }));
    await delay(20);

    let receivedAnything = false;
    socket.on('message', () => {
      receivedAnything = true;
    });

    bus.publish('system/health', { status: 'ok', services: {} });
    await delay(20);

    expect(receivedAnything).toBe(false);
    socket.terminate();
  });

  it('responds to ping with pong', async () => {
    const socket = await fastify.injectWS('/ws/v1');
    const messagePromise = waitForMessage(socket);

    socket.send(JSON.stringify({ type: 'ping' }));

    const received = await messagePromise;
    expect(received).toEqual({ type: 'pong' });

    socket.terminate();
  });

  it('cleans up bus subscriptions on disconnect (no leak)', async () => {
    const socket = await fastify.injectWS('/ws/v1');
    socket.send(JSON.stringify({ type: 'subscribe', topics: ['pos/*', 'event/*'] }));
    await delay(20);

    expect(bus.subscriberCount).toBe(2);

    socket.terminate();
    await delay(50);

    expect(bus.subscriberCount).toBe(0);
  });

  it('replaces the subscription set on a second subscribe message', async () => {
    const socket = await fastify.injectWS('/ws/v1');
    socket.send(JSON.stringify({ type: 'subscribe', topics: ['pos/*'] }));
    await delay(20);
    expect(bus.subscriberCount).toBe(1);

    socket.send(JSON.stringify({ type: 'subscribe', topics: ['event/*', 'system/health'] }));
    await delay(20);
    expect(bus.subscriberCount).toBe(2);

    socket.terminate();
    await delay(50);
    expect(bus.subscriberCount).toBe(0);
  });
});
