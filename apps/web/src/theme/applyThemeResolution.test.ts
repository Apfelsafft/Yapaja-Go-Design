/**
 * Unit tests for `applyThemeResolution.ts`'s STYLE-STORE side (the DOM-class
 * side needs a real `document`, covered by `apps/web/e2e/theme.spec.ts` in a
 * real browser -- this suite runs under Node, see `vitest.config.ts`
 * `environment: 'node'`, same convention as `state/styleStore.test.ts`).
 *
 * Covers:
 *  - the `syncMapStyle` gate (`themeStore.ts` decides it; this only checks
 *    `applyThemeResolution` HONORS it, on/off);
 *  - the contrast-interaction decision documented in
 *    `applyThemeResolution.ts`: theme-coupling only ever touches
 *    `yapaja-light`/`yapaja-dark`, never overwriting a manually-picked
 *    `yapaja-contrast`, even when `syncMapStyle` is true.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { applyThemeResolution } from './applyThemeResolution.js';
import { useStyleStore } from '../state/styleStore.js';
import { DEFAULT_STYLE_OPTIONS } from '../map/styleClient.js';
import type { ThemeResolution } from './resolveTheme.js';

function darkResolution(): ThemeResolution {
  return { theme: 'dark', styleId: 'yapaja-dark', overrideActive: false, nextBoundaryAt: null };
}

function lightResolution(): ThemeResolution {
  return { theme: 'light', styleId: 'yapaja-light', overrideActive: false, nextBoundaryAt: null };
}

describe('applyThemeResolution', () => {
  beforeEach(() => {
    useStyleStore.setState({ styleId: 'yapaja-light', options: DEFAULT_STYLE_OPTIONS });
  });

  it('does not throw without a document (Node test env)', () => {
    expect(() => applyThemeResolution(darkResolution(), { syncMapStyle: true })).not.toThrow();
  });

  it('syncMapStyle: true sets the style store to yapaja-dark for a dark resolution', () => {
    applyThemeResolution(darkResolution(), { syncMapStyle: true });
    expect(useStyleStore.getState().styleId).toBe('yapaja-dark');
  });

  it('syncMapStyle: true sets the style store to yapaja-light for a light resolution', () => {
    useStyleStore.getState().setStyleId('yapaja-dark');
    applyThemeResolution(lightResolution(), { syncMapStyle: true });
    expect(useStyleStore.getState().styleId).toBe('yapaja-light');
  });

  it('syncMapStyle: false leaves the style store untouched, regardless of resolution', () => {
    useStyleStore.getState().setStyleId('yapaja-dark');
    applyThemeResolution(lightResolution(), { syncMapStyle: false });
    expect(useStyleStore.getState().styleId).toBe('yapaja-dark');
  });

  it('leaves a manually-chosen yapaja-contrast style untouched by a dark resolution, even with syncMapStyle: true', () => {
    useStyleStore.getState().setStyleId('yapaja-contrast');
    applyThemeResolution(darkResolution(), { syncMapStyle: true });
    expect(useStyleStore.getState().styleId).toBe('yapaja-contrast');
  });

  it('leaves a manually-chosen yapaja-contrast style untouched by a light resolution, even with syncMapStyle: true', () => {
    useStyleStore.getState().setStyleId('yapaja-contrast');
    applyThemeResolution(lightResolution(), { syncMapStyle: true });
    expect(useStyleStore.getState().styleId).toBe('yapaja-contrast');
  });

  it('resumes coupling once the style is set back to yapaja-light/yapaja-dark', () => {
    useStyleStore.getState().setStyleId('yapaja-contrast');
    applyThemeResolution(darkResolution(), { syncMapStyle: true });
    expect(useStyleStore.getState().styleId).toBe('yapaja-contrast'); // still untouched

    useStyleStore.getState().setStyleId('yapaja-light'); // user picks light/dark again via Style Panel
    applyThemeResolution(darkResolution(), { syncMapStyle: true }); // next theme transition
    expect(useStyleStore.getState().styleId).toBe('yapaja-dark'); // coupling resumed
  });
});
