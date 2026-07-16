import { describe, expect, it } from 'vitest';
import { binnacleStorageKey, binnacleStorageKeysForScope } from './storage-keys';

const HARDCODED_STORAGE_KEY =
  /(?:localStorage\.(?:getItem|setItem|removeItem)|new PersistedValue(?:<[^>]+>)?)\s*\(\s*['"`]binnacle:/;
const productionSources = import.meta.glob('/src/**/*.{ts,svelte}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('Binnacle storage-key inventory', () => {
  it('keeps registered keys unique and queryable by scope', () => {
    const all = binnacleStorageKeysForScope(
      'profile',
      'device',
      'server-resource',
      'safety',
      'credential',
      'cache',
      'draft',
    );
    expect(new Set(all).size).toBe(all.length);
    expect(binnacleStorageKeysForScope('credential')).toEqual([binnacleStorageKey('signalkAuth')]);
  });

  it('rejects hardcoded production Binnacle localStorage keys outside the inventory', () => {
    const offenders = Object.entries(productionSources)
      .filter(([path]) => !path.endsWith('.test.ts') && !path.endsWith('/storage-keys.ts'))
      .filter(([, source]) => HARDCODED_STORAGE_KEY.test(source))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
