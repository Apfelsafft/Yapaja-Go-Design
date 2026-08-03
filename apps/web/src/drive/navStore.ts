/**
 * Nav Store (E04-T3)
 *
 * Zustand-based store that manages:
 * - WebSocket connection to `/ws/v1` Core endpoint
 * - Subscription to `nav/*` events (`nav/state`, `nav/instruction`)
 * - Current `NavState` + the last-received announcement
 *
 * Mirrors `position/positionStore.ts`'s WS-manager pattern (own dedicated
 * connection per domain, same reconnect-with-backoff shape) rather than
 * sharing one -- that's the established convention in this codebase, not
 * something E04-T3 introduces.
 */

import { create } from 'zustand';
import type { LatLng, NavInstructionPayload, NavState } from '@yapaja/shared';
import { buildWebSocketUrl, currentWsUrlLocation } from '../net/wsUrl.js';

/** W-19 reload-recovery: what the "Navigation fortsetzen?" prompt has to
 *  offer, discovered once at app boot (see `resume.ts#checkResumeOnLoad`).
 *  - `active`: the Core is ALREADY navigating (tab crashed/reloaded, Core
 *    kept running) -- resuming just promotes this snapshot into `navState`,
 *    no REST call needed.
 *  - `recovered`: the Core restarted; `navigating` reset to `idle`, but the
 *    last route is still cached (`event/nav_recovered_route_available`'s
 *    REST-observable twin, `GET /navigation/state`'s `recovered_route`) --
 *    resuming POSTs `/navigation/start` with this `route_id`. */
export type PendingResume =
  | { kind: 'active'; state: NavState }
  | { kind: 'recovered'; route_id: string; destination: { latlng: LatLng; name: string | null } | null };

/**
 * E06-T3: mirrors the core's `event/profile_change_pending` payload
 * (`apps/core/src/bus/index.ts`) -- the confirmation-banner trigger. Carries
 * BOTH the new and the previous profile so "Abbrechen" can reactivate the
 * previous one without a separate lookup round-trip.
 */
export interface PendingProfileChange {
  profile_id: string;
  profile_name: string;
  previous_profile_id: string;
  previous_profile_name: string;
}

/** E06-T3: the >15%-longer advisory, derived from `route/updated`'s `duration_warning_pct`. */
export interface ProfileChangeWarning {
  pct: number;
}

interface NavStoreState {
  navState: NavState | null;
  /** Last `nav/instruction` received; the Drive UI/TTS react to it changing. */
  lastInstruction: NavInstructionPayload | null;
  /** Bumped on every `nav/instruction` (even if `say` text repeats) so consumers can detect "new one arrived" via reference/counter rather than deep-equality. */
  instructionSeq: number;
  isConnected: boolean;
  /** W-19: true once the reload-recovery check has resolved (nothing to
   *  resume, or the user acknowledged the prompt). The Drive UI (maneuver
   *  panel, drive-mode camera/follow, pause/stop controls) stays hidden
   *  while false EVEN IF `navState` already reports an active session --
   *  avoids jumping straight into 3D drive mode before the user confirms.
   *  Defaults to `true` so every flow that never runs the boot check (all
   *  pre-E04-T5 tests, and every OTHER app entry point) behaves exactly as
   *  before -- this is opt-in, not a global gate. */
  resumeAcknowledged: boolean;
  pendingResume: PendingResume | null;
  /** E06-T3: non-null while "Mit '‹name›' neu berechnen?" is awaiting an answer. */
  pendingProfileChange: PendingProfileChange | null;
  /** E06-T3: set from `route/updated`'s `duration_warning_pct` when a profile-change reroute lands >15% longer. */
  profileChangeWarning: ProfileChangeWarning | null;

  setNavState: (s: NavState) => void;
  setInstruction: (i: NavInstructionPayload) => void;
  setConnected: (connected: boolean) => void;
  setPendingResume: (p: PendingResume | null) => void;
  /** Dismisses the prompt (if any) without touching server-side nav state. */
  acknowledgeResume: () => void;
  setPendingProfileChange: (p: PendingProfileChange | null) => void;
  setProfileChangeWarning: (w: ProfileChangeWarning | null) => void;
}

