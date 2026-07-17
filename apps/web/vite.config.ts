import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
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
