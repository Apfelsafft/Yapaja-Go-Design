/**
 * The Speed-Lock store (E07-T4): wires the pure logic in `driveLock.ts` to
 * real time (`Date.now()`/`setInterval`), the live position
 * (`position/positionStore.js`), and persistence (`driveLockClient.ts` for
 * the threshold, `sessionStorage` for the passenger-override "remembered
 * for the session" requirement).
 *
 * SESSION-REMEMBER: once the passenger-override countdown elapses,
 * `passengerOverride.active` is written to `sessionStorage` (not
 * `localStorage`) -- `sessionStorage` is exactly "remembered for the
 * session" (cleared when the tab/browser session ends), and it's read back
 * synchronously at module load so the override survives a surface being
 * closed and reopened (or even a `page.reload()` within the same tab
 * session) without waiting on any async round-trip.
 *
 * Mirrors `theme/themeStore.ts`'s "module-scope side effect on load" pattern
 * for wiring a live subscription (there: applying the initial theme
 * resolution before React mounts; here: subscribing to `usePositionStore` so
 * `speedMps` is always current, independent of whether any component
 * happens to be mounted/subscribed to this store yet).
 */

import { create } from 'zustand';
import {
  DEFAULT_DRIVE_LOCK_KMH,
  INITIAL_PASSENGER_OVERRIDE_STATE,
  cancelPassengerCountdown,
  isControlLocked,
  isSpeedLocked,
  remainingCountdownMs,
  startPassengerCountdown,
  tickPassengerCountdown,
  type DriveControlId,
  type PassengerOverrideState,
} from './driveLock.js';
import { loadDriveLockThresholdKmh, patchServerDriveLockThresholdKmh, saveLocalDriveLockThresholdKmh } from './driveLockClient.js';
import { usePositionStore } from '../position/positionStore.js';

const SESSION_STORAGE_KEY = 'yapaja:driveLock:passengerOverride';
/** How often the countdown is re-checked against the real clock -- well
 *  under 1s so the 5-second countdown UI feels responsive and the
 *  activation itself never lags visibly behind the real elapsed time. */
const COUNTDOWN_TICK_MS = 200;

