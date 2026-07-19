// ESLint flat config. Composes:
//   - @eslint/js recommended baseline
//   - typescript-eslint recommended (type-aware rules kept off for speed)
//   - eslint-plugin-react-hooks (rules-of-hooks + exhaustive-deps)
//   - eslint-plugin-import (basic hygiene; no path alias resolution to avoid
//     extra config overhead — TS already checks imports)
//
// Strategy: error on correctness rules that catch real bugs (hooks deps,
// hooks rules), warn on style/noise rules so the codebase converges without
// a single big-bang cleanup.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import importPlugin from 'eslint-plugin-import';

export default tseslint.config(
  // Global ignores — keep in sync with .gitignore build artifacts
  {
    ignores: [
      'dist/',
      'release/',
      'output/',
      'coverage/',
      'test-results/',
      'node_modules/',
      '.worktrees/',
      '.claude/',
      'docs/superpowers/',
      // Generated/env files
      'src/electron-env.d.ts',
      'src/vite-env.d.ts',
      'src/web-apis.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // TypeScript + React source files
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      import: importPlugin,
    },
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // ─── Hooks (correctness — error) ──────────────────────────
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',

      // ─── TypeScript (noise — warn to enable gradual cleanup) ──
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-interface': 'off',
      '@typescript-eslint/ban-types': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      // TS already checks undefined identifiers; no-undef produces false
      // positives on browser/Node globals (URL, fetch, setTimeout, console).
      'no-undef': 'off',

      // ─── General hygiene ──────────────────────────────────────
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'no-debugger': 'error',

      // ─── Import ───────────────────────────────────────────────
      'import/no-duplicates': 'warn',
      'import/no-cycle': 'off', // checked by dependency-cruiser separately
      'import/order': [
        'warn',
        {
          'newlines-between': 'never',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },

  // Electron main-process files: CJS, allow require/console
  {
    files: ['electron/**/*.cjs', '.dependency-cruiser.cjs', 'scripts/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'writable',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'off',
    },
  },

  // Scripts (build tooling) — relax
  {
    files: ['scripts/**/*.mjs', 'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // Browser scripts copied verbatim from public/.
  {
    files: ['public/**/*.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
        localStorage: 'readonly',
        window: 'readonly',
      },
    },
  },

  // Tests — relax noise rules. Hooks linting in test scaffolds (especially
  // hook-regression specs that intentionally call hooks in loops/Effects) is
  // more noisy than valuable; the production code is already covered.
  {
    files: ['tests/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        console: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      'no-console': 'off',
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
);
