import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.turbo/**',
      '**/.vscode/**',
      '**/.idea/**'
    ]
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        document: 'readonly',
        window: 'readonly',
        navigator: 'readonly'
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_'
        }
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }]
    }
  },
  {
    // Browser/DOM code: TypeScript (with the DOM lib) already flags genuinely
    // undefined identifiers at compile time; base `no-undef` only knows the
    // small manual `globals` list above and false-positives on standard
    // browser/DOM globals (fetch, HTMLDivElement, ResizeObserver, Window,
    // MessageEvent, setTimeout, …) that frontend code legitimately uses.
    // Scoped to the frontend packages (apps/web + the browser-side add-on SDK)
    // so it doesn't affect apps/core's existing, separately-justified no-undef
    // handling.
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx', 'packages/addon-sdk/**/*.ts', 'packages/addon-sdk/**/*.tsx'],
    rules: {
      'no-undef': 'off'
    }
  }
];
