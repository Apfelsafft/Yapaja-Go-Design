/**
 * Unit tests for the style selection/options store (E01-T4).
 *
 * Actual localStorage read/write is exercised end-to-end by
 * `apps/web/e2e/styles.spec.ts` (real browser) — these tests run under
 * Node (no `window`, see `vitest.config.ts` `environment: 'node'`, same as
 * `viewMode.test.ts`), so they cover the in-memory state transitions only.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useStyleStore, normalizeStoredOptions } from './styleStore';
import { DEFAULT_STYLE_ID, DEFAULT_STYLE_OPTIONS } from '../map/styleClient';

describe('styleStore', () => {
  beforeEach(() => {
    useStyleStore.setState({ styleId: DEFAULT_STYLE_ID, options: DEFAULT_STYLE_OPTIONS });
  });

  it('starts with the default style id and options', () => {
    expect(useStyleStore.getState().styleId).toBe('yapaja-light');
    expect(useStyleStore.getState().options).toEqual({ lang: 'name', labelScale: '1.0', poi: 'full' });
  });

  it('setStyleId updates the selected style', () => {
    useStyleStore.getState().setStyleId('yapaja-dark');
    expect(useStyleStore.getState().styleId).toBe('yapaja-dark');
  });

  it('setLang updates only the lang option, leaving others untouched', () => {
    useStyleStore.getState().setLabelScale('1.2');
    useStyleStore.getState().setLang('name_de');
    expect(useStyleStore.getState().options).toEqual({ lang: 'name_de', labelScale: '1.2', poi: 'full' });
  });

  it('setLabelScale updates only the labelScale option', () => {
    useStyleStore.getState().setLabelScale('1.2');
    expect(useStyleStore.getState().options.labelScale).toBe('1.2');
    expect(useStyleStore.getState().options.lang).toBe('name');
  });

  it('setPoi updates only the poi option', () => {
    useStyleStore.getState().setPoi('reduced');
    expect(useStyleStore.getState().options.poi).toBe('reduced');
    expect(useStyleStore.getState().options.lang).toBe('name');
  });

  it('setStyleId does not throw when window/localStorage is unavailable (Node test env)', () => {
    expect(() => useStyleStore.getState().setStyleId('yapaja-contrast')).not.toThrow();
  });

  /**
   * ─── DIE ALTE, KAPUTTE WAHL ───────────────────────────────────────────────
   * Bis 0.3.6 speicherte „Deutsch" den Wert `name:de` — ein Feld, das es in
   * den Kacheln nicht gibt (siehe `apps/core/src/map/styles/options.ts`). Wer
   * es gewaehlt hatte, sah eine Karte ganz ohne Beschriftung. Beim Update
   * steht dieser Wert weiter im Browser: er muss auf das echte Feld zeigen
   * und nicht wortlos auf „Original" zurueckfallen — sonst waere die
   * Einstellung nach dem Update einfach verschwunden.
   */
  it('biegt eine vor 0.3.7 gespeicherte Sprachwahl auf das echte Feld um', () => {
    expect(normalizeStoredOptions({ lang: 'name:de' as never }).lang).toBe('name_de');
    expect(normalizeStoredOptions({ lang: 'name:en' as never }).lang).toBe('name_en');
  });

  it('laesst die uebrigen gespeicherten Optionen dabei unangetastet', () => {
    expect(normalizeStoredOptions({ lang: 'name:de' as never, labelScale: '1.2', poi: 'off' })).toEqual({
      lang: 'name_de',
      labelScale: '1.2',
      poi: 'off',
    });
  });

  it('faellt bei unbrauchbar Gespeichertem auf die Vorgaben zurueck', () => {
    expect(normalizeStoredOptions({ lang: 'name:fr' as never, poi: 'viele' as never })).toEqual(
      DEFAULT_STYLE_OPTIONS,
    );
  });
});
