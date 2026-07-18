/**
 * The one place that actually mutates the DOM/`styleStore` for a resolved
 * theme (E07-T3 acceptance criterion 2: UI + map switch together, atomically
 * -- no frame where one lags the other). Whenever `syncMapStyle` is true,
 * both mutations below happen synchronously, one after the other, with no
 * `await`/microtask boundary in between -- so they land in the SAME paint.
 *
 * Tailwind is configured `darkMode: 'class'` (`apps/web/tailwind.config.js`)
 * specifically so this function is the single source of truth for dark
 * mode -- every existing `dark:` variant across the app now follows the
 * `dark` class on `<html>` (set here, UNCONDITIONALLY on every call --
 * there is no pre-existing, independently-persisted "UI theme" state to
 * protect, unlike the map style below) rather than the OS
 * `prefers-color-scheme` media query it used to follow.
 *
 * `syncMapStyle` (decided by `themeStore.ts#tick` -- see its doc comment for
 * the exact rule): the map STYLE, unlike the UI class, already had its own
 * independently-persisted user choice before this task existed (E01-T4's
 * Style Panel, `state/styleStore.ts`). Blindly overwriting that on every
 * tick would silently discard a legitimate prior choice (e.g. reload right
 * after picking "yapaja-dark" while it happens to be daytime) -- so a
 * caller only passes `syncMapStyle: true` on a genuine theme TRANSITION
 * (or the very first-ever tick starting from the untouched default style),
 * never on a quiet re-check that didn't actually change anything.
 *
 * Contrast-style decision (task's explicit "make a sensible, documented
 * decision" ask): only `yapaja-light` <-> `yapaja-dark` are theme-coupled.
 * If the user has manually picked `yapaja-contrast` in the Style Panel, that
 * is a deliberate, legitimate manual choice orthogonal to light/dark theming
 * (docs/06 §3 only mandates coupling "Karten-Style (light<->dark)", never
 * mentioning contrast) -- so the theme controller must never pull the map
 * back to light/dark out from under a user who chose contrast, even on a
 * genuine transition. Picking `yapaja-light`/`yapaja-dark` again (via the
 * Style Panel) immediately resumes coupling, since the current style id is
 * then one of the two coupled ids again.
 */

import type { MapStyleId, ThemeResolution } from './resolveTheme.js';
import { useStyleStore } from '../state/styleStore.js';

const CONTRAST_STYLE_ID = 'yapaja-contrast';

function setDarkClass(isDark: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', isDark);
}

function setMapStyleId(styleId: MapStyleId): void {
  const current = useStyleStore.getState().styleId;
  if (current === CONTRAST_STYLE_ID) {
    // Leave the user's manual contrast choice alone -- see doc comment above.
    return;
  }
  if (current !== styleId) {
    useStyleStore.getState().setStyleId(styleId);
  }
}

export interface ApplyThemeResolutionOptions {
  /** Whether to also (re)write the coupled map style id -- see the module
   *  doc comment. The UI `dark` class is always applied regardless. */
  syncMapStyle: boolean;
}

/** Applies a `ThemeResolution` to the live document + (conditionally) the
 *  style store, atomically. */
export function applyThemeResolution(resolution: ThemeResolution, options: ApplyThemeResolutionOptions): void {
  setDarkClass(resolution.theme === 'dark');
  if (options.syncMapStyle) {
    setMapStyleId(resolution.styleId);
  }
}
