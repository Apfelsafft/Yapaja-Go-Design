/**
 * `applyThemeResolution` -- die Seite des Stil-Speichers (die `dark`-Klasse
 * braucht ein echtes `document`, das prüft `e2e/theme.spec.ts`).
 *
 * Seit 0.21 hat jedes Thema seinen eigenen Stilplatz. Gemeldet war: „Wenn ich
 * aber einen anderen Kartenstil wähle, wird das überschrieben (dunkles Theme
 * mit heller Karte)." Geprüft wird hier, dass der Wechsel des Themas nur den
 * PLATZ wechselt und nie eine Wahl überschreibt.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { applyThemeResolution } from './applyThemeResolution.js';
import { useStyleStore } from '../state/styleStore.js';
import { DEFAULT_STYLE_OPTIONS } from '../map/styleClient.js';
import type { ThemeResolution } from './resolveTheme.js';

function dunkel(): ThemeResolution {
  return { theme: 'dark', styleId: 'yapaja-dark', overrideActive: false, nextBoundaryAt: null };
}

function hell(): ThemeResolution {
  return { theme: 'light', styleId: 'yapaja-light', overrideActive: false, nextBoundaryAt: null };
}

describe('applyThemeResolution', () => {
  beforeEach(() => {
    useStyleStore.setState({
      styleId: 'yapaja-light',
      stilHell: 'yapaja-light',
      stilDunkel: 'yapaja-dark',
      thema: 'light',
      options: DEFAULT_STYLE_OPTIONS,
    });
  });

  it('wirft ohne document nicht (Node)', () => {
    expect(() => applyThemeResolution(dunkel())).not.toThrow();
  });

  it('zeigt bei Dunkel den Dunkel-Stil und bei Hell den Hell-Stil', () => {
    applyThemeResolution(dunkel());
    expect(useStyleStore.getState().styleId).toBe('yapaja-dark');
    applyThemeResolution(hell());
    expect(useStyleStore.getState().styleId).toBe('yapaja-light');
  });

  it('der gemeldete Fall: ein frei gewählter Stil überlebt den Wechsel in beide Richtungen', () => {
    // Bei Hell „Natur", bei Dunkel „Kontrast" gewählt.
    useStyleStore.getState().setStilFuer('light', 'yapaja-natur');
    useStyleStore.getState().setStilFuer('dark', 'yapaja-contrast');

    applyThemeResolution(dunkel());
    expect(useStyleStore.getState().styleId).toBe('yapaja-contrast');
    applyThemeResolution(hell());
    expect(useStyleStore.getState().styleId).toBe('yapaja-natur');
    applyThemeResolution(dunkel());
    expect(useStyleStore.getState().styleId).toBe('yapaja-contrast');

    // Die Wahl selbst ist unberührt.
    expect(useStyleStore.getState().stilHell).toBe('yapaja-natur');
    expect(useStyleStore.getState().stilDunkel).toBe('yapaja-contrast');
  });

  it('eine Wahl im Menü gilt für das gerade aktive Thema', () => {
    applyThemeResolution(dunkel());
    useStyleStore.getState().setStyleId('yapaja-reduziert');
    expect(useStyleStore.getState().stilDunkel).toBe('yapaja-reduziert');
    expect(useStyleStore.getState().stilHell).toBe('yapaja-light');
    expect(useStyleStore.getState().styleId).toBe('yapaja-reduziert');
  });
});
