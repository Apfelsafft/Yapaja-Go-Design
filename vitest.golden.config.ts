import { defineConfig } from 'vitest/config';

/**
 * Separate Vitest project for the 🔴 Golden-Route suite (E03-T5).
 *
 * Kept OUT of the normal unit run (root `vitest.config.ts` only globs
 * `apps/**` + `packages/**`) so `pnpm test` never depends on a live Core.
 * Run it explicitly with `pnpm golden-routes`.
 *
 * - `retry: 0`   — a safety/restriction case must NEVER be retried into green
 *                  (docs/07 §3b: "kein retry, keine Toleranz").
 * - `bail: 1`    — the first failing case HARD-ABORTS the run; a broken safety
 *                  gate stops everything rather than being buried in a report.
 *
 * The route assertions in `runner.test.ts` are gated behind `GOLDEN_LIVE=1`
 * (they need a Core + Valhalla). Without it, only the pure `bbox.test.ts`
 * unit tests execute — that is the locally-green portion of this suite.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['e2e/golden-routes/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    retry: 0,
    bail: 1,
  },
});
