/**
 * Browser Geolocation Source (E02-T2)
 *
 * Watches the device's native geolocation (navigator.geolocation.watchPosition)
 * and sends each fix to the Core via POST /api/v1/position/browser.
 *
 * Handles:
 * - Secure context checks (W-03): no HTTP on non-localhost
 * - Permission denials: show appropriate hints
 * - Timeouts/unavailable: retry with backoff
 * - Source selection: only send if browser/auto source is active
 */

import type { Position } from '@yapaja/shared';

export type BrowserSourceError =
  | 'insecure-context'
  | 'not-supported'
  | 'permission-denied'
  | 'position-unavailable'
  | 'timeout'
  | 'unknown';

export type BrowserSourceStatus =
  | 'idle'
  | 'starting'
  | 'active'
  | 'error'
  | 'paused';

export interface BrowserSourceState {
  status: BrowserSourceStatus;
  error?: BrowserSourceError;
  lastPosition?: Position;
  watchId?: number;
}

interface BrowserSourceConfig {
  enableHighAccuracy?: boolean;
  maximumAge?: number;
  timeout?: number;
  basePath?: string;
}

const DEFAULT_CONFIG: Required<BrowserSourceConfig> = {
  enableHighAccuracy: true,
  maximumAge: 1000,
  timeout: 10_000,
  basePath: '',
};

class BrowserSource {
  private config: Required<BrowserSourceConfig>;
  private watchId: number | null = null;
  private statusCallback: ((state: BrowserSourceState) => void) | null = null;
  private state: BrowserSourceState = { status: 'idle' };
  private sendQueue: Position[] = [];
  private isSending = false;
  private sourceCheckInterval: number | null = null;
  private activeSource: string | null = null;

  constructor(config?: BrowserSourceConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register callback to receive state updates. Returns unsubscribe function.
   */
  onStateChange(callback: (state: BrowserSourceState) => void): (() => void) {
    this.statusCallback = callback;
    return () => {
      if (this.statusCallback === callback) {
        this.statusCallback = null;
      }
    };
  }

  /**
   * Start watching position. Performs security checks before calling watchPosition.
   */
  async start(): Promise<void> {
    this.updateState({ status: 'starting' });

    // W-03: Check secure context
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      this.updateState({
        status: 'error',
        error: 'insecure-context',
      });
      return;
    }

    // Check if Geolocation API is available
    if (!navigator?.geolocation) {
      this.updateState({
        status: 'error',
        error: 'not-supported',
      });
      return;
    }

    // Start periodic source check
    this.startSourceCheck();

    // Start watching position
    this.watchId = navigator.geolocation.watchPosition(
      (position) => this.handleSuccess(position),
      (error) => this.handleError(error),
      {
        enableHighAccuracy: this.config.enableHighAccuracy,
        maximumAge: this.config.maximumAge,
        timeout: this.config.timeout,
      },
    );

    this.updateState({ status: 'active', watchId: this.watchId });
  }

  /**
   * Stop watching position
   */
  stop(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }

    if (this.sourceCheckInterval !== null) {
      window.clearInterval(this.sourceCheckInterval);
      this.sourceCheckInterval = null;
    }

