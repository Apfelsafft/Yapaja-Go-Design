/**
 * Degradation Controller (E01-T6): Manages auto-degradation levels based on FPS,
 * with hysteresis and user override.
 *
 * Levels:
 * - 0: Full quality
 * - 1: 3D buildings off
 * - 2: POI/label density reduced
 * - 3: Force 2D (no 3D/tilt)
 *
 * Upgrade (more degradation) at < 25 fps over 10 s
 * Downgrade (less degradation) at > 45 fps over 60 s
 * Hysteresis: min 30 s between level changes (no flicker)
 * Override: "high" (0), "auto" (watchdog), "low" (3), persists to localStorage
 */

import { create } from 'zustand';
import { useStyleStore } from '../state/styleStore';
import { useViewModeStore } from '../map/viewMode';

export type DegradationLevel = 0 | 1 | 2 | 3;
export type QualityOverride = 'high' | 'auto' | 'low';

const STORAGE_KEY_OVERRIDE = 'yapaja.qualityOverride';

// Thresholds (fps and duration)
const UPGRADE_THRESHOLD_FPS = 25;
const UPGRADE_THRESHOLD_MS = 10000; // 10 seconds
const DOWNGRADE_THRESHOLD_FPS = 45;
const DOWNGRADE_THRESHOLD_MS = 60000; // 60 seconds
const HYSTERESIS_MS = 30000; // 30 seconds min between changes

interface FpsHistory {
  fps: number;
  timestamp: number;
}

interface DegradationState {
  /** Current degradation level */
  level: DegradationLevel;
  /** Override setting: 'high' (0), 'auto' (watchdog), 'low' (3) */
  override: QualityOverride;

  /** Internal: for hysteresis */
  _lastLevelChangeTime: number;
  /** Internal: FPS history for threshold detection */
  _fpsHistory: FpsHistory[];

  // Public actions
  setOverride: (override: QualityOverride) => void;
  updateFps: (fps: number, now: number) => void;
  applyLevel: (level: DegradationLevel) => void;

  // Restore persisted settings
  restoreSettings: () => void;
}

function persistOverride(override: QualityOverride): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY_OVERRIDE, override);
  } catch (err) {
    console.warn('[degrade] Failed to persist override:', err);
  }
}

function readPersistedOverride(): QualityOverride {
  if (typeof window === 'undefined') return 'auto';
  try {
    const val = window.localStorage.getItem(STORAGE_KEY_OVERRIDE);
    return (val === 'high' || val === 'low' ? val : 'auto') as QualityOverride;
  } catch {
    return 'auto';
  }
}

/**
 * Apply a degradation level to the map: viewMode, style options, 3D flag.
 * Calls existing controllers (viewMode, styleStore) instead of reloading style.
 */
function applyDegradationLevel(level: DegradationLevel): void {
  const styleStore = useStyleStore.getState();
  const viewModeStore = useViewModeStore.getState();

  if (level === 0) {
    // Full quality: allow 3D, full POI, full labels
    // (no explicit action — just ensure we're not degraded)
    if (viewModeStore.mode === '2d-north') {
      // User may prefer 2D-north; don't force 3D. Just allow it.
    }
    styleStore.setPoi('full');
    styleStore.setLabelScale('1.0');
  } else if (level === 1) {
    // 3D buildings off: keep POI/labels full
    // (user may still choose 3d-course view, we just don't render buildings)
    styleStore.setPoi('full');
    styleStore.setLabelScale('1.0');
  } else if (level === 2) {
    // Reduced POI/labels
    styleStore.setPoi('reduced');
    styleStore.setLabelScale('1.0');
  } else if (level === 3) {
    // Force 2D, minimal POI/labels
    viewModeStore.setMode('2d-north');
    styleStore.setPoi('off');
    styleStore.setLabelScale('1.0');
  }

  // TODO (E02/later): Add a flag like _buildings3dEnabled to the store,
  // so the style can respect it when level=1.
}

declare global {
  interface Window {
    /**
     * Debug/E2E hook: exposes the degradation store so Playwright can query
     * the current degradation level and override setting.
     */
    __yapajaDegrade?: {
      level: DegradationLevel;
      override: QualityOverride;
      setOverride: (override: QualityOverride) => void;
      updateFps: (fps: number, now: number) => void;
    };
  }
}

