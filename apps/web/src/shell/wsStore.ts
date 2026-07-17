/**
 * The widget shell's single shared `/ws/v1` connection (E07-T1).
 *
 * `apps/web/src/position/positionStore.ts` and `apps/web/src/drive/navStore.ts`
 * each open their OWN dedicated WebSocket to `/ws/v1` (an established
 * pre-E07 pattern, see those files' doc comments). The widget system must
 * NOT repeat that per-domain-connection pattern -- E07-T1's plausibility
 * check is "exactly ONE `/ws/v1` connection regardless of widget count", so
 * every widget, no matter how many are mounted, shares this ONE manager
 * instance instead of each (or each domain) opening its own.
 *
 * Boundary (documented per the task's explicit allowance -- "if fully
 * consolidating positionStore/navStore is too invasive, at minimum ensure
 * the WIDGET system uses a single connection and document the boundary"):
 * this store is the widget shell's ONLY connection. `ManeuverPanel`/
 * `SpeedLimitSign`, when reused as widgets (`shell/widgets/nextInstruction.tsx`,
 * `shell/widgets/speedLimit.tsx`), are passed the `NavState` this store
 * received over ITS connection as an explicit prop -- they do NOT fall back
 * to their own `navStore` hook in that case (see those components' updated
 * signatures). The pre-existing `positionStore`/`navStore` + their
 * `DriveOverlay`/`PositionInitializer` mounts remain exactly as they were;
 * fully merging all three connections into one app-wide manager is
 * explicitly out of E07-T1's scope (no scope creep into later E07 tasks) and
 * is left for whichever later task wires the widget shell in as the app's
 * primary layout.
 *
 * Topic subscription: the server (`apps/core/src/bus/ws.ts`) REPLACES a
 * client's subscription set on every `{type:'subscribe', topics:[...]}`
 * message (not additive) -- so `setTopics` always sends the FULL union of
 * currently-needed topics, computed once per layout/mode change by
 * `Shell.tsx` (widget mount/unmount granularity, e.g. live drag-and-drop
 * editing, is E07-T2's concern).
 */

import { create } from 'zustand';

interface ShellWsState {
  connected: boolean;
  /** Latest payload per EXACT topic string the bus published under (e.g. `"pos/update"`, `"nav/state"`). */
  data: Record<string, unknown>;
  /** Bumped once per underlying `WebSocket` object actually opened -- the
   *  E2E "exactly one connection" assertion's in-page complement (Playwright
   *  itself observes the network layer independently via `page.on('websocket', ...)`;
   *  this is additionally useful for debugging/dev). */
  socketOpens: number;

  setConnected: (connected: boolean) => void;
  setTopicData: (topic: string, payload: unknown) => void;
  bumpSocketOpens: () => void;
}

export const useShellWsStore = create<ShellWsState>((set) => ({
  connected: false,
  data: {},
  socketOpens: 0,

  setConnected: (connected) => set({ connected }),
  setTopicData: (topic, payload) => set((state) => ({ data: { ...state.data, [topic]: payload } })),
  bumpSocketOpens: () => set((state) => ({ socketOpens: state.socketOpens + 1 })),
}));

interface WSMessage {
  topic: string;
  payload: unknown;
}

class ShellWsManager {
  private ws: WebSocket | null = null;
  private desiredTopics: string[] = [];
  private reconnectAttempt = 0;
  private readonly maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private reconnectTimer: number | null = null;
  private isManuallyConnected = false;
  private readonly basePath: string;

  constructor(basePath: string = '') {
    this.basePath = basePath || (typeof window !== 'undefined' ? '/' : '');
  }

  /** Idempotent: a second call while already connected/connecting is a no-op
   *  -- this is WHAT guarantees at most one underlying `WebSocket` object at
   *  a time, regardless of how many widgets call this on mount. */
  async connect(): Promise<void> {
    if (this.isManuallyConnected || this.ws) return;
    this.isManuallyConnected = true;
    await this.connectImpl();
  }

  disconnect(): void {
    this.isManuallyConnected = false;
    this.closeConnection();
  }

  /** Sets the full union of topics every currently-mounted widget needs and,
   *  if the socket is open, resends the subscription immediately (a full
   *  replace, matching the server's contract). */
  setTopics(topics: string[]): void {
    const deduped = [...new Set(topics)].sort();
    if (deduped.length === this.desiredTopics.length && deduped.every((t, i) => t === this.desiredTopics[i])) {
      return; // unchanged -- avoid a redundant subscribe round-trip
    }
    this.desiredTopics = deduped;
    this.sendSubscribe();
  }

  private async connectImpl(): Promise<void> {
    if (!this.isManuallyConnected) return;

    try {
      const ws = new WebSocket(this.getWebSocketUrl());
      this.ws = ws;

      ws.addEventListener('open', () => {
        useShellWsStore.getState().setConnected(true);
        useShellWsStore.getState().bumpSocketOpens();
        this.reconnectAttempt = 0;
        this.reconnectDelay = 1000;
        this.sendSubscribe();
      });

      ws.addEventListener('message', (event: MessageEvent<string>) => {
        try {
          const msg = JSON.parse(event.data) as WSMessage;
          if (msg && typeof msg.topic === 'string') {
            useShellWsStore.getState().setTopicData(msg.topic, msg.payload);
          }
        } catch (err) {
          console.warn('[ShellWsManager] Failed to parse message:', err);
        }
      });

      ws.addEventListener('close', () => {
        this.ws = null;
        useShellWsStore.getState().setConnected(false);
        if (this.isManuallyConnected) this.scheduleReconnect();
      });

      ws.addEventListener('error', (event) => {
        console.warn('[ShellWsManager] WS error:', event);
      });
    } catch (err) {
      console.error('[ShellWsManager] Failed to connect:', err);
      if (this.isManuallyConnected) this.scheduleReconnect();
    }
  }

  private sendSubscribe(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', topics: this.desiredTopics }));
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      console.error('[ShellWsManager] Max reconnect attempts reached');
      return;
    }
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectImpl();
    }, this.reconnectDelay);
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
    useShellWsStore.getState().setConnected(false);
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
}

export const shellWsManager = new ShellWsManager(
  typeof window !== 'undefined' ? import.meta.env.BASE_URL : '',
);

declare global {
  interface Window {
    /** Debug/E2E hook, mirrors `window.__yapajaPositionStore`/`__yapajaNavStore`. */
    __yapajaShellWsStore?: typeof useShellWsStore;
  }
}

if (typeof window !== 'undefined') {
  window.__yapajaShellWsStore = useShellWsStore;
}
