/**
 * Tests for GpsdSource:
 *  - real-socket integration against a minimal in-process gpsd TCP fixture
 *    server (TPV/SKY streaming incl. split/merged lines, mode 0/1, guard
 *    wiring, reconnect end-to-end, dispose leak-freedom);
 *  - deterministic reconnect-backoff timing against an injected fake socket
 *    factory + fake timers (no real network involved).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as net from 'node:net';
import { EventEmitter } from 'node:events';
import { setTimeout } from 'node:timers';
import { checkPosition, validatePosition, type Position } from '@yapaja/shared';
import { EventBus } from '../../bus/index.js';
import { PositionService } from '../service.js';
import { GpsdSource } from './index.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tpvLine(fields: Record<string, unknown>): string {
  return JSON.stringify({ class: 'TPV', ...fields }) + '\n';
}

function skyLine(satelliteCount: number): string {
  return JSON.stringify({ class: 'SKY', satellites: Array.from({ length: satelliteCount }, () => ({})) }) + '\n';
}

/** Waits until exactly `n` WATCH handshakes have been received server-side --
 * a reliable proxy for "the client's Nth connection has reached its
 * 'connected' state and sent WATCH", since `getStatus().connection` and the
 * server's 'connection' event fire on two different sockets and can race
 * against each other, but the WATCH bytes only exist after the client-side
 * connect handler has actually run. */
async function waitForHandshakeCount(mock: MockGpsdServer, n: number): Promise<void> {
  await vi.waitFor(() => {
    const count = (mock.received.join('').match(/\?WATCH=/g) ?? []).length;
    expect(count).toBe(n);
  });
}

/** Minimal in-process gpsd fixture server: accepts TCP connections, records
 * the WATCH handshake, and lets the test stream arbitrary raw bytes to the
 * most recently accepted socket (so tests can control exact chunk boundaries). */
class MockGpsdServer {
  readonly server: net.Server;
  readonly connections: net.Socket[] = [];
  readonly received: string[] = [];
  private connectionResolvers: Array<() => void> = [];

  private constructor(server: net.Server) {
    this.server = server;
  }

