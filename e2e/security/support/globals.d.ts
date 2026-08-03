/**
 * The two `window` hooks the browser-side vectors touch, declared LOCALLY and
 * STRUCTURALLY.
 *
 * Deliberately NOT re-using `apps/web/e2e/support/global.d.ts`: that file
 * imports the real store modules, which would drag all of `apps/web/src` into
 * this suite's tsc program (and with it Vite's `import.meta.env`, the
 * `@yapaja/ui` path alias, ...). The security suite only needs "is this map
 * layer present" and "reconcile the add-on list now", so the minimal
 * structural shape is both sufficient and more honest about the coupling.
 */

declare global {
  interface Window {
    __yapajaMapController?: {
      getMap?: () => {
        getSource(id: string): unknown;
        getLayer(id: string): unknown;
      } | null;
    };
    __yapajaRefreshAddons?: () => Promise<void>;
  }
}

export {};
