import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeStorage } from '$shared/testing';
import { createReloadCoordinator, PWA_RELOAD_GUARD_MS, registerPwa } from './register.svelte';

// Plain recording state rather than vi.fn, so restoreAllMocks cannot strip implementations
// between tests. Each getSerwist() call yields a fresh fake worker window with dispatchable
// events; `supported: false` mirrors the real module's undefined when the serviceWorker API is
// withheld, and `registerError` makes register() reject the way a refused registration does.
const serwistMock = vi.hoisted(() => {
  interface FakeSerwist {
    dispatch: (type: string, event?: { isUpdate?: boolean; isExternal?: boolean }) => void;
    addEventListener: (
      type: string,
      listener: (event: { isUpdate?: boolean; isExternal?: boolean }) => void,
    ) => void;
    register: () => Promise<undefined>;
    messageSkipWaiting: () => void;
    skipWaitingCalls: number;
  }
  const state = {
    supported: true,
    registerError: undefined as unknown,
    getSerwistError: undefined as unknown,
    instances: [] as FakeSerwist[],
    reset() {
      state.supported = true;
      state.registerError = undefined;
      state.getSerwistError = undefined;
      state.instances.length = 0;
    },
    make(): FakeSerwist {
      const listeners = new Map<
        string,
        ((event: { isUpdate?: boolean; isExternal?: boolean }) => void)[]
      >();
      const fake: FakeSerwist = {
        skipWaitingCalls: 0,
        addEventListener(type, listener) {
          listeners.set(type, [...(listeners.get(type) ?? []), listener]);
        },
        dispatch(type, event = {}) {
          for (const listener of listeners.get(type) ?? []) listener(event);
        },
        register: () =>
          state.registerError ? Promise.reject(state.registerError) : Promise.resolve(undefined),
        messageSkipWaiting() {
          fake.skipWaitingCalls += 1;
        },
      };
      state.instances.push(fake);
      return fake;
    },
  };
  return state;
});
vi.mock('virtual:serwist', () => ({
  getSerwist: async () => {
    if (serwistMock.getSerwistError) throw serwistMock.getSerwistError;
    return serwistMock.supported ? serwistMock.make() : undefined;
  },
}));

// A spy coordinator whose requestUpdate runs the activation immediately, so tests observe the
// reload decisions without touching window.location.
function spyCoordinator() {
  return {
    onNeedReload: vi.fn(),
    requestUpdate: vi.fn((activate: () => void) => activate()),
  };
}

// Registration crosses two awaits (getSerwist, then register), so settle the microtask queue
// through the macrotask boundary before asserting.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

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

  it('an expired consent no longer bypasses the guard', () => {
    // The Update click's consent lapses after the guard window, so a click whose activation
    // never happened cannot let a much later automatic controller change slip past the guard.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const storage = createFakeStorage({ 'binnacle:pwa-reload-at': '15000' });
    const reload = vi.fn();
    let at = 1_000;
    const coordinator = createReloadCoordinator(() => at, storage, reload);
    coordinator.requestUpdate(() => undefined);
    at = 1_000 + PWA_RELOAD_GUARD_MS + 9_000;
    coordinator.onNeedReload();
    expect(reload).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
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
  function lastInstance() {
    const instance = serwistMock.instances.at(-1);
    if (!instance) throw new Error('getSerwist did not produce an instance');
    return instance;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    serwistMock.reset();
  });

  // Node has no navigator.serviceWorker, matching the plain-http browser where the API is absent
  // and getSerwist resolves undefined.
  it('starts insecure-context where the service worker API is withheld', async () => {
    serwistMock.supported = false;
    const controller = registerPwa();
    expect(controller.status).toBe('insecure-context');
    await settle();
    expect(controller.status).toBe('insecure-context');
    expect(serwistMock.instances).toHaveLength(0);
  });

  it('reports active once the service worker registers', async () => {
    const controller = registerPwa();
    await settle();
    expect(controller.status).toBe('active');
  });

  it('classifies a certificate registration refusal as untrusted-certificate', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    serwistMock.registerError = new Error(
      'An SSL certificate error occurred when fetching the script.',
    );
    const controller = registerPwa();
    await settle();
    expect(controller.status).toBe('untrusted-certificate');
    expect(info).toHaveBeenCalledOnce();
  });

  it('classifies any other registration error as failed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    serwistMock.registerError = new Error('script evaluation failed');
    const controller = registerPwa();
    await settle();
    expect(controller.status).toBe('failed');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('classifies a failed getSerwist import as failed instead of staying pending', async () => {
    // getSerwist lazily imports a real chunk; a failed fetch of it must not leave the status
    // pending, which the offline charts page renders as healthy.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    serwistMock.getSerwistError = new Error('Failed to fetch dynamically imported module');
    const controller = registerPwa();
    await settle();
    expect(controller.status).toBe('failed');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('surfaces a waiting worker through onNeedRefresh and activates it on update', async () => {
    const onNeedRefresh = vi.fn();
    const controller = registerPwa(onNeedRefresh, spyCoordinator());
    await settle();
    lastInstance().dispatch('waiting');
    expect(onNeedRefresh).toHaveBeenCalledTimes(1);
    controller.update();
    // The activation defers behind the registration promise.
    await settle();
    expect(lastInstance().skipWaitingCalls).toBe(1);
  });

  it('does not reload when the first-ever install takes control', async () => {
    // clientsClaim makes the very first worker fire 'controlling' with isUpdate false, isExternal
    // false, and no waiting surfaced; reloading that first visit would be wrong.
    const coordinator = spyCoordinator();
    registerPwa(undefined, coordinator);
    await settle();
    lastInstance().dispatch('controlling', { isUpdate: false });
    lastInstance().dispatch('controlling', {});
    expect(coordinator.onNeedReload).not.toHaveBeenCalled();
  });

  it('reloads when an update, an external activation, or a surfaced waiting worker takes control', async () => {
    // The library computes isUpdate once at registration, so a same-session update on a
    // first-visit tab arrives with isUpdate false; the waiting worker surfaced beforehand is the
    // second permission, and an external activation from another tab reloads too.
    const coordinator = spyCoordinator();
    registerPwa(undefined, coordinator);
    await settle();
    lastInstance().dispatch('controlling', { isUpdate: true });
    expect(coordinator.onNeedReload).toHaveBeenCalledTimes(1);
    lastInstance().dispatch('controlling', { isExternal: true });
    expect(coordinator.onNeedReload).toHaveBeenCalledTimes(2);
    lastInstance().dispatch('waiting');
    lastInstance().dispatch('controlling', {});
    expect(coordinator.onNeedReload).toHaveBeenCalledTimes(3);
  });

  it('a click before registration settles defers until it can activate', async () => {
    // The serwist ref is only assigned after getSerwist() resolves; a click landing first must
    // not be dropped, it chains behind the registration promise.
    const controller = registerPwa(undefined, spyCoordinator());
    expect(() => controller.update()).not.toThrow();
    await settle();
    expect(lastInstance().skipWaitingCalls).toBe(1);
  });

  it('downgrades to failed when a first install is discarded before taking control', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const controller = registerPwa(undefined, spyCoordinator());
    await settle();
    expect(controller.status).toBe('active');
    lastInstance().dispatch('redundant');
    expect(controller.status).toBe('failed');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('a discard after the worker took control does not downgrade the status', async () => {
    const controller = registerPwa(undefined, spyCoordinator());
    await settle();
    lastInstance().dispatch('waiting');
    lastInstance().dispatch('redundant');
    expect(controller.status).toBe('active');
  });
});
