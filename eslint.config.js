import { fileURLToPath } from 'node:url';
import { includeIgnoreFile } from '@eslint/compat';
import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';

const typedRules = {
  '@typescript-eslint/await-thenable': 'error',
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
};

export default tseslint.config(
  // .gitignore is the one ignore source; a hand-kept copy here drifted (three gitignored
  // directories never made it in, and any lintable file in them failed as file-not-in-project).
  includeIgnoreFile(fileURLToPath(new URL('.gitignore', import.meta.url))),
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
