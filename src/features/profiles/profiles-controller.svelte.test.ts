import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type {
  AsyncProfileAdapter,
  Profile,
  ProfileAdapter,
  ProfileSettings,
  ProfilesState,
  RemoteProfilesSnapshot,
} from '$entities/profile';
import { ProfileStore } from '$entities/profile';
import type { ProfileBindings } from './profile-bindings';
import { createProfilesController } from './profiles-controller.svelte';

function settings(overrides: Partial<ProfileSettings> = {}): ProfileSettings {
  return {
    theme: 'day',
    layers: {},
    layerOrder: [],
    weatherLayers: {},
    thresholds: {
      dangerCpaMeters: 926,
      dangerTcpaSeconds: 600,
      warningCpaMeters: 1852,
      warningTcpaSeconds: 1200,
    },
    trackSettings: { intervalSeconds: 10, minMeters: 10, colorMode: 'speed' },
    planningSpeedKn: 6,
    units: 'metric',
    pinnedActionIds: ['center'],
    instrumentTiles: ['depth'],
    trendInstrumentIds: ['depth', 'wind-apparent'],
    anchorRadiusMeters: 50,
    ...overrides,
  };
}

function profile(
  id: string,
  name: string,
  updatedAt: number,
  overrides: Partial<ProfileSettings> = {},
): Profile {
  return {
    id,
    name,
    settings: settings(overrides),
    createdAt: 1,
    updatedAt,
    nameUpdatedAt: updatedAt,
    settingUpdatedAt: { theme: updatedAt, planningSpeedKn: updatedAt },
  };
}

function localAdapter(initial?: ProfilesState): ProfileAdapter {
  let state = initial;
  return {
    load: () => state,
    save: (next) => {
      state = structuredClone(next);
    },
  };
}

function remoteAdapter(snapshots: RemoteProfilesSnapshot[]): AsyncProfileAdapter {
  let index = 0;
  return {
    load: async () => ({
      state: 'ok',
      snapshot: structuredClone(snapshots[Math.min(index++, snapshots.length - 1)]),
    }),
    mutate: async () => 'ok',
  };
}

function bindings(initial: ProfileSettings): {
  bindings: ProfileBindings;
  current(): ProfileSettings;
  set(next: ProfileSettings): void;
  applied: ProfileSettings[];
} {
  let current = structuredClone(initial);
  const applied: ProfileSettings[] = [];
  return {
    bindings: {
      capture: () => structuredClone(current),
      apply: (next) => {
        current = structuredClone(next);
        applied.push(structuredClone(next));
      },
      track: () => undefined,
    },
    current: () => structuredClone(current),
    set: (next) => {
      current = structuredClone(next);
    },
    applied,
  };
}

