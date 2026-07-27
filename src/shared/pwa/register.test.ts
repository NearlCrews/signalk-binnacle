import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReloadCoordinator, PWA_RELOAD_GUARD_MS } from './register';

vi.mock('virtual:pwa-register', () => ({ registerSW: () => () => undefined }));

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe('createReloadCoordinator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reloads on the first automatic controller change and stamps the guard', () => {
    const storage = fakeStorage();
    const reload = vi.fn();
    const coordinator = createReloadCoordinator(() => 1_000, storage, reload);
    coordinator.onNeedReload();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.values.get('binnacle:pwa-reload-at')).toBe('1000');
  });

  it('suppresses a second automatic reload inside the guard window and warns instead', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const storage = fakeStorage();
    const reload = vi.fn();
    const coordinator = createReloadCoordinator(
      () => 1_000 + PWA_RELOAD_GUARD_MS - 1,
      storage,
      reload,
    );
    storage.values.set('binnacle:pwa-reload-at', '1000');
    coordinator.onNeedReload();
    expect(reload).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    // The guard stamp is not refreshed by a suppressed reload, so a storm cannot extend it.
    expect(storage.values.get('binnacle:pwa-reload-at')).toBe('1000');
  });

  it('reloads again automatically once the guard window has passed', () => {
    const storage = fakeStorage({ 'binnacle:pwa-reload-at': '1000' });
    const reload = vi.fn();
    const coordinator = createReloadCoordinator(() => 1_000 + PWA_RELOAD_GUARD_MS, storage, reload);
    coordinator.onNeedReload();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a user-requested update bypasses the guard when its controller change lands', () => {
    const storage = fakeStorage({ 'binnacle:pwa-reload-at': '1000' });
    const reload = vi.fn();
    const activate = vi.fn();
    const coordinator = createReloadCoordinator(() => 1_001, storage, reload);
    coordinator.requestUpdate(activate);
    expect(activate).toHaveBeenCalledTimes(1);
    // The activation's controller change arrives well inside the guard window and must reload
    // anyway: the click is consent.
    coordinator.onNeedReload();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a click after a suppressed reload reloads directly instead of doing nothing', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const storage = fakeStorage({ 'binnacle:pwa-reload-at': '1000' });
    const reload = vi.fn();
    const activate = vi.fn();
    const coordinator = createReloadCoordinator(() => 1_001, storage, reload);
    // The storm's controller change was suppressed: the new worker already controls the page and
    // no waiting worker remains for an activation message to reach.
    coordinator.onNeedReload();
    expect(reload).not.toHaveBeenCalled();
    coordinator.requestUpdate(activate);
    expect(activate).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
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
    const coordinator = createReloadCoordinator(() => 1_000, storage, reload);
    coordinator.onNeedReload();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('degrades to reload-always without storage', () => {
    const reload = vi.fn();
    const coordinator = createReloadCoordinator(() => 1_000, null, reload);
    coordinator.onNeedReload();
    const second = createReloadCoordinator(() => 1_001, null, reload);
    second.onNeedReload();
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