  static async start(): Promise<MockGpsdServer> {
    const server = net.createServer();
    const mock = new MockGpsdServer(server);
    server.on('connection', (socket) => {
      mock.connections.push(socket);
      socket.on('data', (chunk) => mock.received.push(chunk.toString('utf-8')));
      const resolver = mock.connectionResolvers.shift();
      resolver?.();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return mock;
  }

  get port(): number {
    return (this.server.address() as net.AddressInfo).port;
  }

  /** Resolves once at least one client connection has been accepted. */
  waitForConnection(): Promise<void> {
    if (this.connections.length > 0) return Promise.resolve();
    return new Promise((resolve) => this.connectionResolvers.push(resolve));
  }

  /** Resolves on the *next* accepted connection, regardless of how many came before. */
  waitForNextConnection(): Promise<void> {
    return new Promise((resolve) => this.connectionResolvers.push(resolve));
  }

  latestSocket(): net.Socket {
    const socket = this.connections[this.connections.length - 1];
    if (!socket) throw new Error('no connection accepted yet');
    return socket;
  }

  write(data: string): void {
    this.latestSocket().write(data);
  }

  async close(): Promise<void> {
    for (const socket of this.connections) socket.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

describe('GpsdSource (real socket integration)', () => {
  let bus: EventBus;
  let service: PositionService;
  let mockServer: MockGpsdServer;
  let gpsdSource: GpsdSource | null;

  beforeEach(async () => {
    bus = new EventBus({ isProduction: false });
    service = new PositionService({ bus, checkIntervalMs: 50, rateHz: 5 });
    mockServer = await MockGpsdServer.start();
    gpsdSource = null;
  });

  afterEach(async () => {
    gpsdSource?.dispose();
    service.dispose();
    await mockServer.close();
  });

  function makeSource(overrides: Partial<ConstructorParameters<typeof GpsdSource>[0]> = {}): GpsdSource {
    gpsdSource = new GpsdSource({
      positionService: service,
      host: '127.0.0.1',
      port: mockServer.port,
      minBackoffMs: 20,
      maxBackoffMs: 100,
      connectTimeoutMs: 2000,
      ...overrides,
    });
    return gpsdSource;
  }

  it('sends the WATCH handshake right after connecting', async () => {
    const source = makeSource();
    source.start();
    await mockServer.waitForConnection();
    await vi.waitFor(() => {
      expect(mockServer.received.join('')).toContain('?WATCH={"enable":true,"json":true}');
    });
  });

  it('emits schema-valid pos/update fixes (source=gpsd) from a 3D TPV report', async () => {
    const received: Position[] = [];
    bus.subscribe('pos/update', (p) => received.push(p));

    const source = makeSource();
    source.start();
    await mockServer.waitForConnection();

    mockServer.write(
      tpvLine({
        mode: 3,
        lat: 52.5,
        lon: 13.4,
        altMSL: 40,
        speed: 12,
        track: 90,
        eph: 5,
        time: '2026-07-10T10:00:00.000Z',
      }),
    );

    await vi.waitFor(() => expect(received.length).toBe(1));
    const [pos] = received;
    expect(pos.source).toBe('gpsd');
    expect(pos.fix).toBe('3d');
    expect(pos.lat).toBe(52.5);
    expect(validatePosition(pos)).toBe(true);
    expect(checkPosition(pos).ok).toBe(true);
  });

  it('emits a 2D fix for mode 2', async () => {
    const received: Position[] = [];
    bus.subscribe('pos/update', (p) => received.push(p));
    const source = makeSource();
    source.start();
    await mockServer.waitForConnection();

    mockServer.write(tpvLine({ mode: 2, lat: 1, lon: 2, time: '2026-07-10T10:00:00.000Z' }));
    await vi.waitFor(() => expect(received.length).toBe(1));
    expect(received[0].fix).toBe('2d');
  });

  it('never publishes a position for mode 0 or mode 1 (no fix)', async () => {
    const received: Position[] = [];
    bus.subscribe('pos/update', (p) => received.push(p));
    const source = makeSource();
    source.start();
    await mockServer.waitForConnection();

    mockServer.write(tpvLine({ mode: 0, lat: 1, lon: 2 }));
    mockServer.write(tpvLine({ mode: 1, lat: 1, lon: 2 }));
    // A subsequent good fix proves the stream is otherwise alive.
    mockServer.write(tpvLine({ mode: 3, lat: 1, lon: 2, time: '2026-07-10T10:00:00.000Z' }));

    await vi.waitFor(() => expect(received.length).toBe(1));
    expect(received[0].fix).toBe('3d');
  });

  it('reassembles a TPV line split across multiple TCP writes', async () => {
    const received: Position[] = [];
    bus.subscribe('pos/update', (p) => received.push(p));
    const source = makeSource();
    source.start();
    await mockServer.waitForConnection();

    const full = tpvLine({ mode: 3, lat: 48.1, lon: 11.6, time: '2026-07-10T10:00:00.000Z' });
    const splitAt = Math.floor(full.length / 2);
    mockServer.write(full.slice(0, splitAt));
    await delay(15); // ensure two distinct TCP segments / 'data' events
    mockServer.write(full.slice(splitAt));

    await vi.waitFor(() => expect(received.length).toBe(1));
    expect(received[0].lat).toBe(48.1);
    expect(received[0].lon).toBe(11.6);
  });

  it('parses multiple JSON objects delivered in a single chunk', async () => {
    const received: Position[] = [];
    bus.subscribe('pos/update', (p) => received.push(p));
    const source = makeSource();
    source.start();
    await mockServer.waitForConnection();

    // The two TPV fixes are ~55m apart (well under the guard's 300 m/s jump
    // threshold even over the 5s gap) -- this test is about chunk framing,
    // not the guard, so the fixture must not trip jump rejection.
    const chunk =
      skyLine(7) +
      tpvLine({ mode: 3, lat: 52.5, lon: 13.4, time: '2026-07-10T10:00:00.000Z' }) +
      tpvLine({ mode: 3, lat: 52.5005, lon: 13.4, time: '2026-07-10T10:00:05.000Z' });
    mockServer.write(chunk);

    await vi.waitFor(() => expect(received.length).toBe(2));
    expect(received.map((p) => p.lat)).toEqual([52.5, 52.5005]);
    expect(source.getStatus().satellites).toBe(7);
  });

  it('recovers from a mid-stream disconnect: reconnects and resumes delivering fixes', async () => {
    const received: Position[] = [];
    bus.subscribe('pos/update', (p) => received.push(p));
    const source = makeSource();
    source.start();
    await mockServer.waitForConnection();

    await waitForHandshakeCount(mockServer, 1);
    mockServer.write(tpvLine({ mode: 3, lat: 1, lon: 1, time: '2026-07-10T10:00:00.000Z' }));
    await vi.waitFor(() => expect(received.length).toBe(1));
    expect(source.getStatus().connection).toBe('connected');

    // Register the "next connection" wait *before* triggering the drop, so a
    // fast reconnect (backoff starts at 20ms in this test) can't race ahead
    // of us and get missed. (We deliberately don't assert on the transient
    // 'disconnected' state in between -- with a 20ms backoff the source can
    // flip disconnected -> connecting -> connected faster than the poll
    // interval used to observe it, which would make that assertion flaky by
    // construction rather than actually verifying anything.)
    const reconnected = mockServer.waitForNextConnection();

    // Simulate the daemon/connection dropping.
    mockServer.latestSocket().destroy();

    // Reconnect (backoff starts at 20ms in this test).
    await reconnected;
    await waitForHandshakeCount(mockServer, 2);

    mockServer.write(tpvLine({ mode: 3, lat: 2, lon: 2, time: '2026-07-10T10:00:10.000Z' }));
    await vi.waitFor(() => expect(received.length).toBe(2));
    expect(source.getStatus().connection).toBe('connected');
  });

  it('guard integration: rejects a jump 3x then accepts the 4th as new baseline; accuracy>100 is still forwarded', async () => {
    const received: Position[] = [];
    bus.subscribe('pos/update', (p) => received.push(p));
    const source = makeSource();
    source.start();
    await mockServer.waitForConnection();

    // Baseline fix.
    mockServer.write(tpvLine({ mode: 3, lat: 52.5, lon: 13.4, time: '2026-07-10T10:00:00.000Z' }));
    await vi.waitFor(() => expect(received.length).toBe(1));

    // Three consecutive ~55km jumps, 1s apart -- each implies >>300 m/s, all rejected.
    mockServer.write(tpvLine({ mode: 3, lat: 52.5, lon: 13.9, time: '2026-07-10T10:00:01.000Z' }));
    mockServer.write(tpvLine({ mode: 3, lat: 52.5, lon: 13.9, time: '2026-07-10T10:00:02.000Z' }));
    mockServer.write(tpvLine({ mode: 3, lat: 52.5, lon: 13.9, time: '2026-07-10T10:00:03.000Z' }));
    // Give the (rejected) fixes time to be processed and confirm none arrived.
    await delay(50);
    expect(received.length).toBe(1);

    // 4th consecutive jump -- accepted as the new baseline (W-02).
    mockServer.write(
      tpvLine({
        mode: 3,
        lat: 52.5,
        lon: 13.9,
        eph: 150, // > 100m -> forwarded but flagged, never dropped
        time: '2026-07-10T10:00:04.000Z',
      }),
    );
    await vi.waitFor(() => expect(received.length).toBe(2));
    expect(received[1].lon).toBe(13.9);
    expect(received[1].accuracy).toBe(150);
    expect(checkPosition(received[1]).ok).toBe(true);
  });

  it('does not crash when a line is not valid JSON, and keeps processing subsequent lines', async () => {
    const received: Position[] = [];
    bus.subscribe('pos/update', (p) => received.push(p));
    const source = makeSource();
    source.start();
    await mockServer.waitForConnection();

    mockServer.write('not-json-at-all\n');
    mockServer.write(tpvLine({ mode: 3, lat: 1, lon: 1, time: '2026-07-10T10:00:00.000Z' }));

    await vi.waitFor(() => expect(received.length).toBe(1));
  });

  it('dispose() closes the socket and clears timers -- no leak, no further connection attempts', async () => {
    const source = makeSource({ minBackoffMs: 20 });
    source.start();
    await waitForHandshakeCount(mockServer, 1);
    expect(source.getStatus().connection).toBe('connected');

    const connectionsBeforeDispose = mockServer.connections.length;
    source.dispose();
    expect(source.getStatus().connection).toBe('disconnected');

    // Wait well past the backoff window; dispose() must have prevented any reconnect attempt.
    await delay(150);
    expect(mockServer.connections.length).toBe(connectionsBeforeDispose);
  });
});

/** Minimal fake `net.Socket` for deterministic, network-free reconnect-timing tests. */
class FakeSocket extends EventEmitter {
  written: string[] = [];
  destroyed = false;

  write(data: string): boolean {
    this.written.push(data);
    return true;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('close');
  }
}

describe('GpsdSource reconnect backoff (fake timers, injected socket factory)', () => {
  let bus: EventBus;
  let service: PositionService;
  let sockets: FakeSocket[];
  let source: GpsdSource;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new EventBus({ isProduction: false });
    service = new PositionService({ bus, checkIntervalMs: 1000 });
    sockets = [];
  });

  afterEach(() => {
    source.dispose();
    service.dispose();
    vi.useRealTimers();
  });

  function makeSource(): GpsdSource {
    source = new GpsdSource({
      positionService: service,
      minBackoffMs: 1000,
      maxBackoffMs: 30000,
      connectTimeoutMs: 5000,
      createConnection: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as net.Socket;
      },
    });
    return source;
  }

  it('doubles the backoff on each failed attempt and caps it at 30s', () => {
    makeSource();
    source.start();
    expect(sockets.length).toBe(1);

    const expectedDelays = [1000, 2000, 4000, 8000, 16000, 30000, 30000]; // capped from the 6th failure on
    for (const delayMs of expectedDelays) {
      const before = sockets.length;
      sockets[sockets.length - 1].destroy(); // fails without ever connecting
      vi.advanceTimersByTime(delayMs - 1);
      expect(sockets.length).toBe(before); // not yet
      vi.advanceTimersByTime(1);
      expect(sockets.length).toBe(before + 1); // reconnect attempt fires exactly at the expected delay
    }
  });

  it('resets the backoff to the minimum after a successful connect', () => {
    makeSource();
    source.start();
    sockets[0].destroy();
    vi.advanceTimersByTime(1000);
    expect(sockets.length).toBe(2);

    sockets[1].destroy();
    vi.advanceTimersByTime(2000);
    expect(sockets.length).toBe(3);

    // Third attempt succeeds.
    sockets[2].emit('connect');
    sockets[2].destroy(); // then drops again
    vi.advanceTimersByTime(999);
    expect(sockets.length).toBe(3); // not yet -- backoff reset to 1000ms, not 4000ms
    vi.advanceTimersByTime(1);
    expect(sockets.length).toBe(4);
  });

  it('gives up waiting for a stalled handshake after connectTimeoutMs and reconnects', () => {
    makeSource();
    source.start();
    expect(sockets[0].destroyed).toBe(false);

    vi.advanceTimersByTime(4999);
    expect(sockets[0].destroyed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(sockets[0].destroyed).toBe(true); // connect timeout fired

    vi.advanceTimersByTime(999);
    expect(sockets.length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(sockets.length).toBe(2); // reconnect scheduled after the timeout-triggered close
  });

  it('dispose() clears the reconnect timer and prevents any further connection attempt', () => {
    makeSource();
    source.start();
    sockets[0].destroy();
    vi.advanceTimersByTime(500); // still within the 1000ms backoff window
    source.dispose();

    vi.advanceTimersByTime(60000);
    expect(sockets.length).toBe(1); // no reconnect attempt happened after dispose
  });

  it('dispose() leaves no pending timers beyond PositionService baseline', () => {
    const baseline = vi.getTimerCount();
    makeSource();
    source.start();
    expect(vi.getTimerCount()).toBeGreaterThan(baseline); // connect-timeout timer running

    source.dispose();
    expect(vi.getTimerCount()).toBe(baseline);
  });
});
