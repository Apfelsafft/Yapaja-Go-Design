/**
 * The theme store (E07-T3): holds the persisted MODE (light/dark/auto), any
 * active manual override, and the current resolution -- wiring
 * `resolveTheme.ts`'s pure logic to real time/position and applying the
 * result via `applyThemeResolution.ts`.
 *
 * `tick()` is the ONLY place `resolveTheme` is called with a live `Date`;
 * everything it delegates to remains pure and independently unit-testable
 * (`resolveTheme.test.ts`, `sunResolution.test.ts`) without touching this
 * store at all.
 *
 * MAP-STYLE SYNC RULE (`shouldSyncMapStyle` below) -- when a resolution is
 * allowed to (re)write the coupled `yapaja-light`/`yapaja-dark` map style,
 * vs. leaving whatever is currently applied alone:
 *   - The very FIRST tick this store ever runs (`lastAppliedTheme === null`,
 *     e.g. right after a page load): only if the CURRENT map style is still
 *     the untouched built-in default (`yapaja-light`) -- i.e. nothing
 *     indicates the user (or a previous session) deliberately chose
 *     something else. A persisted `yapaja-dark`/`yapaja-contrast` from a
 *     prior explicit choice (E01-T4's Style Panel, independent of this
 *     task) is left alone on this very first tick.
 *   - Every tick after that: only when the resolved theme actually CHANGED
 *     from the last one this store applied -- a genuine transition, which
 *     is exactly what docs/06 §3's "Wechsel setzt UI-Theme UND Karten-Style
 *     ... atomar" ("a SWITCH sets both, atomically") describes. A quiet
 *     re-check that lands on the same theme as before never touches the
 *     map style, so it can never fight a manual pick made in between two
 *     ticks either.
 *   - Switching the MODE itself (`setMode`) or creating a manual override
 *     (`setManualTheme`) both call `tick()` immediately afterwards, so a
 *     deliberate user action still applies (and syncs the map style, if the
 *     resulting theme differs from what was last applied) right away --
 *     there is no special-casing needed for "explicit mode" vs "auto" here,
 *     the plain "did the theme change" rule covers it.
 */

import { create } from 'zustand';
import { applyThemeResolution } from './applyThemeResolution.js';
import {
  createOverride,
  resolveTheme,
  type GeoPosition,
  type ResolvedTheme,
  type ThemeMode,
  type ThemeOverride,
  type ThemeResolution,
} from './resolveTheme.js';
import { DEFAULT_THEME_MODE, loadThemeMode, patchServerThemeMode, saveLocalThemeMode } from './themeClient.js';
import { useStyleStore } from '../state/styleStore.js';
import { DEFAULT_STYLE_ID } from '../map/styleClient.js';

interface ThemeStoreState {
  mode: ThemeMode;
  override: ThemeOverride | null;
  resolution: ThemeResolution;
  ready: boolean;
  /** The theme this store last actually APPLIED (as opposed to merely
   *  resolved) -- `null` until the first `tick()` ever runs. Drives the
   *  map-style sync rule described in the module doc comment above. */
  lastAppliedTheme: ResolvedTheme | null;

  /** Boot-time load of the persisted mode (local cache + server, see
   *  `themeClient.ts`), then an immediate first `tick()`. */
  init: () => Promise<void>;
  /** Sets the theme MODE (persists local + server). An explicit `light`/
   *  `dark` mode has no override to hold -- switching TO `auto` clears any
   *  stale override from a previous `auto` session so it starts fresh. */
  setMode: (mode: ThemeMode) => void;
  /** Manually picks light/dark while `mode` is (or becomes) `auto` --
   *  creates a hold-until-next-boundary override (docs/06 §3). Switching
   *  mode to an explicit `light`/`dark` instead of calling this is also
   *  valid and simpler (no override machinery involved at all). */
  setManualTheme: (theme: 'light' | 'dark', now?: Date, position?: GeoPosition | null) => void;
  /** Recomputes the resolution for `now`/`position` and applies it
   *  (document class always, map style conditionally -- see the module doc
   *  comment / `applyThemeResolution.ts`). */
  tick: (now?: Date, position?: GeoPosition | null) => void;
}

const initialResolution: ThemeResolution = resolveTheme({
  mode: DEFAULT_THEME_MODE,
  now: new Date(),
  position: null,
  override: null,
});

export const useThemeStore = create<ThemeStoreState>((set, get) => ({
  mode: DEFAULT_THEME_MODE,
  override: null,
  resolution: initialResolution,
  ready: false,
  lastAppliedTheme: null,

  init: async () => {
    const mode = await loadThemeMode();
    set({ mode, ready: true });
    get().tick();
  },

  setMode: (mode) => {
    const clearOverride = mode !== 'auto' || get().mode !== 'auto';
    set({ mode, override: clearOverride ? null : get().override });
    saveLocalThemeMode(mode);
    void patchServerThemeMode(mode);
    get().tick();
  },

  setManualTheme: (theme, now = new Date(), position) => {
    const pos = position !== undefined ? position : null;
    // Picking a manual light/dark implies auto mode with a fresh override
    // -- if the mode wasn't already `auto`, switch it (docs/06 §3's
    // override concept only exists within auto mode).
    const mode: ThemeMode = 'auto';
    const override = createOverride(theme, now, pos);
    set({ mode, override });
    saveLocalThemeMode(mode);
    void patchServerThemeMode(mode);
    get().tick(now, pos);
  },

  tick: (now = new Date(), position) => {
    const pos = position !== undefined ? position : null;
    const { mode, override, lastAppliedTheme } = get();
    const resolution = resolveTheme({ mode, now, position: pos, override });
    // An override that has just lapsed (now >= expiresAt) must be cleared
    // from state too, not just ignored by `resolveTheme` this one time --
    // otherwise a later `tick()` with a position but no override state
    // change would keep re-checking a stale, already-expired override.
    const clearedOverride = override && now.getTime() >= override.expiresAt ? null : override;

    const syncMapStyle =
      lastAppliedTheme === null
        ? useStyleStore.getState().styleId === DEFAULT_STYLE_ID
        : resolution.theme !== lastAppliedTheme;

    set({ resolution, override: clearedOverride, lastAppliedTheme: resolution.theme });
    applyThemeResolution(resolution, { syncMapStyle });
  },
}));

declare global {
  interface Window {
    /** Debug/E2E hook, mirrors `window.__yapajaPositionStore`/`__yapajaShellLayoutStore`. */
    __yapajaThemeStore?: typeof useThemeStore;
  }
}

if (typeof window !== 'undefined') {
  window.__yapajaThemeStore = useThemeStore;
  // Apply the best-effort initial resolution (default mode `light`, see
  // `themeClient.ts`'s doc comment on `DEFAULT_THEME_MODE`) as soon as this
  // module loads, BEFORE React mounts/`ThemeController`'s effect runs and
  // BEFORE the persisted mode round-trips -- minimizes the flash of an
  // unresolved/wrong theme on first paint. Goes through the real `tick()`
  // (not a one-off `applyThemeResolution` call) so the map-style sync rule
  // above is applied consistently from the very first tick onward.
  // `init()` (called by `ThemeController`) re-applies once the real
  // persisted mode is known.
  useThemeStore.getState().tick();
}
