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

export type ViewMode = '2d-north' | '2d-course' | '3d-course';

const STORAGE_KEY = 'yapaja.viewMode';
const ANIMATION_DURATION = 300;

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
    const currentBearing = map.getBearing();
    if (Math.abs(currentBearing) > 0.1) {
      mapController.setCamera({ bearing: 0 });
    }
    return;
  }

  // For course modes: update bearing from position heading. Guard with an
  // epsilon so a programmatic setCamera doesn't re-trigger itself via the
  // rotate/moveend listener (no feedback loop).
  const position = usePositionStore.getState().position;
  if (position?.heading !== null && position?.heading !== undefined) {
    const currentBearing = map.getBearing();
    if (Math.abs(currentBearing - position.heading) > 0.1) {
      mapController.setCamera({ bearing: position.heading });
    }
  }
}
