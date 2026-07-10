/**
 * gpsd position source (E02-T3, ADR-007): connects to a gpsd daemon over
 * TCP (JSON protocol, default `localhost:2947`), streams `TPV`/`SKY`
 * reports, and feeds accepted fixes into `PositionService` exactly like the
 * simulator source (E02-T4, see ../simulator/index.ts) -- it never touches
 * PositionService internals, only `pushFix('gpsd', ...)`.
 *
 * Every fix passes through a `PlausibilityGuard` (../guard.ts) first: jumps
 * (>300 m/s implied speed) are dropped (with the 3-in-a-row exception,
 * W-02), `fix: 'none'` is never forwarded, and inaccurate fixes
 * (accuracy > 100 m) are forwarded but flagged.
 *
 * Connection handling:
 *  - `?WATCH={"enable":true,"json":true}\n` is sent right after connect.
 *  - Incoming bytes are line-buffered (`./lineBuffer.ts`) since TCP does not
 *    preserve gpsd's newline-delimited message boundaries.
 *  - A connect-timeout guards against a host that accepts the TCP handshake
 *    but never completes it (e.g. a firewall black-holing the connection).
 *  - On any disconnect (error or close), the source reconnects with
 *    exponential backoff (1s -> 2s -> 4s ... capped at 30s), reset to the
 *    minimum on the next successful connect.
 *  - gpsd being unreachable is an expected, non-fatal condition (docs/01
 *    ADR-007 lists gpsd as a data service the core depends on but does not
 *    embed) -- this source never throws out of the constructor/start(), and
 *    every socket gets an 'error' listener so a refused/reset connection
 *    can never crash the process.
 */

/* eslint-disable no-undef -- setTimeout/clearTimeout are standard Node
 * globals; see the identical rationale comment in ../service.ts. */

import * as net from 'node:net';
import { Buffer } from 'node:buffer';
import type { Position } from '@yapaja/shared';
import type { PositionService, PositionSource } from '../service.js';
import { PlausibilityGuard } from '../guard.js';
import { LineBuffer } from './lineBuffer.js';
import {
  isGpsdSky,
  isGpsdTpv,
  mapTpvToPosition,
  extractSatelliteCount,
  type GpsdTpv,
} from './mapping.js';

const WATCH_COMMAND = '?WATCH={"enable":true,"json":true}\n';

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 2947;
const DEFAULT_MIN_BACKOFF_MS = 1000;
const DEFAULT_MAX_BACKOFF_MS = 30000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

export type GpsdConnectionState = 'disconnected' | 'connecting' | 'connected';

export interface GpsdStatus {
  connection: GpsdConnectionState;
  /** Satellites reported by the most recent SKY message, or null if none seen yet. */
  satellites: number | null;
  /** Delay the *next* reconnect attempt will use if the current attempt fails. */
  nextBackoffMs: number;
}

export interface GpsdLogger {
  warn: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface GpsdSourceOptions {
  positionService: PositionService;
  host?: string;
  port?: number;
  guard?: PlausibilityGuard;
  logger?: GpsdLogger;
  /** Initial/minimum reconnect backoff in ms. Default 1000. */
  minBackoffMs?: number;
  /** Reconnect backoff cap in ms. Default 30000. */
  maxBackoffMs?: number;
  /** How long to wait for the TCP handshake to complete before giving up. Default 5000. */
  connectTimeoutMs?: number;
  /** Injectable socket factory, mainly for tests (avoids a real TCP connection). Defaults to `net.createConnection`. */
  createConnection?: (options: net.NetConnectOpts) => net.Socket;
}

const defaultLogger: GpsdLogger = {
  warn: (msg, meta) => console.warn(msg, meta ?? ''),
};

/**
 * gpsd TCP client, registered as `PositionService` source `'gpsd'`.
 * Construct once per server, call `start()` after registering it, and
 * `dispose()` on shutdown/test teardown.
 */
export class GpsdSource implements PositionSource {
  readonly name = 'gpsd' as const;

  private readonly positionService: PositionService;
  private readonly host: string;
  private readonly port: number;
  private readonly guard: PlausibilityGuard;
  private readonly logger: GpsdLogger;
  private readonly minBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly connectTimeoutMs: number;
  private readonly createConnectionFn: (options: net.NetConnectOpts) => net.Socket;

  private readonly lineBuffer = new LineBuffer();

  private socket: net.Socket | null = null;
  private connectTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs: number;

  private started = false;
  private disposed = false;
  private connection: GpsdConnectionState = 'disconnected';
  private satellites: number | null = null;

