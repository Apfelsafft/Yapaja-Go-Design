/**
 * Bootstraps the Service Worker (E07-T5) -- called ONCE from `main.tsx`.
 *
 * Deliberately NOT imported by `App.tsx`/`pwaStore.ts`/`UpdatePrompt.tsx`
 * (only `main.tsx` calls `initServiceWorker()`), and reaches
 * `virtual:pwa-register` via a runtime `import()` rather than a static one:
 * that virtual module is synthesized by the `vite-plugin-pwa` Vite plugin
 * and only resolvable inside an actual Vite build/dev module graph. The
 * repo's root `vitest.config.ts` does NOT load that plugin (or even
 * `@vitejs/plugin-react` -- see its own comment), so a static import here
 * would break `npx vitest run` the instant anything in `App.tsx`'s import
 * graph pulled this module in transitively. A dynamic `import()` is only
 * ever evaluated when `initServiceWorker()` actually RUNS, which never
 * happens under Vitest (nothing calls it there). Also guarded by
 * `typeof window`/`'serviceWorker' in navigator`, mirroring every other
 * module-scope browser-API bootstrap in this codebase (e.g.
 * `drive/driveLockStore.ts`).
 *
 * Update flow (E07-T5 task requirement: "Update-Strategie `autoUpdate` mit
 * Reload-Prompt im Stand, nie während Fahrt!"): `registerType: 'autoUpdate'`
 * (`vite.config.ts`) makes the generated SW `skipWaiting`+`clientsClaim`
 * itself the moment it finishes installing -- no user action needed for the
 * new SW to take over future fetches. `vite-plugin-pwa`'s own register
 * script would normally follow that up with an IMMEDIATE, silent
 * `window.location.reload()` the moment the new SW activates (see
 * `node_modules/vite-plugin-pwa/dist/client/build/register.ts`'s `auto`
 * branch) -- exactly the "reload mid-drive" this task must never allow.
 * Passing `onNeedReload` intercepts that: instead of reloading immediately,
 * it only flips `pwaStore.updateAvailable`, and `UpdatePrompt.tsx` -- gated
 * by `reloadGate.ts#shouldPromptReload` (never while driving) -- is the only
 * thing that ever actually calls `pwaStore.reloadNow()`.
 */
import { usePwaStore } from './pwaStore.js';

export function initServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }
  void import('virtual:pwa-register')
    .then(({ registerSW }) => {
      const updateSW = registerSW({
        immediate: true,
        onNeedReload() {
          usePwaStore.getState().setUpdateAvailable(true);
        },
        onOfflineReady() {
          usePwaStore.getState().setOfflineReady(true);
        },
        onRegisterError(err: unknown) {
          console.warn('[pwa] service worker registration failed:', err);
        },
      });
      usePwaStore.getState()._setUpdateSWFn(updateSW);
    })
    .catch((err: unknown) => {
      console.warn('[pwa] could not load the service worker register module:', err);
    });
}
