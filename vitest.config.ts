import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@yapaja/shared': path.resolve(__dirname, 'packages/shared/src'),
      '@yapaja/ui': path.resolve(__dirname, 'packages/ui/src'),
      '@yapaja/addon-sdk': path.resolve(__dirname, 'packages/addon-sdk/src'),
      '@yapaja/core': path.resolve(__dirname, 'apps/core/src'),
      '@yapaja/web': path.resolve(__dirname, 'apps/web/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'apps/**/*.test.ts',
      'apps/**/*.test.tsx',
      'packages/**/*.test.ts',
      'packages/**/*.test.tsx',
      'yapaja_go/**/*.test.ts',
      // E09-T5 reference add-ons (docs/05 §6): deliberately NOT pnpm
      // workspace members (addons-examples/README.md), but their unit tests
      // still run as part of the ONE `npx vitest run` suite everyone uses --
      // the `@yapaja/addon-sdk`/`@yapaja/shared` aliases below already
      // resolve for them exactly like for every other package.
      'addons-examples/**/*.test.ts',
      // E10-T2: die Auswertungs-/Schwellenlogik der Performance-Pipeline
      // (`e2e/perf/{budgets,evaluate,statistics,trend}.ts`). Anders als
      // `e2e/golden-routes` (das bewusst draussen bleibt, weil es einen
      // laufenden Core braucht) ist das hier REINE Logik ohne Prozess,
      // Netzwerk oder Browser -- also genau das, was in den einen
      // `npx vitest run`-Lauf gehoert. Die MESSUNGEN selbst sind Playwright
      // und laufen ueber `e2e/perf/playwright.config.ts`.
      'e2e/perf/**/*.test.ts',
      // E10-T4: die Auswertungslogik des Dependency-Audit-Gates
      // (`scripts/dependency-audit.mjs`) -- gleiche Begruendung wie bei
      // `e2e/perf` oben: reine Logik ohne Prozess/Netzwerk, also gehoert sie
      // in den einen `npx vitest run`-Lauf. Die Scanner-AUFRUFE selbst laufen
      // in CI (Job `dependency-audit`), nicht hier.
      'scripts/**/*.test.ts',
      // feat/gui-install-path: `services/tiles/build-pmtiles.test.ts` --
      // dieselbe Begruendung wie bei `scripts/**` oben. Das Skript selbst
      // ist Bash; der Test ersetzt `docker` durch ein Stub im PATH und
      // prueft damit Argumentbehandlung, Regions-Ableitung, Signaturpruefung
      // und atomaren Swap real, ohne Docker-Daemon. Als Vitest-Test (statt
      // eines eigenen `.test.sh` wie bei services/photon) laeuft er im
      // ohnehin existierenden `npx vitest run` mit -- kein neuer CI-Job.
      'services/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.turbo/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/node_modules/**', '**/dist/**']
    }
  }
});
