/**
 * ViewMode Controller and Store (E01-T3)
 *
 * Manages three view modes:
 * - 2d-north: pitch 0, bearing 0 (locked, ignores heading updates)
 * - 2d-course: pitch 0, bearing = current heading from position
 * - 3d-course: pitch 55, bearing = current heading
 *
 * State is persisted to localStorage (key: yapaja.viewMode).
 * View mode switching animates the camera transition (300ms).
 */

import { create } from 'zustand';
import { mapController, type CameraOptions } from '../state/mapStore';
import { usePositionStore } from '../position/positionStore';
import { anglesMatch } from './angles.js';
import { useFollowMeStore } from './followMe.js';

export type ViewMode = '2d-north' | '2d-course' | '3d-course';

const STORAGE_KEY = 'yapaja.viewMode';
const ANIMATION_DURATION = 300;

/**
 * Ab welchem Unterschied die Karte ueberhaupt nachgedreht wird.
 *
 * Der Wert stand vorher zweimal als `0.1` im Code. Er ist nicht nur eine
 * Frage der Ruhe im Bild, sondern die ABBRUCHBEDINGUNG des Nachfuehrens --
 * siehe `angles.ts`. Deshalb hat er jetzt einen Namen und eine Stelle.
 */
export const BEARING_TOLERANCE_DEG = 0.1;

// Camera parameters for each mode
const MODE_PARAMS: Record<ViewMode, Pick<CameraOptions, 'pitch'>> = {
  '2d-north': { pitch: 0 },
  '2d-course': { pitch: 0 },
  '3d-course': { pitch: 55 },
};

interface ViewModeState {
  /** Current view mode */
  mode: ViewMode;
  /** Set view mode and animate camera transition */
  setMode: (mode: ViewMode) => void;
  /** Restore persisted mode from localStorage (called on app init) */
  restoreMode: () => void;
  /** Persist current mode to localStorage */
  persistMode: () => void;
}

export const useViewModeStore = create<ViewModeState>((set, get) => ({
  mode: '2d-north',

  setMode: (newMode: ViewMode) => {
    const { mode: currentMode } = get();
    if (currentMode === newMode) {
      return; // No-op if already in that mode
    }

    set({ mode: newMode });
    applyViewMode(newMode);
    get().persistMode();
  },

  restoreMode: () => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY) as ViewMode | null;
      if (stored && ['2d-north', '2d-course', '3d-course'].includes(stored)) {
        set({ mode: stored });
        applyViewMode(stored);
      }
    } catch (err) {
      console.warn('[ViewModeStore] Failed to restore mode from localStorage:', err);
    }
  },

  persistMode: () => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const { mode } = get();
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch (err) {
      console.warn('[ViewModeStore] Failed to persist mode to localStorage:', err);
    }
  },
}));

/**
 * Apply the view mode to the map camera.
 * For course modes, reads current heading from positionStore.
 */
function applyViewMode(mode: ViewMode): void {
  const map = mapController.getMap();
  if (!map) {
    return;
  }

  const params = MODE_PARAMS[mode];
  const camera: CameraOptions = { ...params };

  // For course modes, read current heading
  if (mode === '2d-course' || mode === '3d-course') {
    const position = usePositionStore.getState().position;
    if (position?.heading !== null && position?.heading !== undefined) {
      camera.bearing = position.heading;
    }
  } else if (mode === '2d-north') {
    // 2d-north: always bearing 0
    camera.bearing = 0;
  }

  mapController.setCamera(camera, { animate: true, duration: ANIMATION_DURATION });
}

/**
 * Hook to get current view mode
 */
export function useViewMode(): ViewMode {
  return useViewModeStore((state) => state.mode);
}

/**
 * Hook to set view mode (call this from UI buttons)
 */
export function useSetViewMode(): (mode: ViewMode) => void {
  return useViewModeStore((state) => state.setMode);
}

/**
 * Update bearing when position heading changes (for course modes).
 * Call this from a useEffect in a component that listens to position updates.
 */
export function syncHeadingToBearing(): void {
  const mode = useViewModeStore.getState().mode;
  const map = mapController.getMap();

  if (!map) {
    return; // Map not ready
  }

  // For 2d-north mode: enforce bearing = 0 always
  if (mode === '2d-north') {
    if (!anglesMatch(map.getBearing(), 0, BEARING_TOLERANCE_DEG)) {
      mapController.setCamera({ bearing: 0 });
    }
    return;
  }

  // ─── KURS-MODI: WER DREHT, WENN DIE VERFOLGUNG LAEUFT ─────────────────────
  // Niemand ausser der Verfolgung selbst. `followMe.ts` nimmt den Winkel seit
  // 0.6.8 in DERSELBEN animierten Kamerafahrt mit wie die Mitte.
  //
  // Diese Funktion haengt an `rotate`/`moveend` -- also auch am ENDE jeder
  // dieser Fahrten. Wuerde sie dort erneut drehen, taete sie es mit einem
  // Sprung, und der naechste Takt begaenne mit einer abgebrochenen Bewegung.
  // Genau daran lag „die Karte zieht in groben Schritten nach": gemessen
  // blieb von 111 m Weg genau 0 uebrig, sobald sich der Kurs mit aenderte.
  //
  // Sie bleibt fuer den Fall, dass die Verfolgung NICHT laeuft (abgeschaltet
  // oder nach einem manuellen Schwenk pausiert): dann gehoert die Kamera dem
  // Menschen, und gedreht wird gar nicht.
  const { isFollowing, isPaused } = useFollowMeStore.getState();
  if (isFollowing && !isPaused) return;

  // Die Abfrage rechnet auf dem KREIS, nicht auf der Zahlengeraden. Vorher
  // stand hier `Math.abs(currentBearing - position.heading) > 0.1` -- und
  // weil MapLibre den Kartenwinkel gewickelt speichert (200 wird zu -160,
  // gemessen), waren das bei Kurs 200 volle 360 Grad Unterschied. Die Abfrage
  // sollte die Rueckkopplung verhindern, die sie dadurch ausloeste, bis der
  // Aufrufstapel voll war: der Absturz „Maximum call stack size exceeded."
  // aus 0.6.4. Siehe `angles.ts`.
  const position = usePositionStore.getState().position;
  if (position?.heading !== null && position?.heading !== undefined) {
    if (!anglesMatch(map.getBearing(), position.heading, BEARING_TOLERANCE_DEG)) {
      mapController.setCamera({ bearing: position.heading });
    }
  }
}