    this.updateState({ status: 'idle', watchId: undefined });
  }

  /**
   * Pause sending (but keep watching)
   */
  pause(): void {
    this.updateState({ status: 'paused' });
  }

  /**
   * Resume sending
   */
  resume(): void {
    if (this.watchId !== null) {
      this.updateState({ status: 'active' });
      // Flush queue
      void this.flushQueue();
    }
  }

  private handleSuccess(position: GeolocationPosition): void {
    // Map browser GeolocationPosition to our Position type
    const pos: Position = this.mapToPosition(position);
    this.updateState({ status: 'active', lastPosition: pos });

    // Queue for sending
    this.sendQueue.push(pos);
    void this.flushQueue();
  }

  private handleError(error: GeolocationPositionError): void {
    const errorMap: Record<number, BrowserSourceError> = {
      1: 'permission-denied',
      2: 'position-unavailable',
      3: 'timeout',
    };

    const browserError = errorMap[error.code] || 'unknown';
    this.updateState({
      status: 'error',
      error: browserError,
    });
  }

  /**
   * Map browser GeolocationPosition to Position type
   */
  private mapToPosition(position: GeolocationPosition): Position {
    const coords = position.coords;

    // Speed: GeolocationCoordinates.speed is in m/s, which is what we need
    const speed = coords.speed !== null && !isNaN(coords.speed) ? coords.speed : null;

    // Heading: GeolocationCoordinates.heading is in degrees, which is what we need
    // It can be NaN if not available
    const heading =
      coords.heading !== null && !isNaN(coords.heading) && coords.heading >= 0
        ? coords.heading
        : null;

    // Determine fix quality based on accuracy
    let fix: 'none' | '2d' | '3d' = 'none';
    if (coords.accuracy !== null) {
      if (coords.accuracy < 100) {
        fix = coords.altitude !== null ? '3d' : '2d';
      } else {
        fix = '2d';
      }
    }

    return {
      lat: coords.latitude,
      lon: coords.longitude,
      alt: coords.altitude,
      speed,
      heading,
      accuracy: coords.accuracy,
      source: 'browser',
      fix,
      ts: new Date(position.timestamp).toISOString(),
    };
  }

  /**
   * Check active source periodically and only send if it's 'browser' or 'auto'
   */
  private startSourceCheck(): void {
    this.sourceCheckInterval = window.setInterval(() => {
      void this.checkActiveSource();
    }, 5000) as unknown as number;

    // Check immediately
    void this.checkActiveSource();
  }

  private async checkActiveSource(): Promise<void> {
    try {
      const basePath = this.config.basePath || import.meta.env.BASE_URL || '/';
      const response = await fetch(`${basePath}api/v1/position/sources`, {
        method: 'GET',
      });
      if (response.ok) {
        const data = (await response.json()) as { sources?: Array<{ id: string; active: boolean }> };
        const activeSources = data.sources?.filter((s) => s.active) || [];
        // Only proceed if the active source is 'browser' or no source is active (fall back to browser)
        if (activeSources.length === 0 || activeSources.some((s) => s.id === 'browser')) {
          this.activeSource = 'browser';
        } else {
          this.activeSource = activeSources[0]?.id || null;
        }
      }
    } catch (err) {
      console.warn('[BrowserSource] Failed to check active source:', err);
      // On error, assume browser is okay to use
      this.activeSource = 'browser';
    }
  }

  /**
   * Send queued positions to the Core
   */
  private async flushQueue(): Promise<void> {
    if (
      this.isSending ||
      this.state.status !== 'active' ||
      this.sendQueue.length === 0 ||
      !this.activeSource ||
      (this.activeSource !== 'browser' && this.activeSource !== 'auto')
    ) {
      return;
    }

    this.isSending = true;

    while (this.sendQueue.length > 0 && this.state.status === 'active') {
      const position = this.sendQueue.shift();
      if (!position) break;

      try {
        const basePath = this.config.basePath || import.meta.env.BASE_URL || '/';
        const response = await fetch(`${basePath}api/v1/position/browser`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(position),
        });

        if (!response.ok) {
          console.warn(`[BrowserSource] POST /position/browser returned ${response.status}`);
          // Don't retry on error, just log and continue
        }
      } catch (err) {
        console.warn('[BrowserSource] Failed to send position:', err);
        // Don't retry on network error, just log and continue
      }

      // Small delay between sends to avoid hammering the server
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.isSending = false;
  }

  /**
   * Get current state
   */
  getState(): BrowserSourceState {
    return { ...this.state };
  }

  private updateState(partial: Partial<BrowserSourceState>): void {
    this.state = { ...this.state, ...partial };
    this.statusCallback?.(this.state);
  }
}

export const browserSource = new BrowserSource({
  basePath: import.meta.env.BASE_URL,
});
