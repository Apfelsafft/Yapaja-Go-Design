export default {
  content: ['./index.html', './shell.html', './src/**/*.{js,ts,jsx,tsx}'],
  // E07-T3: theme is driven by the theme controller (`src/theme/`), not the
  // OS `prefers-color-scheme` media query -- it toggles a `dark` class on
  // `<html>` (`applyThemeResolution.ts`) so auto/manual mode selection,
  // sunrise/sunset, and the day/night clock fallback all take effect
  // regardless of the OS setting. Every existing `dark:` variant across the
  // app (previously following `media`, i.e. the OS setting) now follows
  // this class instead -- intentional and required by the task, not a
  // regression: the theme controller always resolves to a concrete
  // light/dark and sets/removes the class, so those components keep
  // rendering exactly as before, just theme-controller-driven instead of
  // OS-driven.
  darkMode: 'class',
  theme: {
    extend: {},
  },
  plugins: [],
};
