import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Build outputs and vendored native-addon node_modules are not part of our source.
  globalIgnores(['dist', 'dist-electron', 'electron/native/smtc/node_modules', 'electron/native/MediaInfoTool']),

  // Renderer (React + TypeScript) — type-aware linting catches real bugs
  // (floating promises, unsafe assignments, etc.) that the recommended preset
  // won't see.
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Surface unhandled async work — the most common real-bug source in IPC code.
      // Kept as `warn` for now: the codebase has ~30 fire-and-forget IPC calls
      // that are intentional. Use `void someAsync()` to silence the warning at
      // the call site once you've confirmed it's actually intentional.
      '@typescript-eslint/no-floating-promises': 'warn',
      // The `await Promise.all([...])` rule wants every member to be a Promise,
      // but we sometimes pass `Promise.all` a mix of promises and resolved values
      // (it's the documented Promise.all behavior).
      '@typescript-eslint/await-thenable': 'warn',
      // react-hooks v7 added two rules that flag idiomatic patterns we use
      // intentionally (stable callback refs, single setState() in effect for
      // initial layout). Downgrade to warning rather than disable so they still
      // surface in the IDE.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      // We still allow `any` (lots of legacy `window.api as any` casts to migrate)
      // but warn on new ones so reviewers can push back.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Type-checked preset is strict by default — relax the noisier rules that
      // would require a large cleanup pass before they're useful.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // Noisy without a payoff for plain props/handlers — re-enable per-file if needed.
      '@typescript-eslint/unbound-method': 'off',
      // Allow `?? ''` even when LHS is technically nullable - we use it idiomatically.
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      // Catching common patterns (template strings, redundant types) hits too much legacy code.
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      // We have many `catch (_) {}` swallows that are intentional.
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },

  // Electron main + modules (CommonJS Node)
  {
    files: ['electron/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-console': 'off', // main.js logs to stdout intentionally
    },
  },
])
