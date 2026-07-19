import { describe, expect, it, vi } from 'vitest';
import type {
  Profile,
  ProfileServerMutation,
  ProfileSettings,
  ProfilesState,
  RemoteProfilesSnapshot,
} from './profile-types';
import { MAX_PROFILES } from './profile-validation';
import {
  type AsyncProfileAdapter,
  type ProfileAdapter,
  ProfileStore,
} from './profiles-store.svelte';

function fakeAdapter(initial?: ProfilesState): ProfileAdapter & { saved: ProfilesState[] } {
  let state = initial;
  const saved: ProfilesState[] = [];
  return {
    saved,
    load: () => state,
    save: (next) => {
      state = structuredClone(next);
      saved.push(structuredClone(next));
    },
  };
}

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
    settingUpdatedAt: Object.fromEntries(Object.keys(settings()).map((key) => [key, updatedAt])),
  };
}

function applyMutation(
  snapshot: RemoteProfilesSnapshot,
  mutation: ProfileServerMutation,
): RemoteProfilesSnapshot {
  const profiles = new Map(snapshot.profiles.map((item) => [item.id, structuredClone(item)]));
  const tombstones = new Map(snapshot.tombstones.map((item) => [item.id, structuredClone(item)]));
  for (const operation of mutation.profiles) {
    if (operation.type === 'put') {
      profiles.set(operation.profile.id, structuredClone(operation.profile));
      tombstones.delete(operation.profile.id);
    } else if (operation.type === 'delete') {
      profiles.delete(operation.tombstone.id);
      tombstones.set(operation.tombstone.id, structuredClone(operation.tombstone));
    } else if (operation.type === 'rename') {
      const item = profiles.get(operation.id);
      if (item) {
        item.name = operation.name;
        item.nameUpdatedAt = operation.nameUpdatedAt;
        item.updatedAt = operation.updatedAt;
      }
    } else {
      const item = profiles.get(operation.id);
      if (item) {
        Object.assign(item.settings, structuredClone(operation.settings));
        item.settingUpdatedAt = {
          ...item.settingUpdatedAt,
          ...operation.settingUpdatedAt,
        };
        item.updatedAt = operation.updatedAt;
      }
    }
  }
  return {
    profiles: [...profiles.values()],
    tombstones: [...tombstones.values()],
    defaultId:
      mutation.defaultId === null
        ? undefined
        : mutation.defaultId === undefined
          ? snapshot.defaultId
          : mutation.defaultId,
    revision: snapshot.revision + 1,
  };
}

function fakeServer(initial: RemoteProfilesSnapshot): AsyncProfileAdapter & {
  mutations: ProfileServerMutation[];
  snapshot(): RemoteProfilesSnapshot;
} {
  let state = structuredClone(initial);
  const mutations: ProfileServerMutation[] = [];
  return {
    mutations,
    snapshot: () => structuredClone(state),
    load: async () => ({ state: 'ok', snapshot: structuredClone(state) }),
    mutate: async (revision, mutation) => {
      if (revision !== state.revision) return 'conflict';
      mutations.push(structuredClone(mutation));
      state = applyMutation(state, mutation);
      return 'ok';
    },
  };
}

