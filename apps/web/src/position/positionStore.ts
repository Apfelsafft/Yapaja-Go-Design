/**
 * Position Store (E02-T2)
 *
 * Zustand-based store that manages:
 * - WebSocket connection to `/ws/v1` Core endpoint
 * - Subscription to `pos/*` events
 * - Current position state
 * - Reconnection with exponential backoff
 *
 * The position displayed in the UI ALWAYS comes from the Core via WS,
 * never directly from the browser. This keeps the UI source-agnostic
 * (the Core decides which source to use).
 */

import { create } from 'zustand';
import type { Position } from '@yapaja/shared';

interface PositionStoreState {
  position: Position | null;
  isConnected: boolean;
  lastUpdateTime: number | null;
  error: string | null;
  /** True while `position` came from `pos/extrapolated` (dead-reckoning, W-01) rather than a real `pos/update` fix. */
  extrapolated: boolean;
  /** Timestamp of the last REAL fix (`pos/update`) only -- never touched by `pos/extrapolated`. Drives GPS-loss detection (see gpsSignal.ts). */
  lastRealUpdateTime: number | null;

  // Internal
  setPosition: (pos: Position | null) => void;
  /** `pos/update`: a real fix. Resets `extrapolated` and bumps `lastRealUpdateTime`. */
  setRealPosition: (pos: Position) => void;
  /** `pos/extrapolated`: a dead-reckoned guess (W-01). Leaves `lastRealUpdateTime` untouched. */
  setExtrapolatedPosition: (pos: Position) => void;
  setConnected: (connected: boolean) => void;
  setError: (error: string | null) => void;
  setLastUpdateTime: (time: number | null) => void;
}

export const usePositionStore = create<PositionStoreState>((set) => ({
  position: null,
  isConnected: false,
  lastUpdateTime: null,
  error: null,
  extrapolated: false,
  lastRealUpdateTime: null,

  setPosition: (pos) => set({ position: pos, lastUpdateTime: pos ? Date.now() : null }),
  setRealPosition: (pos) =>
    set({ position: pos, lastUpdateTime: Date.now(), extrapolated: false, lastRealUpdateTime: Date.now() }),
  setExtrapolatedPosition: (pos) =>
    set({ position: pos, lastUpdateTime: Date.now(), extrapolated: true }),
  setConnected: (connected) => set({ isConnected: connected }),
  setError: (error) => set({ error }),
  setLastUpdateTime: (time) => set({ lastUpdateTime: time }),
}));

declare global {
  interface Window {
    /**
     * Debug/E2E hook (E02-T5), mirrors `window.__yapajaMapController`
     * (apps/web/src/map/MapView.tsx): exposes the position store so
     * Playwright can assert on `extrapolated`/`lastRealUpdateTime` directly
     * (`getState()`) instead of inferring them from the DOM. Read-only in
     * intent -- production code must still go through `usePositionStore`.
     */
    __yapajaPositionStore?: typeof usePositionStore;
  }
}

if (typeof window !== 'undefined') {
  window.__yapajaPositionStore = usePositionStore;
}

/**
 * Hook for components to access current position
 */
export function usePosition(): Position | null {
  return usePositionStore((state) => state.position);
}

/**
 * Hook for components to check connection status
 */
export function usePositionConnected(): boolean {
  return usePositionStore((state) => state.isConnected);
}

/**
 * Hook for components to check whether the current position is a
 * dead-reckoned extrapolation (`pos/extrapolated`) rather than a real fix.
 */
export function usePositionExtrapolated(): boolean {
  return usePositionStore((state) => state.extrapolated);
}

interface WSMessage {
  topic: string;
  payload: unknown;
}

class PositionWSManager {
  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000; // Start at 1s
  private reconnectTimer: number | null = null;
  private isManuallyConnected = false;
  private basePath = '';

  constructor(basePath: string = '') {
    this.basePath = basePath || import.meta.env.BASE_URL || '/';
  }

  async connect(): Promise<void> {
    if (this.isManuallyConnected || this.ws) {
      return;
    }

    this.isManuallyConnected = true;
    await this.connectImpl();
  }

  disconnect(): void {
    this.isManuallyConnected = false;
    this.closeConnection();
  }

  private async connectImpl(): Promise<void> {
    if (!this.isManuallyConnected) {
      return;
    }

    try {
      const wsUrl = this.getWebSocketUrl();
      this.ws = new WebSocket(wsUrl);

      this.ws.addEventListener('open', () => {
        // Connected to WS
        usePositionStore.getState().setConnected(true);
        usePositionStore.getState().setError(null);
        this.reconnectAttempt = 0;
        this.reconnectDelay = 1000;

        // Subscribe to position updates
        this.send({
          type: 'subscribe',
          topics: ['pos/*'],
        });
      });

      this.ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(event.data) as WSMessage;
          // Branch by exact topic (W-01): `pos/update` is a real fix and
          // drives GPS-loss detection via `lastRealUpdateTime`;
          // `pos/extrapolated` is a dead-reckoned guess and must never reset
          // that timestamp (see gpsSignal.ts).
          if (msg.topic === 'pos/update') {
            usePositionStore.getState().setRealPosition(msg.payload as Position);
          } else if (msg.topic === 'pos/extrapolated') {
            usePositionStore.getState().setExtrapolatedPosition(msg.payload as Position);
          }
        } catch (err) {
          console.warn('[PositionWSManager] Failed to parse message:', err);
        }
      });

      this.ws.addEventListener('close', () => {
        // WS closed
        this.ws = null;
        usePositionStore.getState().setConnected(false);

        if (this.isManuallyConnected) {
          this.scheduleReconnect();
        }
      });

      this.ws.addEventListener('error', (event) => {
        console.warn('[PositionWSManager] WS error:', event);
        usePositionStore.getState().setError('WebSocket connection failed');
      });
    } catch (err) {
      console.error('[PositionWSManager] Failed to connect:', err);
      usePositionStore.getState().setError(String(err));
      if (this.isManuallyConnected) {
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return; // Already scheduled
    }

    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      console.error('[PositionWSManager] Max reconnect attempts reached');
      usePositionStore.getState().setError('Maximum reconnection attempts reached');
      return;
    }

    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectImpl();
    }, this.reconnectDelay);

    // Exponential backoff: 1s, 2s, 4s, 8s, ...
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
  }

  private closeConnection(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    usePositionStore.getState().setConnected(false);
  }

  private send(msg: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private getWebSocketUrl(): string {
    if (typeof window === 'undefined') {
      throw new Error('WebSocket is not available in this environment');
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsPath = new URL(this.basePath, window.location.origin).pathname;
    const fullPath = wsPath.endsWith('/') ? `${wsPath}ws/v1` : `${wsPath}/ws/v1`;

    return `${protocol}//${host}${fullPath}`;
  }

  /**
   * Get current position (non-hook accessor for use outside React)
   */
  getPosition(): Position | null {
    return usePositionStore.getState().position;
  }
}

// Singleton instance
export const positionWSManager = new PositionWSManager(import.meta.env.BASE_URL);