describe('createProfilesController', () => {
  it('hydrates the remote default before seeding or applying a local starter', async () => {
    const remote = profile('remote', 'Remote helm', 10, { theme: 'dusk' });
    const store = new ProfileStore(localAdapter());
    const bound = bindings(settings());
    const controller = createProfilesController({
      store,
      bindings: bound.bindings,
      applyRuntime: () => undefined,
    });

    await controller.initialize(
      remoteAdapter([
        {
          profiles: [remote],
          tombstones: [],
          defaultId: remote.id,
          revision: 2,
        },
      ]),
    );

    expect(store.profiles.map((item) => item.id)).toEqual([remote.id]);
    expect(store.activeId).toBe(remote.id);
    expect(bound.current().theme).toBe('dusk');
  });

  it('captures the current browser setup when synced profiles have no default', async () => {
    const remote = profile('remote', 'Remote helm', 10, { theme: 'night-red' });
    const current = settings({ theme: 'dusk', planningSpeedKn: 8 });
    const store = new ProfileStore(localAdapter());
    const bound = bindings(current);
    const controller = createProfilesController({
      store,
      bindings: bound.bindings,
      applyRuntime: () => undefined,
    });

    await controller.initialize(
      remoteAdapter([
        {
          profiles: [remote],
          tombstones: [],
          defaultId: undefined,
          revision: 2,
        },
      ]),
    );

    expect(store.profiles).toHaveLength(2);
    expect(store.active?.name).toBe('Current setup');
    expect(store.active?.settings).toEqual(current);
  });

  it('debounces changes into the active profile', async () => {
    vi.useFakeTimers();
    const existing = profile('local', 'Local helm', 4);
    const store = new ProfileStore(
      localAdapter({
        profiles: [existing],
        activeId: existing.id,
        defaultId: undefined,
      }),
    );
    const bound = bindings(existing.settings);
    const controller = createProfilesController({
      store,
      bindings: bound.bindings,
      applyRuntime: () => undefined,
      autosaveMs: 20,
    });
    await controller.initialize();
    await tick();

    bound.set(settings({ planningSpeedKn: 9 }));
    controller.observeSettings();
    await vi.advanceTimersByTimeAsync(20);

    expect(store.active?.settings.planningSpeedKn).toBe(9);
    controller.dispose();
    vi.useRealTimers();
  });

  it('does not apply a remote active-profile update until the navigator accepts it', async () => {
    const local = profile('p1', 'Helm', 1, { theme: 'day' });
    const remote = profile('p1', 'Helm', 5, { theme: 'night-red' });
    const store = new ProfileStore(
      localAdapter({
        profiles: [local],
        activeId: local.id,
        defaultId: undefined,
      }),
    );
    const bound = bindings(local.settings);
    const controller = createProfilesController({
      store,
      bindings: bound.bindings,
      applyRuntime: () => undefined,
    });
    const server = remoteAdapter([
      {
        profiles: [local],
        tombstones: [],
        defaultId: undefined,
        revision: 1,
      },
      {
        profiles: [remote],
        tombstones: [],
        defaultId: undefined,
        revision: 2,
      },
    ]);
    await controller.initialize(server);
    await controller.sync(server);

    expect(store.remoteUpdateAvailable).toBe(true);
    expect(bound.current().theme).toBe('day');
    bound.set(settings({ theme: 'day', planningSpeedKn: 9 }));
    controller.observeSettings();
    controller.applyRemoteUpdate();
    expect(store.active?.settings.theme).toBe('night-red');
    expect(store.active?.settings.planningSpeedKn).toBe(9);
    expect(bound.current().theme).toBe('night-red');
    expect(bound.current().planningSpeedKn).toBe(9);
    expect(store.remoteUpdateAvailable).toBe(false);
  });

  it('keeps the live setup when the navigator rejects a remote update', async () => {
    const local = profile('p1', 'Helm', 1, { theme: 'day' });
    const remote = profile('p1', 'Helm', 5, { theme: 'night-red' });
    const store = new ProfileStore(
      localAdapter({
        profiles: [local],
        activeId: local.id,
        defaultId: undefined,
      }),
    );
    const bound = bindings(local.settings);
    const controller = createProfilesController({
      store,
      bindings: bound.bindings,
      applyRuntime: () => undefined,
    });
    const server = remoteAdapter([
      {
        profiles: [local],
        tombstones: [],
        defaultId: undefined,
        revision: 1,
      },
      {
        profiles: [remote],
        tombstones: [],
        defaultId: undefined,
        revision: 2,
      },
    ]);
    await controller.initialize(server);
    await controller.sync(server);

    controller.keepCurrentSetup();

    expect(store.active?.settings.theme).toBe('day');
    expect(bound.current().theme).toBe('day');
    expect(store.remoteUpdateAvailable).toBe(false);
  });

  it('preserves the live setup under a replacement when the active profile is deleted remotely', async () => {
    const local = profile('p1', 'Helm', 1, { theme: 'dusk' });
    const store = new ProfileStore(
      localAdapter({
        profiles: [local],
        activeId: local.id,
        defaultId: undefined,
      }),
    );
    const bound = bindings(local.settings);
    const controller = createProfilesController({
      store,
      bindings: bound.bindings,
      applyRuntime: () => undefined,
    });
    const server = remoteAdapter([
      {
        profiles: [local],
        tombstones: [],
        defaultId: undefined,
        revision: 1,
      },
      {
        profiles: [],
        tombstones: [{ id: local.id, deletedAt: 2 }],
        defaultId: undefined,
        revision: 2,
      },
    ]);
    await controller.initialize(server);
    await controller.sync(server);

    expect(store.activeId).toBeDefined();
    expect(store.activeId).not.toBe(local.id);
    expect(store.active?.name).toBe('Current setup');
    expect(store.active?.settings.theme).toBe('dusk');
    expect(bound.current().theme).toBe('dusk');
  });

  it('does not apply an unaccepted remote update after a reload', async () => {
    const applied = profile('p1', 'Helm', 1, { theme: 'day' });
    const cached = profile('p1', 'Helm', 5, { theme: 'night-red' });
    const store = new ProfileStore(
      localAdapter({
        profiles: [cached],
        activeId: cached.id,
        defaultId: undefined,
        applied: { profileId: applied.id, settings: applied.settings },
      }),
    );
    const bound = bindings(applied.settings);
    const controller = createProfilesController({
      store,
      bindings: bound.bindings,
      applyRuntime: () => undefined,
    });

    await controller.initialize();

    expect(bound.current().theme).toBe('day');
    expect(store.active?.settings.theme).toBe('night-red');
    expect(store.remoteUpdateAvailable).toBe(true);
  });

  it('captures changes made while startup hydration is still pending', async () => {
    const store = new ProfileStore(localAdapter());
    const bound = bindings(settings());
    const controller = createProfilesController({
      store,
      bindings: bound.bindings,
      applyRuntime: () => undefined,
    });
    controller.observeSettings();
    bound.set(settings({ theme: 'dusk', planningSpeedKn: 8 }));
    controller.observeSettings();

    await controller.initialize(remoteAdapter([{ ...emptySnapshot(), revision: 1 }]));

    expect(store.active?.name).toBe('Current setup');
    expect(store.active?.settings.theme).toBe('dusk');
    expect(store.active?.settings.planningSpeedKn).toBe(8);
  });

  it('treats a failed initial hydration as a replaceable offline fallback', async () => {
    const remote = profile('remote', 'Remote default', 5, { theme: 'night-red' });
    const store = new ProfileStore(localAdapter());
    const bound = bindings(settings());
    const controller = createProfilesController({
      store,
      bindings: bound.bindings,
      applyRuntime: () => undefined,
    });

    await controller.initialize({
      load: async () => ({ state: 'unavailable' }),
      mutate: async () => 'unavailable',
    });
    const provisionalId = store.activeId;

    expect(store.profiles).toHaveLength(1);
    expect(store.active?.name).toBe('Current setup');

    await controller.sync(
      remoteAdapter([
        {
          profiles: [remote],
          tombstones: [],
          defaultId: remote.id,
          revision: 2,
        },
      ]),
    );

    expect(store.activeId).toBe(remote.id);
    expect(store.profileById(provisionalId)).toBeUndefined();
    expect(bound.current().theme).toBe('night-red');
  });

  it('replaces an untouched offline fallback with the synchronized default', async () => {
    const remote = profile('remote', 'Remote default', 5, { theme: 'night-red' });
    const store = new ProfileStore(localAdapter());
    const bound = bindings(settings());
    const controller = createProfilesController({
      store,
      bindings: bound.bindings,
      applyRuntime: () => undefined,
    });

    await controller.initializeFallback();
    const provisionalId = store.activeId;
    await controller.sync(
      remoteAdapter([
        {
          profiles: [remote],
          tombstones: [],
          defaultId: remote.id,
          revision: 2,
        },
      ]),
    );

    expect(store.activeId).toBe(remote.id);
    expect(store.profileById(provisionalId)).toBeUndefined();
    expect(bound.current().theme).toBe('night-red');
  });

  it('keeps a changed offline fallback when synchronization later succeeds', async () => {
    const remote = profile('remote', 'Remote default', 5, { theme: 'night-red' });
    const store = new ProfileStore(localAdapter());
    const bound = bindings(settings());
    const controller = createProfilesController({
      store,
      bindings: bound.bindings,
      applyRuntime: () => undefined,
    });

    await controller.initializeFallback();
    await tick();
    const provisionalId = store.activeId;
    bound.set(settings({ theme: 'dusk' }));
    controller.observeSettings();
    controller.flushAutosave();
    await controller.sync(
      remoteAdapter([
        {
          profiles: [remote],
          tombstones: [],
          defaultId: remote.id,
          revision: 2,
        },
      ]),
    );

    expect(store.activeId).toBe(provisionalId);
    expect(store.active?.settings.theme).toBe('dusk');
    expect(store.profileById(remote.id)).toBeDefined();
  });

  it('keeps a renamed offline fallback when synchronization later succeeds', async () => {
    const remote = profile('remote', 'Remote default', 5, { theme: 'night-red' });
    const store = new ProfileStore(localAdapter());
    const bound = bindings(settings());
    const controller = createProfilesController({
      store,
      bindings: bound.bindings,
      applyRuntime: () => undefined,
    });

    await controller.initializeFallback();
    const provisionalId = store.activeId;
    if (!provisionalId) throw new Error('Offline fallback was not created.');
    store.rename(provisionalId, 'Offline custom');
    await controller.sync(
      remoteAdapter([
        {
          profiles: [remote],
          tombstones: [],
          defaultId: remote.id,
          revision: 2,
        },
      ]),
    );

    expect(store.activeId).toBe(provisionalId);
    expect(store.active?.name).toBe('Offline custom');
  });

  it('restores autosave suppression when applying a profile throws', async () => {
    const first = profile('p1', 'First', 1);
    const second = profile('p2', 'Second', 1, { theme: 'dusk' });
    const store = new ProfileStore(
      localAdapter({
        profiles: [first, second],
        activeId: first.id,
        defaultId: undefined,
      }),
    );
    const bound = bindings(first.settings);
    let throwNext = false;
    const controller = createProfilesController({
      store,
      bindings: {
        ...bound.bindings,
        apply: (next) => {
          if (throwNext) {
            throwNext = false;
            throw new Error('map failed');
          }
          bound.bindings.apply(next);
        },
      },
      applyRuntime: () => undefined,
    });
    await controller.initialize();
    await tick();
    throwNext = true;

    expect(() => controller.apply(second.id)).toThrow('map failed');
    bound.set(settings({ planningSpeedKn: 9 }));
    controller.observeSettings();
    controller.flushAutosave();

    expect(store.active?.settings.planningSpeedKn).toBe(9);
  });
});

function emptySnapshot(): RemoteProfilesSnapshot {
  return {
    profiles: [],
    tombstones: [],
    defaultId: undefined,
    revision: 0,
  };
}