const emptyRemote = (): RemoteProfilesSnapshot => ({
  profiles: [],
  tombstones: [],
  defaultId: undefined,
  revision: 0,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ProfileStore local behavior', () => {
  it('drops malformed stored profiles and invalid active ids', () => {
    const good = profile('good', 'Good', 1);
    const store = new ProfileStore(
      fakeAdapter({
        profiles: [good, { id: 'bad' } as unknown as Profile],
        activeId: 'bad',
        defaultId: undefined,
      }),
    );
    expect(store.profiles.map((item) => item.id)).toEqual(['good']);
    expect(store.activeId).toBeUndefined();
  });

  it('drops pending writes that no longer have a profile', () => {
    const store = new ProfileStore(
      fakeAdapter({
        profiles: [],
        activeId: undefined,
        defaultId: undefined,
        pending: {
          profiles: { orphan: { full: true } },
          defaultId: 'orphan',
        },
      }),
    );

    expect(store.hasPendingChanges).toBe(false);
    expect(store.syncState).toBe('local');
  });

  it('rejects prototype-sensitive profile ids at the persistence boundary', () => {
    const unsafe = profile('__proto__', 'Unsafe', 1);
    const store = new ProfileStore(
      fakeAdapter({
        profiles: [unsafe],
        activeId: unsafe.id,
        defaultId: unsafe.id,
      }),
    );

    expect(store.profiles).toEqual([]);
    expect(store.activeId).toBeUndefined();
  });

  it('rejects profile ids containing server-blocked patch path segments', () => {
    const unsafe = profile('helm.__proto__.day', 'Unsafe', 1);
    const store = new ProfileStore(
      fakeAdapter({
        profiles: [unsafe],
        activeId: unsafe.id,
        defaultId: unsafe.id,
      }),
    );

    expect(store.profiles).toEqual([]);
  });

  it('removes legacy device and safety state from locally stored profiles', () => {
    const legacy = profile('legacy', 'Legacy', 1, {
      layerCategories: { charts: true },
      arrivalMuted: true,
    });
    const store = new ProfileStore(
      fakeAdapter({
        profiles: [legacy],
        activeId: legacy.id,
        defaultId: undefined,
      }),
    );

    expect(store.active?.settings).not.toHaveProperty('layerCategories');
    expect(store.active?.settings).not.toHaveProperty('arrivalMuted');
  });

  it('rejects oversized extension data and extra nested setting fields', () => {
    const oversized = profile('large', 'Large', 1, {
      future: 'x'.repeat(4_097),
    } as Partial<ProfileSettings>);
    const nestedExtra = profile('nested', 'Nested', 1);
    Object.assign(nestedExtra.settings.thresholds, { unexpected: 'large payload' });
    const store = new ProfileStore(
      fakeAdapter({
        profiles: [oversized, nestedExtra],
        activeId: oversized.id,
        defaultId: undefined,
      }),
    );

    expect(store.profiles).toEqual([]);
  });

  it('accepts bounded forward-compatible settings and their field clocks', () => {
    const future = profile('future', 'Future', 10, {
      futureDisplay: { density: 2 },
    } as Partial<ProfileSettings>);
    future.settingUpdatedAt = { ...future.settingUpdatedAt, futureDisplay: 10 };
    const store = new ProfileStore(
      fakeAdapter({
        profiles: [future],
        activeId: future.id,
        defaultId: undefined,
      }),
    );

    expect(store.active?.settings).toHaveProperty('futureDisplay');
    expect(store.active?.settingUpdatedAt?.futureDisplay).toBe(10);
  });

  it('rejects prototype-sensitive extension and field-clock keys', () => {
    const unsafeSetting = profile('unsafe-setting', 'Unsafe setting', 10);
    Object.defineProperty(unsafeSetting.settings, '__proto__', {
      enumerable: true,
      value: { arrivalMuted: true },
    });
    const unsafeClock = profile('unsafe-clock', 'Unsafe clock', 10);
    Object.defineProperty(unsafeClock.settingUpdatedAt ?? {}, 'constructor', {
      enumerable: true,
      value: 10,
    });
    const store = new ProfileStore(
      fakeAdapter({
        profiles: [unsafeSetting, unsafeClock],
        activeId: unsafeSetting.id,
        defaultId: undefined,
      }),
    );

    expect(store.profiles).toEqual([]);
    expect(store.activeId).toBeUndefined();
  });

  it('saves a profile locally, marks it pending, and keeps the active selection device-local', () => {
    const adapter = fakeAdapter();
    const store = new ProfileStore(adapter);
    const saved = store.save('Coastal', settings());
    store.setActive(saved.id);
    expect(store.activeId).toBe(saved.id);
    expect(store.hasPendingChanges).toBe(true);
    expect(adapter.saved.at(-1)?.activeId).toBe(saved.id);
  });

  it('stores the profile library separately from device-local selection state', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    try {
      const store = new ProfileStore();
      const saved = store.save('Split storage', settings());
      store.setActive(saved.id);

      const library = JSON.parse(values.get('binnacle:profiles') ?? '{}') as Record<
        string,
        unknown
      >;
      const device = JSON.parse(values.get('binnacle:profile-device') ?? '{}') as Record<
        string,
        unknown
      >;
      expect(library).not.toHaveProperty('activeId');
      expect(library).not.toHaveProperty('applied');
      expect(device.activeId).toBe(saved.id);
      expect(device).toHaveProperty('applied');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps a valid profile library when device-only state is corrupt', () => {
    const valid = profile('valid', 'Valid library', 1);
    const values = new Map<string, string>([
      [
        'binnacle:profiles',
        JSON.stringify({
          schemaVersion: 2,
          profiles: [valid],
          defaultId: valid.id,
        }),
      ],
      ['binnacle:profile-device', '{invalid json'],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    try {
      const store = new ProfileStore();

      expect(store.profiles.map((item) => item.id)).toEqual([valid.id]);
      expect(store.defaultId).toBe(valid.id);
      expect(store.activeId).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('starts with an empty profile library when browser storage access is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new DOMException('Blocked by browser policy', 'SecurityError');
      },
      setItem: vi.fn(),
    });
    try {
      expect(() => new ProfileStore()).not.toThrow();
      expect(new ProfileStore().profiles).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('updates only changed portable fields and preserves forward-compatible settings', () => {
    const store = new ProfileStore(fakeAdapter());
    const saved = store.save('Anchor', settings({ mode: 'anchor' }));
    store.update(saved.id, settings({ planningSpeedKn: 8 }));
    const updated = store.profileById(saved.id);
    expect(updated?.settings.planningSpeedKn).toBe(8);
    expect(updated?.settings.mode).toBe('anchor');
    expect(updated?.settingUpdatedAt?.planningSpeedKn).toBeGreaterThan(
      saved.settingUpdatedAt?.planningSpeedKn ?? 0,
    );
  });

  it('keeps timestamps monotonic when the browser clock moves backward', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1);
    try {
      const store = new ProfileStore(fakeAdapter());
      const saved = store.save('Coastal', settings());
      now.mockReturnValue(0);
      store.rename(saved.id, 'Inshore');
      expect(store.profileById(saved.id)?.updatedAt).toBeGreaterThan(saved.updatedAt);
      expect(store.profileById(saved.id)?.nameUpdatedAt).toBe(2);
    } finally {
      now.mockRestore();
    }
  });

  it('does not overflow a validated maximum timestamp', () => {
    const exhausted = profile('max', 'Maximum', Number.MAX_SAFE_INTEGER);
    const adapter = fakeAdapter({
      profiles: [exhausted],
      activeId: exhausted.id,
      defaultId: undefined,
    });
    const store = new ProfileStore(adapter);

    store.rename(exhausted.id, 'Still valid');

    expect(store.active?.updatedAt).toBe(Number.MAX_SAFE_INTEGER);
    expect(new ProfileStore(adapter).active?.name).toBe('Still valid');
  });

  it('records a tombstone so a deleted profile cannot reappear on the next sync', async () => {
    const store = new ProfileStore(fakeAdapter());
    const saved = store.save('Coastal', settings());
    const server = fakeServer(emptyRemote());
    await store.syncWithServer(server);
    await flush();
    store.remove(saved.id);
    await flush();
    expect(server.snapshot().profiles).toEqual([]);
    expect(server.snapshot().tombstones.map((item) => item.id)).toEqual([saved.id]);
  });
});

describe('ProfileStore server synchronization', () => {
  it('rejects a remote profile with prototype-sensitive extension keys before merging', async () => {
    const local = profile('p1', 'Local', 2);
    const remote = profile('p1', 'Remote', 3);
    Object.defineProperty(remote.settings, '__proto__', {
      enumerable: true,
      value: { arrivalMuted: true },
    });
    Object.defineProperty(remote.settingUpdatedAt ?? {}, '__proto__', {
      enumerable: true,
      value: 3,
    });
    const store = new ProfileStore(
      fakeAdapter({ profiles: [local], activeId: local.id, defaultId: undefined }),
    );
    const server: AsyncProfileAdapter = {
      load: async () => ({
        state: 'ok',
        snapshot: {
          profiles: [remote],
          tombstones: [],
          defaultId: undefined,
          revision: 1,
        },
      }),
      mutate: async () => 'ok',
    };

    const result = await store.syncWithServer(server);

    expect(result.ok).toBe(false);
    expect(store.syncState).toBe('error');
    expect(store.active?.name).toBe('Local');
    expect(store.active?.settings.arrivalMuted).toBeUndefined();
    expect(Object.getPrototypeOf(store.active?.settings)).toBe(Object.prototype);
  });

  it('rebases pending local settings and names above newer remote clocks', async () => {
    const local = profile('p1', 'Offline name', 2, { theme: 'day' });
    local.settingUpdatedAt = { theme: 2 };
    local.nameUpdatedAt = 2;
    const remote = profile('p1', 'Remote name', 5, { theme: 'dusk' });
    remote.settingUpdatedAt = { theme: 5 };
    remote.nameUpdatedAt = 5;
    const store = new ProfileStore(
      fakeAdapter({
        profiles: [local],
        activeId: local.id,
        defaultId: undefined,
        pending: {
          profiles: {
            [local.id]: { settings: { theme: 2 }, nameUpdatedAt: 2 },
          },
        },
      }),
    );
    const server = fakeServer({
      profiles: [remote],
      tombstones: [],
      defaultId: undefined,
      revision: 3,
    });

    await store.syncWithServer(server);
    await flush();

    expect(server.snapshot().profiles[0].name).toBe('Offline name');
    expect(server.snapshot().profiles[0].nameUpdatedAt).toBe(6);
    expect(server.snapshot().profiles[0].settings.theme).toBe('day');
    expect(server.snapshot().profiles[0].settingUpdatedAt?.theme).toBe(6);
  });

  it('rebases a pending deletion above a newer remote profile clock', async () => {
    const remote = profile('p1', 'Remote', 5);
    const server = fakeServer({
      profiles: [remote],
      tombstones: [],
      defaultId: undefined,
      revision: 3,
    });
    const store = new ProfileStore(
      fakeAdapter({
        profiles: [],
        activeId: undefined,
        defaultId: undefined,
        tombstones: [{ id: remote.id, deletedAt: 2 }],
        pending: { profiles: { [remote.id]: { deletedAt: 2 } } },
      }),
    );

    await store.syncWithServer(server);
    await flush();

    expect(server.snapshot().profiles).toEqual([]);
    expect(server.snapshot().tombstones).toEqual([{ id: remote.id, deletedAt: 6 }]);
  });

  it('prefers the remote value when equal clocks have no pending local mutation', async () => {
    const local = profile('p1', 'Local name', 5, { theme: 'day' });
    const remote = profile('p1', 'Remote name', 5, { theme: 'dusk' });
    local.settingUpdatedAt = { theme: 5 };
    remote.settingUpdatedAt = { theme: 5 };
    local.nameUpdatedAt = 5;
    remote.nameUpdatedAt = 5;
    const store = new ProfileStore(
      fakeAdapter({ profiles: [local], activeId: 'p1', defaultId: undefined }),
    );

    await store.syncWithServer(
      fakeServer({
        profiles: [remote],
        tombstones: [],
        defaultId: undefined,
        revision: 3,
      }),
    );

    expect(store.active?.name).toBe('Remote name');
    expect(store.active?.settings.theme).toBe('dusk');
  });

  it('merges different fields from two stations instead of replacing the whole profile', async () => {
    const local = profile('p1', 'Coastal', 4, { planningSpeedKn: 9, theme: 'day' });
    local.settingUpdatedAt = { planningSpeedKn: 4, theme: 1 };
    const remote = profile('p1', 'Coastal', 5, { planningSpeedKn: 6, theme: 'night-red' });
    remote.settingUpdatedAt = { planningSpeedKn: 2, theme: 5 };
    const store = new ProfileStore(
      fakeAdapter({ profiles: [local], activeId: 'p1', defaultId: undefined }),
    );
    const server = fakeServer({
      profiles: [remote],
      tombstones: [],
      defaultId: undefined,
      revision: 3,
    });

    await store.syncWithServer(server);
    await flush();
    expect(store.active?.settings.planningSpeedKn).toBe(9);
    expect(store.active?.settings.theme).toBe('night-red');
    expect(store.activeId).toBe('p1');
    expect(server.snapshot().profiles[0].settings.planningSpeedKn).toBe(9);
    expect(server.snapshot().profiles[0].settings.theme).toBe('night-red');
  });

  it('does not let a pending stock seed replace a customized copy with the same stable id', async () => {
    const store = new ProfileStore(fakeAdapter());
    store.seed([profile('starter', 'Coastal day', 1)]);
    const customized = profile('starter', 'My coastal helm', 20, {
      instrumentTiles: ['battery:house'],
    });
    const server = fakeServer({
      profiles: [customized],
      tombstones: [],
      defaultId: customized.id,
      revision: 4,
    });

    await store.syncWithServer(server);
    await flush();

    expect(store.profileById('starter')?.name).toBe('My coastal helm');
    expect(store.profileById('starter')?.settings.instrumentTiles).toEqual(['battery:house']);
    expect(server.snapshot().profiles[0].name).toBe('My coastal helm');
  });

  it('preserves forward-compatible fields while merging a newer local portable setting', async () => {
    const local = profile('p1', 'Coastal', 8, { planningSpeedKn: 9 });
    const remote = profile('p1', 'Coastal', 5, { mode: 'anchor' });
    local.settingUpdatedAt = { planningSpeedKn: 8 };
    remote.settingUpdatedAt = { planningSpeedKn: 2 };
    const store = new ProfileStore(
      fakeAdapter({ profiles: [local], activeId: 'p1', defaultId: undefined }),
    );

    await store.syncWithServer(
      fakeServer({
        profiles: [remote],
        tombstones: [],
        defaultId: undefined,
        revision: 2,
      }),
    );

    expect(store.active?.settings.mode).toBe('anchor');
    expect(store.active?.settings.planningSpeedKn).toBe(9);
  });

  it('keeps each forward-compatible value paired with its winning field clock', async () => {
    const local = profile('p1', 'Coastal', 20, {
      futureMode: 'local-old',
    } as Partial<ProfileSettings>);
    local.settingUpdatedAt = { futureMode: 3 };
    const remote = profile('p1', 'Coastal', 10, {
      futureMode: 'remote-new',
    } as Partial<ProfileSettings>);
    remote.settingUpdatedAt = { futureMode: 7 };
    const store = new ProfileStore(
      fakeAdapter({ profiles: [local], activeId: 'p1', defaultId: undefined }),
    );

    await store.syncWithServer(
      fakeServer({
        profiles: [remote],
        tombstones: [],
        defaultId: undefined,
        revision: 2,
      }),
    );

    expect(
      (store.active?.settings as unknown as Record<string, unknown> | undefined)?.futureMode,
    ).toBe('remote-new');
    expect(store.active?.settingUpdatedAt?.futureMode).toBe(7);
  });

  it('surfaces a capacity conflict without dropping local profiles or pushing a truncated union', async () => {
    const locals = Array.from({ length: MAX_PROFILES }, (_, index) =>
      profile(`local-${index}`, `Local ${index}`, index + 1),
    );
    const remote = profile('remote-only', 'Remote only', MAX_PROFILES + 1);
    const store = new ProfileStore(
      fakeAdapter({ profiles: locals, activeId: locals.at(-1)?.id, defaultId: undefined }),
    );
    const server = fakeServer({
      profiles: [remote],
      tombstones: [],
      defaultId: undefined,
      revision: 1,
    });

    const result = await store.syncWithServer(server);

    expect(result.ok).toBe(false);
    expect(store.syncState).toBe('capacity-conflict');
    expect(store.profiles).toHaveLength(MAX_PROFILES);
    expect(store.activeId).toBe(locals.at(-1)?.id);
    expect(store.profileById(remote.id)).toBeUndefined();
    expect(server.mutations).toEqual([]);
  });

  it('keeps the remote active id out of device state and adopts the remote default', async () => {
    const remote = profile('p1', 'Coastal', 2);
    const store = new ProfileStore(fakeAdapter());
    await store.syncWithServer(
      fakeServer({
        profiles: [remote],
        tombstones: [],
        defaultId: 'p1',
        revision: 1,
      }),
    );
    expect(store.activeId).toBeUndefined();
    expect(store.defaultId).toBe('p1');
  });

  it('hydrates readable server profiles while keeping local edits queued without write access', async () => {
    const remote = profile('p1', 'Coastal', 2);
    const store = new ProfileStore(fakeAdapter());
    await store.syncWithServer({
      load: async () => ({
        state: 'ok',
        snapshot: {
          profiles: [remote],
          tombstones: [],
          defaultId: remote.id,
          revision: 0,
        },
        writable: false,
      }),
      mutate: async () => 'unavailable',
    });

    expect(store.profileById(remote.id)?.name).toBe('Coastal');
    expect(store.defaultId).toBe(remote.id);
    expect(store.syncState).toBe('waiting');
  });

  it('reports when a remote merge changes the locally active profile', async () => {
    const local = profile('p1', 'Coastal', 1, { theme: 'day' });
    const remote = profile('p1', 'Coastal', 2, { theme: 'dusk' });
    const store = new ProfileStore(
      fakeAdapter({ profiles: [local], activeId: 'p1', defaultId: undefined }),
    );
    const result = await store.syncWithServer(
      fakeServer({
        profiles: [remote],
        tombstones: [],
        defaultId: undefined,
        revision: 2,
      }),
    );
    expect(result.activeChanged).toBe(true);
    expect(store.remoteUpdateAvailable).toBe(true);
  });

  it('persists the last-applied setup when a remote update awaits approval', async () => {
    const local = profile('p1', 'Coastal', 1, { theme: 'day' });
    const remote = profile('p1', 'Coastal', 2, { theme: 'dusk' });
    const adapter = fakeAdapter({
      profiles: [local],
      activeId: 'p1',
      defaultId: undefined,
    });
    const store = new ProfileStore(adapter);

    await store.syncWithServer(
      fakeServer({
        profiles: [remote],
        tombstones: [],
        defaultId: undefined,
        revision: 2,
      }),
    );
    const restarted = new ProfileStore(adapter);

    expect(restarted.active?.settings.theme).toBe('dusk');
    expect(restarted.appliedSettings?.theme).toBe('day');
    expect(restarted.remoteUpdateAvailable).toBe(true);
  });

  it('rebases and retries a revision conflict', async () => {
    const store = new ProfileStore(fakeAdapter());
    store.save('Coastal', settings());
    const server = fakeServer(emptyRemote());
    const mutate = server.mutate.bind(server);
    let conflicted = false;
    server.mutate = async (revision, mutation) => {
      if (!conflicted) {
        conflicted = true;
        return 'conflict';
      }
      return mutate(revision, mutation);
    };
    await store.syncWithServer(server);
    await flush();
    await flush();
    expect(server.snapshot().profiles).toHaveLength(1);
    expect(store.syncState).toBe('synced');
  });

  it('retains local pending changes when the server is unavailable', async () => {
    const adapter = fakeAdapter();
    const store = new ProfileStore(adapter);
    store.save('Coastal', settings());
    const result = await store.syncWithServer({
      load: async () => ({ state: 'unavailable' }),
      mutate: async () => 'unavailable',
    });
    expect(result.ok).toBe(false);
    expect(store.hasPendingChanges).toBe(true);
    expect(store.syncState).toBe('waiting');

    const restarted = new ProfileStore(adapter);
    expect(restarted.hasPendingChanges).toBe(true);
    expect(restarted.profiles).toHaveLength(1);
  });

  it('does not recreate local profile data after persistence is suspended', async () => {
    let persisted: ProfilesState | undefined;
    let finishMutation: ((result: 'ok') => void) | undefined;
    let mutationStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      mutationStarted = resolve;
    });
    const adapter: ProfileAdapter = {
      load: () => persisted,
      save: (state) => {
        persisted = structuredClone(state);
      },
    };
    const store = new ProfileStore(adapter);
    store.save('Offline', settings());
    await store.syncWithServer({
      load: async () => ({ state: 'ok', snapshot: emptyRemote() }),
      mutate: async () => {
        mutationStarted?.();
        return new Promise<'ok'>((resolve) => {
          finishMutation = resolve;
        });
      },
    });
    await started;

    store.suspendPersistence();
    persisted = undefined;
    finishMutation?.('ok');
    await flush();
    await flush();

    expect(persisted).toBeUndefined();
    expect(new ProfileStore(adapter).profiles).toEqual([]);
  });
});