export const useNavStore = create<NavStoreState>((set) => ({
  navState: null,
  lastInstruction: null,
  instructionSeq: 0,
  isConnected: false,
  resumeAcknowledged: true,
  pendingResume: null,
  pendingProfileChange: null,
  profileChangeWarning: null,

  setNavState: (s) => set({ navState: s }),
  setInstruction: (i) => set((state) => ({ lastInstruction: i, instructionSeq: state.instructionSeq + 1 })),
  setConnected: (connected) => set({ isConnected: connected }),
  setPendingResume: (p) => set({ pendingResume: p, resumeAcknowledged: p === null }),
  acknowledgeResume: () => set({ pendingResume: null, resumeAcknowledged: true }),
  setPendingProfileChange: (p) => set({ pendingProfileChange: p }),
  setProfileChangeWarning: (w) => set({ profileChangeWarning: w }),
}));

/** Whether the Drive UI should treat `navState` as "live" right now (E04-T5,
 *  W-19): the reload-recovery prompt (if any) must be acknowledged first. */
export function useDriveGateOpen(): boolean {
  return useNavStore((state) => state.resumeAcknowledged);
}

declare global {
  interface Window {
    /** Debug/E2E hook, mirrors `window.__yapajaPositionStore`. */
    __yapajaNavStore?: typeof useNavStore;
  }
}

if (typeof window !== 'undefined') {
  window.__yapajaNavStore = useNavStore;
}

/** Hook for components to access the current NavState. */
export function useNavState(): NavState | null {
  return useNavStore((state) => state.navState);
}

interface WSMessage {
  topic: string;
  payload: unknown;
}

class NavWSManager {
  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private reconnectTimer: number | null = null;
  private isManuallyConnected = false;
  private basePath = '';

  constructor(basePath: string = '') {
    this.basePath = basePath || import.meta.env.BASE_URL || '/';
  }

  async connect(): Promise<void> {
    if (this.isManuallyConnected || this.ws) return;
    this.isManuallyConnected = true;
    await this.connectImpl();
  }

  disconnect(): void {
    this.isManuallyConnected = false;
    this.closeConnection();
  }

  private async connectImpl(): Promise<void> {
    if (!this.isManuallyConnected) return;

    try {
      const wsUrl = this.getWebSocketUrl();
      this.ws = new WebSocket(wsUrl);

      this.ws.addEventListener('open', () => {
        useNavStore.getState().setConnected(true);
        this.reconnectAttempt = 0;
        this.reconnectDelay = 1000;
        // `route/*` + `event/profile_change_pending` (E06-T3): the profile-
        // change-during-navigation reroute coupling's confirmation banner /
        // warning-banner input -- same connection as `nav/*` rather than a
        // second dedicated one, since it's the same "navigation" domain.
        this.send({ type: 'subscribe', topics: ['nav/*', 'route/*', 'event/profile_change_pending'] });
      });

      this.ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(event.data) as WSMessage;
          if (msg.topic === 'nav/state') {
            useNavStore.getState().setNavState(msg.payload as NavState);
          } else if (msg.topic === 'nav/instruction') {
            useNavStore.getState().setInstruction(msg.payload as NavInstructionPayload);
          } else if (msg.topic === 'event/profile_change_pending') {
            useNavStore.getState().setPendingProfileChange(msg.payload as PendingProfileChange);
          } else if (msg.topic === 'route/updated') {
            const payload = msg.payload as { reason: string; duration_warning_pct?: number };
            if (payload.reason === 'profile_change') {
              // The reroute landed (confirmed OR headless auto-yes) -- any
              // outstanding confirmation banner is now moot.
              useNavStore.getState().setPendingProfileChange(null);
              useNavStore
                .getState()
                .setProfileChangeWarning(
                  typeof payload.duration_warning_pct === 'number'
                    ? { pct: payload.duration_warning_pct }
                    : null,
                );
            }
          }
        } catch (err) {
          console.warn('[NavWSManager] Failed to parse message:', err);
        }
      });

      this.ws.addEventListener('close', () => {
        this.ws = null;
        useNavStore.getState().setConnected(false);
        if (this.isManuallyConnected) this.scheduleReconnect();
      });

      this.ws.addEventListener('error', (event) => {
        console.warn('[NavWSManager] WS error:', event);
      });
    } catch (err) {
      console.error('[NavWSManager] Failed to connect:', err);
      if (this.isManuallyConnected) this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      console.error('[NavWSManager] Max reconnect attempts reached');
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
    useNavStore.getState().setConnected(false);
  }

  private send(msg: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private getWebSocketUrl(): string {
    // Shared with the other two WS managers -- see `net/wsUrl.ts` for the
    // ingress sub-path bug that lived in three copy-pasted versions of this.
    return buildWebSocketUrl(this.basePath, currentWsUrlLocation());
  }
}

export const navWSManager = new NavWSManager(import.meta.env.BASE_URL);
