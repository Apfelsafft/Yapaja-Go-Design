import { defineConfig } from 'tsup';
import { cpSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The core is shipped as a self-contained Node service. We bundle the internal
// workspace package @yapaja/shared (and its pure-JS deps like ajv) directly into
// the output so the production image needs no workspace symlinks. Runtime npm
// deps stay external (installed via `pnpm install --prod`); better-sqlite3 in
// particular is a native module and must never be bundled.
export default defineConfig({
  // ─── ZWEI EINSTIEGSPUNKTE ──────────────────────────────────────────────
  // `index` ist der Dienst. `lite-index` ist das Werkzeug, das den
  // Offline-Suchindex baut (src/search/lite/cli.ts).
  //
  // Bis 0.3.3 wurde NUR `index` gebaut, und genau daraus folgte die Aussage
  // im Dockerfile, der Lite-Index lasse sich auf dem Geraet nicht bauen: das
  // Werkzeug lag schlicht nicht im Image, weil dieser Build es nicht
  // mitnahm. Das war keine technische Grenze, sondern eine Auslassung an
  // dieser Stelle -- und sie hat den Betreiber eine Funktion gekostet, die
  // seit E05-T5 fertig im Quelltext liegt.
  entry: { index: 'src/index.ts', 'lite-index': 'src/search/lite/cli.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: ['@yapaja/shared'],
  external: ['better-sqlite3', 'fastify', '@fastify/static', '@fastify/websocket', 'ws', 'pino'],
  onSuccess: async () => {
    // The whole build is a single bundled dist/index.js (esbuild inlines
    // every source module), so every module's `import.meta.url`-derived
    // __dirname resolves to dist/ at runtime -- including the GPS
    // simulator's fixture loader (apps/core/src/position/simulator/index.ts,
    // `join(__dirname, '__fixtures__')`). Copy the fixtures alongside the
    // bundle so `gpxId`-based simulator playback also works in a built
    // (production/ENABLE_SIMULATOR=1) image, not just under tsx/vitest
    // where each source file keeps its own real directory.
    cpSync(
      join(__dirname, 'src/position/simulator/__fixtures__'),
      join(__dirname, 'dist/__fixtures__'),
      { recursive: true },
    );
    // Same reasoning, for the region manager's downloadable-regions catalog
    // (E01-T5, apps/core/src/map/regions/catalog.ts): it's read from disk at
    // runtime -- rather than bundled as a JS object -- specifically so
    // MAP_REGIONS_CATALOG_FILE can override it in tests/ops. Its default
    // path is `join(__dirname, 'regions-catalog.json')`, which (like the
    // fixtures above) resolves to dist/ once bundled, regardless of the
    // source file's original src/map/regions/ nesting.
    cpSync(
      join(__dirname, 'src/map/regions/regions-catalog.json'),
      join(__dirname, 'dist/regions-catalog.json'),
    );
  },
});
