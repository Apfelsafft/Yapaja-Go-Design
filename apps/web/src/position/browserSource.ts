/**
 * Browser Geolocation Source (E02-T2)
 *
 * Watches the device's native geolocation (navigator.geolocation.watchPosition)
 * and sends each fix to the Core via POST /api/v1/position/browser.
 *
 * Handles:
 * - Secure context checks (W-03): no HTTP on non-localhost
 * - Permission denials: show appropriate hints
 * - Timeouts/unavailable: reported as state, no own retry -- `watchPosition`
 *   keeps running and der naechste erfolgreiche Fix setzt den Zustand selbst
 *   wieder auf 'active'. (Hier stand frueher „retry with backoff"; ein
 *   Backoff war nie implementiert.)
 * - Source selection: nicht senden, wenn der Core eine ANDERE Quelle erzwingt
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
  /** Ob der Core das Senden gerade zulaesst -- siehe `checkActiveSource()`.
   *  Startwert `true`: bevor die erste Antwort da ist, ist nichts erzwungen,
   *  und ein zu frueh gesendeter Fix waere folgenlos (409). */
  private sendingAllowed = true;

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
    // Eine Positionsmeldung ist verderbliche Ware: „der neueste Fix" ist die
    // ganze Wahrheit, ein zehn Sekunden alter Fix ist wertlos. Die
    // Warteschlange war bisher unbegrenzt -- konnte der Client eine Weile
    // nicht senden, staute sie sich auf und wurde danach im 100-ms-Takt am
    // Stueck nachgeliefert. Der Core hat diese Positionen dann der Reihe nach
    // als aktuell verarbeitet und die Anzeige einen laengst gefahrenen Weg
    // nachzeichnen lassen. Deshalb: nur der letzte Fix bleibt stehen.
    this.sendQueue = [pos];
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
   * Periodically ask the Core whether this client may still send fixes.
   *
   * ─── WORAN DAS HIER GESCHEITERT IST ────────────────────────────────────────
   * Die Frage lautet ausschliesslich: ist eine ANDERE Quelle ERZWUNGEN?
   * Frueher stand hier stattdessen eine Auswertung des Feldes `active` -- und
   * zwar mit dem falschen Schluessel: gelesen wurde `s.id`, geliefert wird von
   * `GET /position/sources` aber `s.name` (siehe
   * `apps/core/src/position/service.ts`, `SourceStatus`). `s.id` ist also
   * immer `undefined`, damit war `some(s => s.id === 'browser')` immer falsch
   * und `activeSources[0]?.id || null` immer `null` -- und `flushQueue()`
   * bricht bei `!this.activeSource` ab.
   *
   * Die Folge war kein sauberer Ausfall, sondern ein Flattern, das man leicht
   * dem GPS-Empfang anlastet:
   *
   *   1. Kaltstart: keine Quelle aktiv -> `activeSource = 'browser'` -> EIN Fix
   *      wird gesendet.
   *   2. Der Core meldet `browser` daraufhin fuer 5 s als aktiv
   *      (`activeWindowMs`). Der naechste Poll liest `active: true`, findet
   *      `s.id` nicht -> `activeSource = null` -> es wird NICHTS mehr gesendet.
   *   3. Nach 5 s ohne Fix gilt `browser` wieder als inaktiv, der Core feuert
   *      `event/gps_lost`, die Oberflaeche zeigt ab 3 s „GPS-Signal verloren"
   *      (`gpsSignal.ts`).
   *   4. Der naechste Poll sieht wieder „keine Quelle aktiv" -> ein Fix ->
   *      zurueck zu 2.
   *
   * Browser-GPS war damit dauerhaft unbrauchbar: die Position sprang im
   * 5-Sekunden-Takt zwischen „live" und „verloren". Gemerkt hat es niemand,
   * weil `browserSource.test.ts` nur pruefte, dass die Typ-Unions existieren,
   * und die E2E-Zusicherung in `position.spec.ts` in einem
   * `if (sentPositions.length > 0)` stand -- also genau dann nicht prueft,
   * wenn nichts gesendet wurde.
   *
   * Die Erlaubnis haengt jetzt an `forced`, und das ist auch inhaltlich die
   * richtige Frage: `active` beschreibt, WER GERADE liefert (und wird durch
   * unser eigenes Senden wahr -- die alte Logik hat sich also selbst
   * stummgeschaltet), `forced` beschreibt, wer liefern DARF. Der Core setzt
   * dieselbe Regel serverseitig noch einmal durch (`isSourceSelectable`,
   * 409 SOURCE_NOT_SELECTABLE) -- diese Pruefung spart nur den Verkehr.
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
        const data = (await response.json()) as { forced?: string | null };
        const forced = data.forced ?? null;
        this.setSendingAllowed(forced === null || forced === 'browser');
      }
    } catch (err) {
      console.warn('[BrowserSource] Failed to check active source:', err);
      // Der Core weist einen unerwuenschten Fix ohnehin mit 409 ab. Bei einer
      // unbeantwortbaren Anfrage lieber senden als schweigen: ein verworfener
      // Fix ist folgenlos, eine stumme Navigation nicht.
      this.setSendingAllowed(true);
    }
  }

  /** Faellt die Sperre weg, wird der zurueckgehaltene Fix sofort nachgereicht
   *  -- sonst bliebe er bis zum naechsten `watchPosition`-Ereignis liegen,
   *  und bei stehendem Fahrzeug kann das dauern. */
  private setSendingAllowed(allowed: boolean): void {
    const wasBlocked = !this.sendingAllowed;
    this.sendingAllowed = allowed;
    if (allowed && wasBlocked) {
      void this.flushQueue();
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
      !this.sendingAllowed
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
