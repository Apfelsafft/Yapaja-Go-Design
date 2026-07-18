/**
 * Unit tests for `themeStore.ts`: the store wiring that ties mode/override/
 * `resolveTheme` together and applies the result. Runs under Node
 * (`vitest.config.ts` `environment: 'node'`) -- `applyThemeResolution`'s
 * DOM-class side is a no-op here (no `document`), so these tests assert on
 * `resolution`/`styleStore` state, same scope as `applyThemeResolution.test.ts`.
 * `fetch` is stubbed per-test to keep `setMode`/`setManualTheme`'s
 * fire-and-forget server PATCH from hitting the network.
 *
 * Also covers the map-style sync rule (`themeStore.ts`'s module doc
 * comment): the very first tick only syncs the map style from the untouched
 * default, every tick after that only syncs on a genuine theme CHANGE --
 * this is what keeps a pre-existing `yapaja-dark` Style Panel pick (E01-T4,
 * unrelated to theming) surviving an unrelated reload/tick instead of being
 * silently reset back to whatever the current mode/time happens to resolve.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useThemeStore } from './themeStore.js';
import { useStyleStore } from '../state/styleStore.js';
import { DEFAULT_STYLE_ID, DEFAULT_STYLE_OPTIONS } from '../map/styleClient.js';

const STUTTGART = { lat: 48.7758, lon: 9.1829 };

describe('themeStore', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: {} }) }));
    useThemeStore.setState({ mode: 'auto', override: null, lastAppliedTheme: null });
    useStyleStore.setState({ styleId: DEFAULT_STYLE_ID, options: DEFAULT_STYLE_OPTIONS });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tick() resolves + applies atomically: a genuine theme CHANGE updates the styleStore in the SAME tick', () => {
    useThemeStore.getState().tick(new Date('2026-06-21T12:00:00Z'), STUTTGART); // day, first tick, default style -> syncs
    expect(useThemeStore.getState().resolution.theme).toBe('light');
    expect(useStyleStore.getState().styleId).toBe('yapaja-light');

    useThemeStore.getState().tick(new Date('2026-06-21T23:00:00Z'), STUTTGART); // night: a real transition
    expect(useThemeStore.getState().resolution.theme).toBe('dark');
    expect(useStyleStore.getState().styleId).toBe('yapaja-dark');

    useThemeStore.getState().tick(new Date('2026-06-21T12:00:00Z'), STUTTGART); // back to day: another real transition
    expect(useThemeStore.getState().resolution.theme).toBe('light');
    expect(useStyleStore.getState().styleId).toBe('yapaja-light');
  });

  it('the FIRST tick only syncs the map style when it is still the untouched default', () => {
    useStyleStore.getState().setStyleId('yapaja-dark'); // a pre-existing explicit pick, unrelated to theming
    useThemeStore.getState().tick(new Date('2026-06-21T12:00:00Z'), STUTTGART); // day -> would resolve light
    expect(useThemeStore.getState().resolution.theme).toBe('light'); // UI class still resolves correctly...
    expect(useStyleStore.getState().styleId).toBe('yapaja-dark'); // ...but the pre-existing map pick survives
  });

  it('a later tick still leaves an untouched-by-theme style alone as long as the theme does not change again', () => {
    useStyleStore.getState().setStyleId('yapaja-dark');
    useThemeStore.getState().tick(new Date('2026-06-21T12:00:00Z'), STUTTGART); // day, first tick: style survives (see above)
    useThemeStore.getState().tick(new Date('2026-06-21T12:05:00Z'), STUTTGART); // still day: no theme change
    expect(useStyleStore.getState().styleId).toBe('yapaja-dark'); // never touched
  });

  it('a genuine transition DOES override even a pre-existing style once the theme actually changes', () => {
    useStyleStore.getState().setStyleId('yapaja-dark');
    useThemeStore.getState().tick(new Date('2026-06-21T12:00:00Z'), STUTTGART); // day, first tick: survives
    useThemeStore.getState().tick(new Date('2026-06-21T23:00:00Z'), STUTTGART); // night: theme DID change (light->dark)
    expect(useStyleStore.getState().styleId).toBe('yapaja-dark'); // coupled again (coincidentally already dark, but via sync)

    useThemeStore.getState().tick(new Date('2026-06-22T12:00:00Z'), STUTTGART); // next day: dark->light, a real transition
    expect(useStyleStore.getState().styleId).toBe('yapaja-light');
  });

  it('setMode("dark") is a deliberate action: it applies (and syncs the map style) immediately via its own tick()', () => {
    useStyleStore.getState().setStyleId('yapaja-contrast'); // irrelevant here -- contrast is a separate exemption, see below
    useThemeStore.getState().setMode('dark');
    expect(useThemeStore.getState().resolution.theme).toBe('dark');
  });

  it('setMode("dark") followed by a later daylight tick still forces dark (explicit mode never reverts on its own)', () => {
    useThemeStore.getState().setMode('dark');
    useThemeStore.getState().tick(new Date('2026-06-21T12:00:00Z'), STUTTGART); // bright daylight -- irrelevant, mode is explicit
    expect(useThemeStore.getState().resolution.theme).toBe('dark');
    expect(useStyleStore.getState().styleId).toBe('yapaja-dark');
  });

  it('setManualTheme creates an override that holds through subsequent ticks until its boundary', () => {
    const pickedAt = new Date('2026-06-21T12:00:00Z'); // daytime, would auto-resolve light
    useThemeStore.getState().setManualTheme('dark', pickedAt, STUTTGART);

    expect(useThemeStore.getState().mode).toBe('auto');
    expect(useThemeStore.getState().override).not.toBeNull();
    expect(useThemeStore.getState().resolution.theme).toBe('dark');
    expect(useThemeStore.getState().resolution.overrideActive).toBe(true);
    expect(useStyleStore.getState().styleId).toBe('yapaja-dark'); // the override IS a transition -> synced immediately

    const expiresAt = useThemeStore.getState().override!.expiresAt;

    // A tick shortly after, still before the boundary: override still holds.
    useThemeStore.getState().tick(new Date(pickedAt.getTime() + 60_000), STUTTGART);
    expect(useThemeStore.getState().resolution.overrideActive).toBe(true);
    expect(useThemeStore.getState().resolution.theme).toBe('dark');

    // A tick past the boundary: override lapses, auto resumes AND is
    // cleared from state (not just ignored this one time).
    useThemeStore.getState().tick(new Date(expiresAt + 60_000), STUTTGART);
    expect(useThemeStore.getState().override).toBeNull();
    expect(useThemeStore.getState().resolution.overrideActive).toBe(false);
  });

  it('setMode("auto") after an explicit light/dark mode starts fresh (no stale override)', () => {
    useThemeStore.getState().setManualTheme('dark', new Date('2026-06-21T12:00:00Z'), STUTTGART);
    expect(useThemeStore.getState().override).not.toBeNull();

    useThemeStore.getState().setMode('light'); // explicit mode: override is meaningless here
    useThemeStore.getState().setMode('auto'); // back to auto
    expect(useThemeStore.getState().override).toBeNull();
  });

  it('a manual override never touches a manually-picked yapaja-contrast map style, even though it is a transition', () => {
    useStyleStore.getState().setStyleId('yapaja-contrast');
    useThemeStore.getState().setManualTheme('dark', new Date('2026-06-21T12:00:00Z'), STUTTGART);
    expect(useStyleStore.getState().styleId).toBe('yapaja-contrast');
    // The UI theme itself still resolved to dark (only the map style write was skipped).
    expect(useThemeStore.getState().resolution.theme).toBe('dark');
  });
});
