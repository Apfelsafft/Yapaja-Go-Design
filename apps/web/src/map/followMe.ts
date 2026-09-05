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

import { autoZoomFor, shouldApplyZoom } from './autoZoom.js';
import { useNavStore } from '../drive/navStore.js';
import { isDriveActive } from '../drive/driveActive.js';
const PAUSE_DURATION = 10_000; // 10 seconds

/**
 * Mindest-Zoomstufe, auf die der Zurück-zur-Position-Knopf heranholt.
 *
 * 15 ist eine Stufe näher als die Zielsuche (`SEARCH_FLY_TO_ZOOM = 14`, dort
 * geht es um „wo liegt der Ort"), denn hier geht es um „wo stehe ich" — auf
 * 15 sind einzelne Straßen und ihre Namen zu erkennen. Weiter heran wäre für
 * eine Übersicht der nächsten Abzweigung schon zu eng.
 */
export const RECENTER_MIN_ZOOM = 15;

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

  // ─── ZOOM: HERAN, ABER NIE WEG ────────────────────────────────────────────
  // Nur zu zentrieren war zu wenig: wer über die Karte gewandert ist, hat
  // meist auch herausgezoomt und landet dann zwar an der richtigen Stelle,
  // aber in einer Übersicht, in der die eigene Straße nicht zu erkennen ist.
  //
  // `Math.max` und nicht ein fester Wert: wer bereits NÄHER dran ist, würde
  // sonst beim Zurückkehren hinausgezoomt — eine Bewegung, die niemand
  // angefordert hat und die im Fahrzeug besonders stört. Der Knopf holt also
  // heran, wenn nötig, und lässt sonst in Ruhe.
  const current = mapController.getMap()?.getZoom();
  const zoom =
    typeof current === 'number' && Number.isFinite(current)
      ? Math.max(current, RECENTER_MIN_ZOOM)
      : RECENTER_MIN_ZOOM;

  mapController.setCamera({ center: [position.lon, position.lat], zoom });
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
  if (!position) return;

  // ─── AUTOMATISCHER ZOOM (0.5.7) ───────────────────────────────────────────
  // Bewusst HIER und nicht als eigener Beobachter: an dieser Stelle ist die
  // Frage „darf die Kamera ueberhaupt bewegt werden?" bereits beantwortet.
  // Ein zweiter Weg zur Kamera muesste dieselbe Pruefung noch einmal treffen
  // -- und irgendwann treffen zwei Pruefungen unterschiedliche Antworten.
  //
  // Der manuelle Schwenk pausiert Follow-Me fuer 10 s (siehe oben) und
  // schaltet damit auch den Auto-Zoom ab. Das ist die Zusicherung, die diese
  // Funktion braucht: der Mensch gewinnt immer.
  const zoom = nextAutoZoom();

  mapController.setCamera(
    zoom === null
      ? { center: [position.lon, position.lat] }
      : { center: [position.lon, position.lat], zoom },
  );
}

/**
 * Die Zoomstufe, auf die der Auto-Zoom stellen soll -- oder `null` fuer
 * „unveraendert lassen".
 *
 * Nur waehrend einer laufenden Fahrt: ausserhalb hat niemand eine Anweisung
 * gegeben, die eine Kamerabewegung rechtfertigt.
 */
function nextAutoZoom(): number | null {
  const navState = useNavStore.getState().navState;
  if (!isDriveActive(navState?.status)) return null;

  const target = autoZoomFor({
    speedKmh: navState?.speed_kmh,
    distanceToManeuverM: navState?.distance_to_maneuver_m,
  });
  if (target === null) return null;

  return shouldApplyZoom(mapController.getMap()?.getZoom(), target) ? target : null;
}