function loadSessionOverrideActive(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(SESSION_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveSessionOverrideActive(active: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (active) {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, 'true');
    } else {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Storage full/unavailable -- best-effort, mirrors driveLockClient.ts.
  }
}

interface DriveLockStoreState {
  thresholdKmh: number;
  ready: boolean;
  /** Mirrors `usePositionStore`'s `position.speed` -- kept here (rather than
   *  read fresh from `usePositionStore` at every call site) so this store's
   *  own subscribers re-render on a speed change without every consumer
   *  needing its own `usePositionStore` subscription too. */
  speedMps: number | null;
  passengerOverride: PassengerOverrideState;
  /** `null` while no countdown is running; ticks down to 0 while one is. */
  countdownRemainingMs: number | null;

  /** Boot-time load of the persisted threshold (local cache + server). */
  init: () => Promise<void>;
  setThresholdKmh: (thresholdKmh: number) => void;
  /** Starts the 5-second "Ich bin Beifahrer" countdown. */
  startPassengerOverride: () => void;
  /** Cancels an in-progress countdown (e.g. the locked panel is closed
   *  before the 5s elapse) without deactivating an already-active override. */
  cancelPassengerOverrideCountdown: () => void;
  /** Whether `controlId` is currently locked, given the live speed/threshold/override. */
  isLocked: (controlId: DriveControlId) => boolean;

  /** @internal wired by the module-scope `usePositionStore` subscription below. */
  _setSpeedMps: (speedMps: number | null) => void;
}

let countdownTimer: ReturnType<typeof setInterval> | null = null;

function stopCountdownTimer(): void {
  if (countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

export const useDriveLockStore = create<DriveLockStoreState>((set, get) => ({
  thresholdKmh: DEFAULT_DRIVE_LOCK_KMH,
  ready: false,
  speedMps: null,
  passengerOverride: { ...INITIAL_PASSENGER_OVERRIDE_STATE, active: loadSessionOverrideActive() },
  countdownRemainingMs: null,

  init: async () => {
    const thresholdKmh = await loadDriveLockThresholdKmh();
    set({ thresholdKmh, ready: true });
  },

  setThresholdKmh: (thresholdKmh) => {
    set({ thresholdKmh });
    saveLocalDriveLockThresholdKmh(thresholdKmh);
    void patchServerDriveLockThresholdKmh(thresholdKmh);
  },

  startPassengerOverride: () => {
    const now = Date.now();
    set((state) => ({ passengerOverride: startPassengerCountdown(state.passengerOverride, now) }));
    set({ countdownRemainingMs: remainingCountdownMs(get().passengerOverride, now) });

    stopCountdownTimer();
    countdownTimer = setInterval(() => {
      const tickNow = Date.now();
      const before = get().passengerOverride;
      const after = tickPassengerCountdown(before, tickNow);
      if (after !== before) {
        set({ passengerOverride: after, countdownRemainingMs: remainingCountdownMs(after, tickNow) });
        if (after.active) {
          saveSessionOverrideActive(true);
          stopCountdownTimer();
        }
      } else {
        set({ countdownRemainingMs: remainingCountdownMs(after, tickNow) });
      }
    }, COUNTDOWN_TICK_MS);
  },

  cancelPassengerOverrideCountdown: () => {
    stopCountdownTimer();
    set((state) => ({
      passengerOverride: cancelPassengerCountdown(state.passengerOverride),
      countdownRemainingMs: null,
    }));
  },

  isLocked: (controlId) => {
    const { speedMps, thresholdKmh, passengerOverride } = get();
    return isControlLocked(controlId, { speedMps, thresholdKmh, passengerOverrideActive: passengerOverride.active });
  },

  _setSpeedMps: (speedMps) => set({ speedMps }),
}));

/** Convenience selector-hook: is the vehicle currently above the configured
 *  Speed-Lock threshold at all (ignoring any passenger override)? Used by
 *  the search field's favorites-quick-select collapse, which -- per docs/06
 *  §4 -- happens purely off the raw speed/threshold, not `isControlLocked`
 *  (search isn't one of the "complex dialogs", it's a display-mode switch;
 *  see `SearchBar.tsx`). The passenger override still applies via
 *  `isControlLocked('search-full', ...)`, which callers that need the FULL
 *  gated decision should use instead. */
export function useIsSpeedLocked(): boolean {
  return useDriveLockStore((state) => isSpeedLocked(state.speedMps, state.thresholdKmh));
}

/** Convenience selector-hook for a single control/surface's live lock state. */
export function useIsControlLocked(controlId: DriveControlId): boolean {
  return useDriveLockStore((state) =>
    isControlLocked(controlId, {
      speedMps: state.speedMps,
      thresholdKmh: state.thresholdKmh,
      passengerOverrideActive: state.passengerOverride.active,
    }),
  );
}

declare global {
  interface Window {
    /** Debug/E2E hook, mirrors `window.__yapajaPositionStore`/`__yapajaThemeStore`. */
    __yapajaDriveLockStore?: typeof useDriveLockStore;
  }
}

if (typeof window !== 'undefined') {
  window.__yapajaDriveLockStore = useDriveLockStore;
  // Keep `speedMps` current independent of whether any component is
  // currently mounted/subscribed -- mirrors `themeStore.ts`'s "apply the
  // best-effort initial state at module load" rationale, just for a plain
  // value mirror instead of a themed side effect.
  useDriveLockStore.getState()._setSpeedMps(usePositionStore.getState().position?.speed ?? null);
  usePositionStore.subscribe((state) => {
    useDriveLockStore.getState()._setSpeedMps(state.position?.speed ?? null);
  });
}
