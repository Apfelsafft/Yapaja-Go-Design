import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@yapaja/shared': path.resolve(__dirname, 'packages/shared/src'),
      '@yapaja/core': path.resolve(__dirname, 'apps/core/src'),
      '@yapaja/web': path.resolve(__dirname, 'apps/web/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['apps/**/*.test.ts', 'apps/**/*.test.tsx', 'packages/**/*.test.ts', 'packages/**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.turbo/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/node_modules/**', '**/dist/**']
    }
  }
});
