/**
 * Follow-Me Logic (E01-T3)
 *
 * Keeps the map camera centered on the current position when active.
 * Manual pan/drag by the user (detected via maplibregl dragstart/movestart events
 * with originalEvent set) pauses Follow for 10 seconds.
 *
 * Programmatic camera movements (from viewMode transitions, compass clicks, etc.)
 * do NOT count as manual pan and do not trigger pause.
 */

import { create } from 'zustand';
import { mapController } from '../state/mapStore';
import { usePositionStore } from '../position/positionStore';

const PAUSE_DURATION = 10_000; // 10 seconds

interface FollowMeState {
  /** Is Follow-Me actively enabled */
  isFollowing: boolean;
  /** Is Follow-Me temporarily paused (e.g., after user pan) */
  isPaused: boolean;
  /** Resume Follow-Me and clear pause state */
  resume: () => void;
  /** Pause Follow-Me for PAUSE_DURATION */
  pause: () => void;
  /** Enable/disable Follow-Me globally */
  setFollowing: (enabled: boolean) => void;
}

export const useFollowMeStore = create<FollowMeState>((set, get) => {
  let pauseTimer: number | null = null;

  return {
    isFollowing: true,
    isPaused: false,

    resume: () => {
      if (pauseTimer !== null) {
        if (typeof window !== 'undefined') {
          window.clearTimeout(pauseTimer);
        }
        pauseTimer = null;
      }
      set({ isPaused: false });
    },

    pause: () => {
      // Cancel existing timer
      if (pauseTimer !== null) {
        window.clearTimeout(pauseTimer);
      }

      set({ isPaused: true });

      // Auto-resume after PAUSE_DURATION
      if (typeof window !== 'undefined') {
        pauseTimer = window.setTimeout(() => {
          pauseTimer = null;
          get().resume();
        }, PAUSE_DURATION);
      }
    },

    setFollowing: (enabled: boolean) => {
      set({ isFollowing: enabled, isPaused: false });
      if (pauseTimer !== null) {
        if (typeof window !== 'undefined') {
          window.clearTimeout(pauseTimer);
        }
        pauseTimer = null;
      }
    },
  };
});

declare global {
  interface Window {
    /**
     * Debug/E2E-Zugriff, wie `__yapajaMapController` (map/MapView.tsx) und
     * `__yapajaPositionStore` (position/positionStore.ts): damit Playwright
     * den Pausen-Zustand direkt lesen kann, statt ihn aus der Sichtbarkeit
     * eines Knopfes zu erschliessen. Seit der Re-Center-Knopf nicht mehr an
     * der Pause haengt (0.3.3), waere dieser Umweg schlicht falsch.
     * Nur lesend gedacht -- Produktionscode geht weiter ueber die Hooks.
     */
    __yapajaFollowMeStore?: typeof useFollowMeStore;
  }
}

if (typeof window !== 'undefined') {
  window.__yapajaFollowMeStore = useFollowMeStore;
}

/**
 * Hooks
 */
export function useFollowMe(): boolean {
  return useFollowMeStore((state) => state.isFollowing && !state.isPaused);
}

export function useFollowMeIsPaused(): boolean {
  return useFollowMeStore((state) => state.isPaused);
}

export function useResumeFollowMe(): () => void {
  return useFollowMeStore((state) => state.resume);
}

/**
 * Initialize Follow-Me tracking:
 * - Listens for map dragstart/movestart with originalEvent to detect user pan
 *
 * Call this once in a useEffect in your main map component.
 * Position tracking is handled via useEffect hook in the component.
 */
export function initializeFollowMe(): () => void {
  const map = mapController.getMap();
  if (!map) {
    return () => {}; // Cleanup no-op if map not ready
  }

  // Handler for user pan/drag (dragstart/movestart with originalEvent)
  const handleUserInteraction = (e: Record<string, unknown>) => {
    // Only pause if it was a user interaction (originalEvent exists)
    if (e.originalEvent) {
      useFollowMeStore.getState().pause();
    }
  };

  // Listen to map drag/move events
  mapController.on('dragstart', handleUserInteraction);
  mapController.on('movestart', handleUserInteraction);

  // Cleanup function
  return () => {
    mapController.off('dragstart', handleUserInteraction);
    mapController.off('movestart', handleUserInteraction);
  };
}

/**
 * Zurück zur aktuellen Position — auf ausdrücklichen Wunsch, nicht als
 * Nebenwirkung.
 *
 * ─── WARUM DAS NICHT SCHON DA WAR ──────────────────────────────────────────
 * `updateFollowMePosition` zieht die Karte nur mit, wenn eine NEUE Position
 * eintrifft. Wer nach einer Suche über die Karte gewandert ist, wartet also
 * auf den nächsten Fix — bei der Companion App können das Minuten sein. Und
 * der Re-Center-Knopf erschien bis 0.3.2 nur nach einem MANUELLEN Schwenk:
 * `flyTo` aus der Suche ist eine programmatische Bewegung und pausiert
 * Follow-Me gerade nicht, der Knopf blieb also aus. Wer suchte, hatte keinen
 * Weg zurück außer selbst hinzuscrollen.
 *
 * Diese Funktion tut beides auf einmal: Pause aufheben UND sofort zentrieren.
 * `false`, wenn es gar keine Position gibt — dann gibt es auch nichts, wohin
 * man zurückkehren könnte, und der Knopf wird gar nicht erst angeboten.
 */
export function recenterOnPosition(): boolean {
  useFollowMeStore.getState().resume();
  const position = usePositionStore.getState().position;
  if (!position) {
    return false;
  }
  mapController.setCamera({ center: [position.lon, position.lat] });
  return true;
}

/**
 * Update map center to follow current position (if following and not paused).
 * Call this from a useEffect that depends on position updates.
 */
export function updateFollowMePosition(): void {
  const { isFollowing, isPaused } = useFollowMeStore.getState();
  if (!isFollowing || isPaused) {
    return;
  }

  const position = usePositionStore.getState().position;
  if (position) {
    mapController.setCamera({
      center: [position.lon, position.lat],
    });
  }
}
