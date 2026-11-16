// Single flat ESLint config for the whole monorepo. Run `pnpm lint` from the root.
import js from '@eslint/js';
import remotion from '@remotion/eslint-plugin';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import prettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const DASHBOARD = 'apps/dashboard';
const REACT_VERSION = '19.2';

/** Scopes the Next.js preset (written for a standalone app) to the dashboard workspace. */
const nextForDashboard = nextCoreWebVitals.map((config) => {
  const isGlobalIgnore = config.ignores && Object.keys(config).length === 1;
  if (isGlobalIgnore) {
    return { ignores: config.ignores.map((glob) => `${DASHBOARD}/${glob}`) };
  }
  return {
    ...config,
    files: (config.files ?? ['**/*.{js,jsx,mjs,ts,tsx,mts,cts}']).map(
      (glob) => `${DASHBOARD}/${glob}`,
    ),
    settings: {
      ...config.settings,
      react: { version: REACT_VERSION },
      next: { rootDir: DASHBOARD },
    },
  };
});

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/.next/',
    '**/out/',
    '**/build/',
    '**/coverage/',
    '**/.venv/',
    '**/next-env.d.ts',
    'storage/',
    'services/data-processor/',
  ]),

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },

  // Plain JS/MJS files (configs, scripts) are not part of any tsconfig.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },

  // Node services and libraries.
  {
    files: ['apps/api/**/*.ts', 'services/render-worker/**/*.ts', 'packages/utils/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // Next.js dashboard.
  ...nextForDashboard,

  // React packages outside Next.js.
  {
    files: [
      'apps/renderer/**/*.{ts,tsx}',
      'packages/ui/**/*.{ts,tsx}',
      'packages/chart-components/**/*.{ts,tsx}',
    ],
    extends: [reactHooks.configs.flat['recommended-latest']],
    languageOptions: { globals: globals.browser },
  },

  // Remotion-specific rules (deterministic rendering, asset handling).
  {
    files: ['apps/renderer/src/**/*.{ts,tsx}'],
    ...remotion.flatPlugin,
  },

  // Must be last: turns off stylistic rules that conflict with Prettier.
  prettier,
);