export const useDegradationStore = create<DegradationState>((set, get) => ({
  level: 0,
  override: 'auto',
  _lastLevelChangeTime: 0,
  _fpsHistory: [],

  setOverride: (override) => {
    set({ override });
    persistOverride(override);

    // Immediately apply the override level
    const newLevel: DegradationLevel =
      override === 'high' ? 0 : override === 'low' ? 3 : get().level;
    if (override !== 'auto') {
      get().applyLevel(newLevel);
      set({ level: newLevel, _lastLevelChangeTime: Date.now() });
    }
  },

  updateFps: (fps: number, now: number) => {
    const { override, level, _lastLevelChangeTime, _fpsHistory } = get();

    // If override is 'high' or 'low', ignore fps updates
    if (override === 'high') {
      return;
    }
    if (override === 'low') {
      return;
    }

    // Add to history
    const newHistory: FpsHistory[] = [..._fpsHistory, { fps, timestamp: now }];
    // Keep only entries within the max threshold window
    const maxHistoryMs = Math.max(UPGRADE_THRESHOLD_MS, DOWNGRADE_THRESHOLD_MS);
    const cutoff = now - maxHistoryMs;
    const trimmedHistory = newHistory.filter((e) => e.timestamp >= cutoff);

    set({ _fpsHistory: trimmedHistory });

    // Check hysteresis
    const timeSinceLastChange = now - _lastLevelChangeTime;
    if (timeSinceLastChange < HYSTERESIS_MS) {
      return; // Too soon for a level change
    }

    // Check for upgrade trigger (< 25 fps over 10 s)
    const upgradeWindow = now - UPGRADE_THRESHOLD_MS;
    const upgradeHistory = trimmedHistory.filter((e) => e.timestamp >= upgradeWindow);
    if (upgradeHistory.length >= 2) {
      const avgFps =
        upgradeHistory.reduce((sum, e) => sum + e.fps, 0) / upgradeHistory.length;
      if (avgFps < UPGRADE_THRESHOLD_FPS && level < 3) {
        const newLevel: DegradationLevel = (level + 1) as DegradationLevel;
        set({ level: newLevel, _lastLevelChangeTime: now });
        get().applyLevel(newLevel);
        console.warn(`[degrade] Upgraded to level ${newLevel} (fps: ${avgFps.toFixed(1)})`);
        // Emit a toast notification event
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('degradation-level-changed', {
              detail: { level: newLevel, direction: 'up', fps: avgFps },
            }),
          );
        }
        return;
      }
    }

    // Check for downgrade trigger (> 45 fps over 60 s)
    const downgradeWindow = now - DOWNGRADE_THRESHOLD_MS;
    const downgradeHistory = trimmedHistory.filter((e) => e.timestamp >= downgradeWindow);
    if (downgradeHistory.length >= 2) {
      const avgFps =
        downgradeHistory.reduce((sum, e) => sum + e.fps, 0) / downgradeHistory.length;
      if (avgFps > DOWNGRADE_THRESHOLD_FPS && level > 0) {
        const newLevel: DegradationLevel = (level - 1) as DegradationLevel;
        set({ level: newLevel, _lastLevelChangeTime: now });
        get().applyLevel(newLevel);
        console.warn(`[degrade] Downgraded to level ${newLevel} (fps: ${avgFps.toFixed(1)})`);
        // Emit a toast notification event
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('degradation-level-changed', {
              detail: { level: newLevel, direction: 'down', fps: avgFps },
            }),
          );
        }
        return;
      }
    }
  },

  applyLevel: (level: DegradationLevel) => {
    applyDegradationLevel(level);
  },

  restoreSettings: () => {
    const override = readPersistedOverride();
    set({ override });
    if (override === 'high') {
      set({ level: 0 });
      applyDegradationLevel(0);
    } else if (override === 'low') {
      set({ level: 3 });
      applyDegradationLevel(3);
    }
    // 'auto': keep current level (0 by default)
  },
}));

// Expose the degradation store to window for E2E testing
if (typeof window !== 'undefined') {
  window.__yapajaDegrade = {
    get level() {
      return useDegradationStore.getState().level;
    },
    get override() {
      return useDegradationStore.getState().override;
    },
    setOverride: (override: QualityOverride) => {
      useDegradationStore.getState().setOverride(override);
    },
    updateFps: (fps: number, now: number) => {
      useDegradationStore.getState().updateFps(fps, now);
    },
  };
}