  constructor(opts: GpsdSourceOptions) {
    this.positionService = opts.positionService;
    this.host = opts.host ?? DEFAULT_HOST;
    this.port = opts.port ?? DEFAULT_PORT;
    this.guard = opts.guard ?? new PlausibilityGuard();
    this.logger = opts.logger ?? defaultLogger;
    this.minBackoffMs = opts.minBackoffMs ?? DEFAULT_MIN_BACKOFF_MS;
    this.maxBackoffMs = opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.createConnectionFn = opts.createConnection ?? net.createConnection;
    this.backoffMs = this.minBackoffMs;
  }

  /** Begins connecting (and reconnecting) to gpsd. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.disposed = false;
    this.backoffMs = this.minBackoffMs;
    this.connect();
  }

  getStatus(): GpsdStatus {
    return {
      connection: this.connection,
      satellites: this.satellites,
      nextBackoffMs: this.backoffMs,
    };
  }

  /** Closes the socket and clears all timers. Safe to call repeatedly (e.g. server shutdown, test teardown). */
  dispose(): void {
    this.disposed = true;
    this.started = false;
    this.connection = 'disconnected';

    if (this.connectTimeoutTimer) {
      clearTimeout(this.connectTimeoutTimer);
      this.connectTimeoutTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
  }

  private connect(): void {
    if (this.disposed) return;
    this.connection = 'connecting';
    this.lineBuffer.reset();

    let socket: net.Socket;
    try {
      socket = this.createConnectionFn({ host: this.host, port: this.port });
    } catch (err) {
      // Synchronous throw from a stubbed factory in tests, or an immediate
      // local failure (e.g. invalid options) -- treat exactly like an
      // async connection error rather than letting it escape start().
      this.logger.warn('gpsd: failed to open connection', {
        host: this.host,
        port: this.port,
        error: err instanceof Error ? err.message : String(err),
      });
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    this.connectTimeoutTimer = setTimeout(() => {
      this.logger.warn('gpsd: connect timeout', { host: this.host, port: this.port, timeoutMs: this.connectTimeoutMs });
      socket.destroy();
    }, this.connectTimeoutMs);
    this.connectTimeoutTimer.unref?.();

    // Every socket gets an 'error' listener so a refused/reset connection
    // never becomes an uncaught exception; reconnection itself is driven by
    // 'close', which Node guarantees fires after 'error'.
    socket.on('error', (err) => {
      this.logger.warn('gpsd: socket error', {
        host: this.host,
        port: this.port,
        error: err.message,
      });
    });

    socket.once('connect', () => {
      if (this.connectTimeoutTimer) {
        clearTimeout(this.connectTimeoutTimer);
        this.connectTimeoutTimer = null;
      }
      this.connection = 'connected';
      this.backoffMs = this.minBackoffMs;
      // A fresh connection means a fix from before this gap must never be
      // compared against one from after it for jump detection.
      this.guard.reset();
      socket.write(WATCH_COMMAND);
    });

    socket.on('data', (chunk: Buffer) => this.handleData(chunk.toString('utf-8')));

    socket.once('close', () => {
      if (this.connectTimeoutTimer) {
        clearTimeout(this.connectTimeoutTimer);
        this.connectTimeoutTimer = null;
      }
      this.socket = null;
      this.connection = 'disconnected';
      if (this.disposed) return;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.maxBackoffMs, this.backoffMs * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private handleData(chunk: string): void {
    for (const line of this.lineBuffer.feed(chunk)) {
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      this.logger.warn('gpsd: failed to parse line as JSON', {
        line,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    if (!msg || typeof msg !== 'object') return;
    const record = msg as Record<string, unknown>;

    if (isGpsdTpv(record)) {
      this.handleTpv(record);
    } else if (isGpsdSky(record)) {
      this.satellites = extractSatelliteCount(record);
    }
    // VERSION/DEVICES/WATCH handshake replies: informational only, no-op.
  }

  private handleTpv(tpv: GpsdTpv): void {
    const position = mapTpvToPosition(tpv, new Date().toISOString());
    if (!position) return; // mode 0/1 (no fix) or missing lat/lon -- never forwarded.

    const result = this.guard.evaluate(position);
    if (!result.accept || !result.position) {
      this.logger.warn('gpsd: guard rejected fix', { reason: result.reason });
      return;
    }
    if (result.reason === 'inaccurate') {
      this.logger.warn('gpsd: accepted fix flagged inaccurate', {
        accuracy: result.position.accuracy,
      });
    }
    this.pushFix(result.position);
  }

  private pushFix(position: Position): void {
    this.positionService.pushFix('gpsd', position);
  }
}

export { DEFAULT_HOST as GPSD_DEFAULT_HOST, DEFAULT_PORT as GPSD_DEFAULT_PORT };
