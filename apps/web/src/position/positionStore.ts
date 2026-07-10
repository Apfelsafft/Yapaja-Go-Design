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

  // Internal
  setPosition: (pos: Position | null) => void;
  setConnected: (connected: boolean) => void;
  setError: (error: string | null) => void;
  setLastUpdateTime: (time: number | null) => void;
}

export const usePositionStore = create<PositionStoreState>((set) => ({
  position: null,
  isConnected: false,
  lastUpdateTime: null,
  error: null,

  setPosition: (pos) => set({ position: pos, lastUpdateTime: pos ? Date.now() : null }),
  setConnected: (connected) => set({ isConnected: connected }),
  setError: (error) => set({ error }),
  setLastUpdateTime: (time) => set({ lastUpdateTime: time }),
}));

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
          if (msg.topic.startsWith('pos/')) {
            const position = msg.payload as Position;
            usePositionStore.getState().setPosition(position);
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
