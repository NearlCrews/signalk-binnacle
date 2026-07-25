import { beforeEach, describe, expect, it, vi } from 'vitest';
import { guardedReload, PWA_RELOAD_GUARD_MS } from './register';

vi.mock('virtual:pwa-register', () => ({ registerSW: () => () => undefined }));

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe('guardedReload', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reloads on the first controller change and stamps the guard', () => {
    const storage = fakeStorage();
    const reload = vi.fn();
    guardedReload(() => 1_000, storage, reload);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.values.get('binnacle:pwa-reload-at')).toBe('1000');
  });

  it('suppresses a second reload inside the guard window and warns instead', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const storage = fakeStorage();
    const reload = vi.fn();
    guardedReload(() => 1_000, storage, reload);
    guardedReload(() => 1_000 + PWA_RELOAD_GUARD_MS - 1, storage, reload);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledOnce();
    // The guard stamp is not refreshed by a suppressed reload, so a storm cannot extend it.
    expect(storage.values.get('binnacle:pwa-reload-at')).toBe('1000');
  });

  it('reloads again once the guard window has passed', () => {
    const storage = fakeStorage();
    const reload = vi.fn();
    guardedReload(() => 1_000, storage, reload);
    guardedReload(() => 1_000 + PWA_RELOAD_GUARD_MS, storage, reload);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('treats a throwing storage as no prior reload', () => {
    const reload = vi.fn();
    const storage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    guardedReload(() => 1_000, storage, reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('degrades to reload-always without storage', () => {
    const reload = vi.fn();
    guardedReload(() => 1_000, undefined, reload);
    guardedReload(() => 1_001, undefined, reload);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
