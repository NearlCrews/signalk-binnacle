import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';

const typedRules = {
  '@typescript-eslint/await-thenable': 'error',
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
};

export default tseslint.config(
  {
    ignores: [
      '.cave/**',
      '.claude/**',
      '.remember/**',
      '.svelte-check/**',
      'coverage/**',
      'docs/superpowers/**',
      'playwright-report/**',
      'public/**',
      'test-results/**',
      'tmp/**',
    ],
  },
  ...svelte.configs['flat/recommended'],
  {
    files: ['**/*.svelte.ts'],
    rules: {
      'svelte/prefer-svelte-reactivity': 'off',
    },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: typedRules,
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
);
