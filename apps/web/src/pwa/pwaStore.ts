/**
 * PWA runtime store (E07-T5): holds the live "is a new build available?"
 * flag and the current speed (mirrored from `usePositionStore`, same pattern
 * as `drive/driveLockStore.ts`'s own `speedMps` mirror -- kept here so
 * `UpdatePrompt.tsx` re-renders on a speed change without needing its own
 * `usePositionStore` subscription too), and owns the actual `updateSW()`
 * function handed to it by `registerServiceWorker.ts` once the SW has
 * registered.
 *
 * Deliberately holds NO reference to `virtual:pwa-register` itself (only a
 * plain `(reloadPage?: boolean) => Promise<void>` function value) --
 * `registerServiceWorker.ts` is the only module that touches that virtual
 * import (see its doc comment for why: it's only resolvable inside a real
 * Vite build/dev graph, and this store is imported by `App.tsx`/
 * `UpdatePrompt.tsx`, which ARE part of `App.test.tsx`'s import graph under
 * plain Vitest).
 *
 * `reloadNow()` note: with `registerType: 'autoUpdate'` (vite.config.ts),
 * `vite-plugin-pwa`'s `registerSW()`-returned function is a no-op once a new
 * SW has already activated (the new SW `skipWaiting`s itself automatically
 * -- see `registerServiceWorker.ts`'s `onNeedReload` doc comment) -- the
 * actual page reload is THIS store's own `window.location.reload()`.
 */
import { create } from 'zustand';
import { usePositionStore } from '../position/positionStore.js';

interface PwaStoreState {
  /** True once a new Service Worker has taken over (or is about to) and the
   *  currently-running app build is stale -- set by `onNeedReload`
   *  (`registerServiceWorker.ts`). */
  updateAvailable: boolean;
  /** True once the SW confirms the app shell is fully cached for offline use. */
  offlineReady: boolean;
  /** Mirrors `usePositionStore`'s `position.speed`, see file doc comment. */
  speedMps: number | null;

  setUpdateAvailable: (updateAvailable: boolean) => void;
  setOfflineReady: (offlineReady: boolean) => void;
  /** Reloads now, applying the pending update. Callers (`UpdatePrompt.tsx`)
   *  MUST gate this behind `reloadGate.ts#shouldPromptReload` themselves --
   *  this action does not re-check speed, it just does what it's told. */
  reloadNow: () => void;

  /** @internal wired by `registerServiceWorker.ts` once `virtual:pwa-register`'s `registerSW()` resolves. */
  _setUpdateSWFn: (fn: ((reloadPage?: boolean) => Promise<void>) | null) => void;
  /** @internal wired by the module-scope `usePositionStore` subscription below. */
  _setSpeedMps: (speedMps: number | null) => void;
  _updateSWFn: ((reloadPage?: boolean) => Promise<void>) | null;
}

export const usePwaStore = create<PwaStoreState>((set, get) => ({
  updateAvailable: false,
  offlineReady: false,
  speedMps: null,
  _updateSWFn: null,

  setUpdateAvailable: (updateAvailable) => set({ updateAvailable }),
  setOfflineReady: (offlineReady) => set({ offlineReady }),

  reloadNow: () => {
    const doReload = (): void => {
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    };
    const updateSW = get()._updateSWFn;
    if (updateSW) {
      // Best-effort: harmless/no-op in `autoUpdate` mode (see file doc
      // comment), but calling it first is still the documented contract.
      void updateSW(true).finally(doReload);
    } else {
      doReload();
    }
  },

  _setUpdateSWFn: (fn) => set({ _updateSWFn: fn }),
  _setSpeedMps: (speedMps) => set({ speedMps }),
}));

if (typeof window !== 'undefined') {
  usePwaStore.getState()._setSpeedMps(usePositionStore.getState().position?.speed ?? null);
  usePositionStore.subscribe((state) => {
    usePwaStore.getState()._setSpeedMps(state.position?.speed ?? null);
  });
}

declare global {
  interface Window {
    /** Debug/E2E hook, mirrors `window.__yapajaDriveLockStore`/`__yapajaThemeStore`. */
    __yapajaPwaStore?: typeof usePwaStore;
  }
}

if (typeof window !== 'undefined') {
  window.__yapajaPwaStore = usePwaStore;
}
