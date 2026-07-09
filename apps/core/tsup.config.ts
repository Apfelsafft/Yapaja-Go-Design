import { defineConfig } from 'tsup';

// The core is shipped as a self-contained Node service. We bundle the internal
// workspace package @yapaja/shared (and its pure-JS deps like ajv) directly into
// the output so the production image needs no workspace symlinks. Runtime npm
// deps stay external (installed via `pnpm install --prod`); better-sqlite3 in
// particular is a native module and must never be bundled.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: ['@yapaja/shared'],
  external: ['better-sqlite3', 'fastify', '@fastify/static', 'pino'],
});
