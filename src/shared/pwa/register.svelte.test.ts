import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeStorage } from '$shared/testing';
import { createReloadCoordinator, PWA_RELOAD_GUARD_MS, registerPwa } from './register.svelte';

// A plain recording function rather than a vi.fn, so restoreAllMocks cannot strip its
// implementation between tests.
const { registerSWCalls } = vi.hoisted(() => ({ registerSWCalls: [] as unknown[] }));
vi.mock('virtual:pwa-register', () => ({
  registerSW: (options: unknown) => {
    registerSWCalls.push(options);
    return () => undefined;
  },
}));

describe('createReloadCoordinator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reloads on the first automatic controller change and stamps the guard', () => {
    const storage = createFakeStorage();
    const reload = vi.fn();
    const coordinator = createReloadCoordinator(() => 1_000, storage, reload);
    coordinator.onNeedReload();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.data.get('binnacle:pwa-reload-at')).toBe('1000');
  });

  it('suppresses a second automatic reload inside the guard window and warns instead', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const storage = createFakeStorage();
    const reload = vi.fn();
    const coordinator = createReloadCoordinator(
      () => 1_000 + PWA_RELOAD_GUARD_MS - 1,
      storage,
      reload,
    );
    storage.data.set('binnacle:pwa-reload-at', '1000');
    coordinator.onNeedReload();
    expect(reload).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    // The guard stamp is not refreshed by a suppressed reload, so a storm cannot extend it.
    expect(storage.data.get('binnacle:pwa-reload-at')).toBe('1000');
  });

  it('reloads again automatically once the guard window has passed', () => {
    const storage = createFakeStorage({ 'binnacle:pwa-reload-at': '1000' });
    const reload = vi.fn();
    const coordinator = createReloadCoordinator(() => 1_000 + PWA_RELOAD_GUARD_MS, storage, reload);
    coordinator.onNeedReload();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a user-requested update bypasses the guard when its controller change lands', () => {
    const storage = createFakeStorage({ 'binnacle:pwa-reload-at': '1000' });
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
    const storage = createFakeStorage({ 'binnacle:pwa-reload-at': '1000' });
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

describe('registerPwa status', () => {
  interface CapturedOptions {
    onRegisteredSW?: (url: string, registration: undefined) => void;
    onRegisterError?: (error: unknown) => void;
  }

  function lastOptions(): CapturedOptions {
    const options = registerSWCalls.at(-1);
    if (!options) throw new Error('registerSW was not called');
    return options as CapturedOptions;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    registerSWCalls.length = 0;
  });

  // Node has no navigator.serviceWorker, matching the plain-http browser where the API is absent.
  it('starts insecure-context where the service worker API is withheld', () => {
    expect(registerPwa().status).toBe('insecure-context');
  });

  it('reports active once the service worker registers', () => {
    const controller = registerPwa();
    lastOptions().onRegisteredSW?.('sw.js', undefined);
    expect(controller.status).toBe('active');
  });

  it('classifies a certificate registration refusal as untrusted-certificate', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const controller = registerPwa();
    lastOptions().onRegisterError?.(
      new Error('An SSL certificate error occurred when fetching the script.'),
    );
    expect(controller.status).toBe('untrusted-certificate');
    expect(info).toHaveBeenCalledOnce();
  });

  it('classifies any other registration error as failed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const controller = registerPwa();
    lastOptions().onRegisterError?.(new Error('script evaluation failed'));
    expect(controller.status).toBe('failed');
    expect(warn).toHaveBeenCalledOnce();
  });
});
