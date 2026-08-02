import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { NEVER_CACHE_PATH_SEGMENTS } from './src/pwa/cachePolicy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    // E07-T5 (PWA & Kiosk, docs/01 ADR-001, Wargame W-19/W-20).
    VitePWA({
      // The SW itself updates/activates automatically (`skipWaiting` +
      // `clientsClaim` below) -- but NOT the visible page reload, which
      // vite-plugin-pwa's own default register script would otherwise do
      // immediately/silently. `injectRegister: false` disables that
      // auto-injected script entirely; `src/pwa/registerServiceWorker.ts`
      // (called from `main.tsx`/`shell/main.tsx`) registers the SW itself
      // and defers the reload to standstill via `onNeedReload` -- see that
      // file's doc comment for the full "why".
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'Yapaja Go',
        short_name: 'Yapaja Go',
        description: 'Offline-Navigation für Wohnmobile',
        // Relative to the manifest's own URL (served next to index.html
        // under this file's `base: './'`) -- keeps the ingress sub-path
        // case (W-15) working the same way every other asset URL already
        // does, root deployment included.
        start_url: './',
        scope: './',
        display: 'fullscreen',
        orientation: 'any',
        // docs/06 §3 design tokens: dark surface (`--bg-surface` night).
        background_color: '#111417',
        theme_color: '#111417',
        icons: [
          { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      includeAssets: ['icons/*.png'],
      workbox: {
        // App-shell precache: BOTH Rollup entries (index.html + shell.html,
        // the multi-page build below) and their built JS/CSS -- globs the
        // BUILT `dist/` output (not source), which automatically picks up
        // whatever chunks either page's Rollup entry produced.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // MapLibre GL JS pushes the main chunk close to workbox's 2 MB
        // default precache-file-size ceiling; headroom for it to keep
        // growing without silently dropping out of the precache manifest.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        skipWaiting: true,
        clientsClaim: true,
        // vite-plugin-pwa's own DEFAULT is `navigateFallback: 'index.html'`
        // (serve the app shell for any navigation that doesn't exactly match
        // a precached URL -- the standard single-page-app pattern). This app
        // is NOT single-page: it has TWO real, independent HTML entries
        // (`index.html` + `shell.html`, the multi-page Rollup build above),
        // and `shell.html` is always navigated to WITH a query string
        // (`?mode=explore|drive`, `shell/main.tsx`). Workbox's precache
        // lookup ignores query strings only via `ignoreURLParametersMatching`
        // (default: just `utm_*`/`fbclid`), so `shell.html?mode=drive` does
        // NOT exactly match the precached `shell.html` entry -- it would
        // fall through to the SPA fallback and get served `index.html`'s
        // content under the `shell.html` URL (wrong page entirely: found via
        // `shell.spec.ts`'s "(d) exactly one /ws/v1 connection" and
        // `shell-edit.spec.ts`'s Flow 7 e2e tests going red against this
        // change -- both `page.goto` a `shell.html?mode=...` URL a second
        // time mid-test). Disabling the SPA fallback entirely is the correct
        // fix for a genuinely multi-page app: each precached HTML entry
        // still serves itself exactly on an exact-URL navigation (including
        // a plain reload, W-19's own recovery flow), and an unmatched
        // navigation (e.g. `shell.html` WITH a query string, fully offline)
        // simply falls through like it would with no SW at all, rather than
        // silently resolving to the wrong page.
        navigateFallback: undefined,
        // PLAUSIBILITY (task's own words): `/api/*` and `/tiles/*` come LIVE
        // from the local Core (map tiles + all API) -- a cached copy would
        // serve ghost/stale data after an app update or mid-drive. Explicit
        // `NetworkOnly` route (rather than just relying on "never precached,
        // no matching route") makes the exclusion provable in the generated
        // SW. `NEVER_CACHE_PATH_SEGMENTS` (`cachePolicy.ts`) is the single
        // source of truth, shared with `cachePolicy.test.ts` -- built into a
        // RegExp (NOT a `urlPattern` function) deliberately: `generateSW`
        // serializes function-form `urlPattern`s via `Function.toString()`
        // straight into the built `sw.js` with NO closure/bundling, so a
        // function referencing an outer variable (e.g. the array element in
        // a `.map()`) would silently become a dangling, undefined identifier
        // at runtime in the SW. A RegExp literal has no such problem --
        // workbox serializes it via its own `.toString()`, which is
        // naturally self-contained.
        runtimeCaching: [
          {
            urlPattern: new RegExp(NEVER_CACHE_PATH_SEGMENTS.join('|')),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  base: './',
  resolve: {
    // ADR-012 (tsconfig.base.json `paths`) resolves `@yapaja/shared`/
    // `@yapaja/ui` to SOURCE for `tsc`, and Vite's dev server/esbuild
    // pre-bundling happen to pick that up too -- but Rollup's PRODUCTION
    // build resolves bare specifiers via real node_modules/package.json
    // resolution, which finds nothing (no app in this repo declares either
    // package as an npm dependency; `packages/*/dist` isn't a build
    // prerequisite here, ADR-011/012). Every prior `@yapaja/shared` import in
    // apps/web was `import type` (erased before Rollup ever sees it), so this
    // never surfaced until this task's `formatEta` (a real VALUE import,
    // E07-T1's eta widget). Mirrors `vitest.config.ts`'s alias -- same
    // "resolve to source" mechanism, extended to the Rollup build.
    alias: {
      '@yapaja/shared': resolve(__dirname, '../../packages/shared/src'),
      '@yapaja/ui': resolve(__dirname, '../../packages/ui/src'),
      '@yapaja/addon-sdk': resolve(__dirname, '../../packages/addon-sdk/src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/tiles': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      // Multi-page build (E07-T1): `shell.html` is the standalone widget-shell
      // mount point (`apps/web/src/shell/main.tsx`) alongside the main app
      // entry -- see that file's doc comment for why it's a separate page
      // rather than wired into `index.html`/`App.tsx`.
      input: {
        main: resolve(__dirname, 'index.html'),
        shell: resolve(__dirname, 'shell.html'),
      },
    },
  },
});
