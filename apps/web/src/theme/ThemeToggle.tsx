/**
 * Minimal theme mode control (E07-T3): Hell/Dunkel/System/Sonne, docs/06 §3.
 * Picking Hell/Dunkel while mode is `auto` (angezeigt als „Sonne") creates a
 * hold-until-next-boundary
 * override rather than abandoning auto mode outright, per the task's
 * override semantics (`themeStore.ts#setManualTheme`); switching the MODE
 * itself to an explicit `light`/`dark` (long-press not needed here -- this
 * is a settings-style control, not a drive-mode widget) just stays there,
 * no override involved.
 *
 * Deliberately as small/unstyled-adjacent as `StylePanel.tsx` (E01-T4's
 * "preliminary settings surface" note applies here too) -- the eventual
 * settings surface is E07's widget/slot system, not this component.
 */

import React from 'react';
import { useThemeStore } from './themeStore.js';
import type { ThemeMode } from './resolveTheme.js';

/**
 * Vier Modi, und die beiden automatischen tragen bewusst UNTERSCHIEDLICHE
 * Namen. „Auto" fuer beides waere das Schlimmste: zwei verschiedene Verhalten
 * hinter einem Wort, und niemand weiss, welches gerade gilt.
 */
const MODE_OPTIONS: Array<{ value: ThemeMode; label: string; hinweis: string }> = [
  { value: 'light', label: 'Hell', hinweis: 'Immer hell.' },
  { value: 'dark', label: 'Dunkel', hinweis: 'Immer dunkel.' },
  { value: 'system', label: 'System', hinweis: 'Folgt der Einstellung dieses Geräts.' },
  {
    value: 'auto',
    label: 'Sonne',
    hinweis: 'Folgt dem Sonnenstand an Ihrer Position — dunkel, wenn es draußen dunkel wird.',
  },
];

export default function ThemeToggle(): React.ReactElement {
  const mode = useThemeStore((state) => state.mode);
  const overrideActive = useThemeStore((state) => state.override !== null);
  const setMode = useThemeStore((state) => state.setMode);
  const setManualTheme = useThemeStore((state) => state.setManualTheme);

  return (
    <section data-testid="theme-toggle">
      <h2 className="font-semibold mb-2">Design</h2>
      {/* `flex-wrap`: vier Knoepfe passen auf 390 Bildpunkten nicht mehr in
          eine Zeile, und das Panel ist nur `w-64` breit. */}
      <div className="flex flex-wrap gap-1" role="group" aria-label="Design-Modus">
        {MODE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setMode(opt.value)}
            aria-pressed={opt.value === mode}
            title={opt.hinweis}
            data-testid={`theme-mode-${opt.value}`}
            className={`px-2 py-1 rounded-md border text-xs ${
              opt.value === mode
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 font-semibold'
                : 'border-slate-300 dark:border-slate-600'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {/* Der Unterschied zwischen „System" und „Sonne" ist nicht zu erraten --
          also steht er da, fuer den gewaehlten Modus. */}
      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400" data-testid="theme-mode-hint">
        {MODE_OPTIONS.find((opt) => opt.value === mode)?.hinweis}
      </p>
      {mode === 'auto' && (
        <div className="mt-2">
          <p className="mb-1 text-[11px] text-slate-500 dark:text-slate-400">
            Vorübergehend übersteuern:
          </p>
          <div className="flex gap-1" role="group" aria-label="Auto-Override">
            <button
              type="button"
              onClick={() => setManualTheme('light')}
              data-testid="theme-override-light"
              className="px-2 py-1 rounded-md border border-slate-300 dark:border-slate-600 text-xs"
            >
              ☀ Hell
            </button>
            <button
              type="button"
              onClick={() => setManualTheme('dark')}
              data-testid="theme-override-dark"
              className="px-2 py-1 rounded-md border border-slate-300 dark:border-slate-600 text-xs"
            >
              🌙 Dunkel
            </button>
          </div>
          {overrideActive && (
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400" data-testid="theme-override-hint">
              Manuell bis zum nächsten Auf-/Untergang
            </p>
          )}
        </div>
      )}
    </section>
  );
}
