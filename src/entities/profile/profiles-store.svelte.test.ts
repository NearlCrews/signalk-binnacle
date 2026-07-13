import { describe, expect, it, vi } from 'vitest';
import type { Profile, ProfileSettings, ProfilesState } from './profile-types';
import {
  type AsyncProfileAdapter,
  type ProfileAdapter,
  ProfileStore,
} from './profiles-store.svelte';

// An in-memory adapter so tests never touch localStorage. It can be seeded with stored state and
// records every save for asserting persistence.
function fakeAdapter(initial?: ProfilesState): ProfileAdapter & { saved: ProfilesState[] } {
  let state = initial;
  const saved: ProfilesState[] = [];
  return {
    saved,
    load: () => state,
    save: (next: ProfilesState) => {
      state = next;
      saved.push(structuredClone(next));
    },
  };
}

// An in-memory async server adapter, recording every push for asserting the single-flight sync.
function fakeServer(initial?: ProfilesState): AsyncProfileAdapter & { saved: ProfilesState[] } {
  let state = initial;
  const saved: ProfilesState[] = [];
  return {
    saved,
    load: async () => state,
    save: async (next: ProfilesState) => {
      state = next;
      saved.push(structuredClone(next));
      return true;
    },
  };
}

const profile = (id: string, name: string, updatedAt: number): Profile => ({
  id,
  name,
  settings: settings(),
  createdAt: 1,
  updatedAt,
});

// Let the single-flight push runner finish: it is started but not awaited by syncWithServer/#persist.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ProfileStore load guard', () => {
  it('drops a malformed stored profile at load', () => {
    const good = profile('good', 'Good', 1);
    const adapter = fakeAdapter({
      profiles: [good, { id: 'bad' } as unknown as Profile, null as unknown as Profile],
      activeId: undefined,
      defaultId: undefined,
    });
    const store = new ProfileStore(adapter);
    expect(store.profiles.map((p) => p.id)).toEqual(['good']);
  });

  it('loads empty without throwing when the stored profiles field is a truthy non-array', () => {
    const adapter = fakeAdapter({
      profiles: 'corrupt' as unknown as Profile[],
      activeId: 'p1',
      defaultId: undefined,
    });
    const store = new ProfileStore(adapter);
    expect(store.profiles).toEqual([]);
    expect(store.activeId).toBeUndefined();
  });
});

const settings = (overrides: Partial<ProfileSettings> = {}): ProfileSettings => ({
  theme: 'day',
  layers: {},
  layerOrder: [],
  layerCategories: {},
  weatherLayers: {},
  thresholds: {
    dangerCpaMeters: 926,
    dangerTcpaSeconds: 600,
    warningCpaMeters: 1852,
    warningTcpaSeconds: 1200,
  },
  trackSettings: { intervalSeconds: 10, minMeters: 10, colorMode: 'speed' },
  planningSpeedKn: 6,
  arrivalMuted: false,
  ...overrides,
});

describe('ProfileStore', () => {
  it('loads stored state into the runes on construction', () => {
    const stored: ProfilesState = {
      profiles: [{ id: 'p1', name: 'Coastal', settings: settings(), createdAt: 1, updatedAt: 1 }],
      activeId: 'p1',
      defaultId: 'p1',
    };
    const store = new ProfileStore(fakeAdapter(stored));
    expect(store.profiles.map((p) => p.id)).toEqual(['p1']);
    expect(store.activeId).toBe('p1');
    expect(store.defaultId).toBe('p1');
    expect(store.active?.name).toBe('Coastal');
  });

  it('starts empty when the adapter has nothing stored', () => {
    const store = new ProfileStore(fakeAdapter());
    expect(store.profiles).toEqual([]);
    expect(store.activeId).toBeUndefined();
    expect(store.defaultId).toBeUndefined();
    expect(store.active).toBeUndefined();
  });

  it('appends a saved profile with a fresh id and timestamps', () => {
    const adapter = fakeAdapter();
    const store = new ProfileStore(adapter);
    const a = store.save('Coastal', settings());
    const b = store.save('Offshore', settings());
    expect(store.profiles.map((p) => p.name)).toEqual(['Coastal', 'Offshore']);
    expect(a.id).not.toBe(b.id);
    expect(a.createdAt).toBe(a.updatedAt);
    expect(adapter.saved.at(-1)?.profiles).toHaveLength(2);
  });

  it('rewrites settings on update while keeping the id', () => {
    const store = new ProfileStore(fakeAdapter());
    const p = store.save('Coastal', settings({ planningSpeedKn: 6 }));
    store.update(p.id, settings({ planningSpeedKn: 9 }));
    const updated = store.profiles.find((x) => x.id === p.id);
    expect(updated?.id).toBe(p.id);
    expect(updated?.settings.planningSpeedKn).toBe(9);
  });

  it('renames a profile, changing the name only', () => {
    const store = new ProfileStore(fakeAdapter());
    const p = store.save('Coastal', settings({ planningSpeedKn: 6 }));
    store.rename(p.id, 'Inshore');
    const renamed = store.profiles.find((x) => x.id === p.id);
    expect(renamed?.name).toBe('Inshore');
    expect(renamed?.settings.planningSpeedKn).toBe(6);
  });

  it('removes a profile and resets active and default when they matched it', () => {
    const store = new ProfileStore(fakeAdapter());
    const p = store.save('Coastal', settings());
    store.setActive(p.id);
    store.setDefault(p.id);
    store.remove(p.id);
    expect(store.profiles).toEqual([]);
    expect(store.activeId).toBeUndefined();
    expect(store.defaultId).toBeUndefined();
  });

  it('leaves active and default intact when removing a different profile', () => {
    const store = new ProfileStore(fakeAdapter());
    const keep = store.save('Coastal', settings());
    const drop = store.save('Offshore', settings());
    store.setActive(keep.id);
    store.setDefault(keep.id);
    store.remove(drop.id);
    expect(store.profiles.map((p) => p.id)).toEqual([keep.id]);
    expect(store.activeId).toBe(keep.id);
    expect(store.defaultId).toBe(keep.id);
  });

  it('persists the default and reflects it through the getter', () => {
    const adapter = fakeAdapter();
    const store = new ProfileStore(adapter);
    const p = store.save('Coastal', settings());
    store.setDefault(p.id);
    expect(store.defaultId).toBe(p.id);
    expect(adapter.saved.at(-1)?.defaultId).toBe(p.id);
  });

  it('clears the dirty flag on setActive', () => {
    const store = new ProfileStore(fakeAdapter());
    const p = store.save('Coastal', settings());
    store.setActive(p.id);
    store.markDirty();
    expect(store.isDirty).toBe(true);
    store.setActive(p.id);
    expect(store.isDirty).toBe(false);
  });

  it('marks dirty only when a profile is active', () => {
    const store = new ProfileStore(fakeAdapter());
    store.markDirty();
    expect(store.isDirty).toBe(false);
    const p = store.save('Coastal', settings());
    store.setActive(p.id);
    store.markDirty();
    expect(store.isDirty).toBe(true);
  });

  it('clears the dirty flag on clearDirty', () => {
    const store = new ProfileStore(fakeAdapter());
    const p = store.save('Coastal', settings());
    store.setActive(p.id);
    store.markDirty();
    store.clearDirty();
    expect(store.isDirty).toBe(false);
  });

  it('calls adapter.save on each mutation', () => {
    const adapter = fakeAdapter();
    const saveSpy = vi.spyOn(adapter, 'save');
    const store = new ProfileStore(adapter);
    const p = store.save('Coastal', settings());
    store.update(p.id, settings({ planningSpeedKn: 8 }));
    store.rename(p.id, 'Inshore');
    store.setDefault(p.id);
    store.setActive(p.id);
    store.remove(p.id);
    expect(saveSpy).toHaveBeenCalledTimes(6);
  });

  it('round-trips the reserved mode field unchanged', () => {
    const adapter = fakeAdapter();
    const store = new ProfileStore(adapter);
    const p = store.save('Anchor watch', settings({ mode: 'anchor' }));
    const persisted = adapter.saved.at(-1)?.profiles.find((x) => x.id === p.id);
    expect(persisted?.settings.mode).toBe('anchor');

    const reloaded = new ProfileStore(fakeAdapter(adapter.saved.at(-1)));
    expect(reloaded.profiles.find((x) => x.id === p.id)?.settings.mode).toBe('anchor');
  });
});

describe('ProfileStore.seed', () => {
  it('populates an empty store and persists', () => {
    const adapter = fakeAdapter();
    const store = new ProfileStore(adapter);
    store.seed([profile('s1', 'Coastal day', 1)]);
    expect(store.profiles.map((p) => p.id)).toEqual(['s1']);
    expect(adapter.saved.at(-1)?.profiles).toHaveLength(1);
  });

  it('is a no-op when the store already has profiles', () => {
    const store = new ProfileStore(fakeAdapter());
    store.save('Existing', settings());
    store.seed([profile('s1', 'Seed', 1)]);
    expect(store.profiles.map((p) => p.name)).toEqual(['Existing']);
  });
});

describe('ProfileStore.syncWithServer', () => {
  it('merges remote profiles by id with the later updatedAt winning, and pushes the result', async () => {
    const store = new ProfileStore(
      fakeAdapter({
        profiles: [profile('p1', 'Local v1', 1)],
        activeId: 'p1',
        defaultId: undefined,
      }),
    );
    const server = fakeServer({
      profiles: [profile('p1', 'Remote v2', 5), profile('p2', 'Remote only', 2)],
      activeId: 'p2',
      defaultId: 'p2',
    });
    await store.syncWithServer(server);
    const byId = Object.fromEntries(store.profiles.map((p) => [p.id, p.name]));
    expect(byId).toEqual({ p1: 'Remote v2', p2: 'Remote only' });
    // The active selection is per-device state: the merge keeps the local activeId so the
    // switcher never shows a profile as Active that this device has not applied.
    expect(store.activeId).toBe('p1');
    expect(store.defaultId).toBe('p2');
    await flush();
    expect(
      server.saved
        .at(-1)
        ?.profiles.map((p) => p.id)
        .sort(),
    ).toEqual(['p1', 'p2']);
  });

  it('drops malformed remote profiles and tolerates a non-array remote profiles field', async () => {
    const localStore = new ProfileStore(
      fakeAdapter({
        profiles: [profile('p1', 'Local', 1)],
        activeId: undefined,
        defaultId: undefined,
      }),
    );
    await localStore.syncWithServer(
      fakeServer({
        profiles: [profile('p2', 'Remote good', 2), { id: 'bad' } as unknown as Profile],
        activeId: undefined,
        defaultId: undefined,
      }),
    );
    expect(localStore.profiles.map((p) => p.id).sort()).toEqual(['p1', 'p2']);

    const corruptStore = new ProfileStore(
      fakeAdapter({
        profiles: [profile('p1', 'Local', 1)],
        activeId: undefined,
        defaultId: undefined,
      }),
    );
    await corruptStore.syncWithServer(
      fakeServer({
        profiles: 'corrupt' as unknown as Profile[],
        activeId: undefined,
        defaultId: undefined,
      }),
    );
    expect(corruptStore.profiles.map((p) => p.id)).toEqual(['p1']);
  });

  it('keeps a newer local profile over an older remote one', async () => {
    const store = new ProfileStore(
      fakeAdapter({
        profiles: [profile('p1', 'Local v3', 10)],
        activeId: undefined,
        defaultId: undefined,
      }),
    );
    const server = fakeServer({
      profiles: [profile('p1', 'Remote v1', 1)],
      activeId: undefined,
      defaultId: undefined,
    });
    await store.syncWithServer(server);
    expect(store.profiles.find((p) => p.id === 'p1')?.name).toBe('Local v3');
  });

  it('degrades to local and does not push when the server is unavailable', async () => {
    const store = new ProfileStore(fakeAdapter());
    const p = store.save('Coastal', settings());
    const save = vi.fn(async () => true);
    // A rejecting load, and an undefined-returning load, both mean unavailable: stay local, no push,
    // and a later mutation must not push either (the adapter was never attached).
    await store.syncWithServer({
      load: async () => {
        throw new Error('offline');
      },
      save,
    });
    await store.syncWithServer({ load: async () => undefined, save });
    store.save('Another', settings());
    await flush();
    expect(store.profiles.map((x) => x.name)).toEqual([p.name, 'Another']);
    expect(save).not.toHaveBeenCalled();
  });

  it('seeds a reachable but empty server from the local profiles', async () => {
    const store = new ProfileStore(fakeAdapter());
    store.save('Coastal', settings());
    const server = fakeServer({ profiles: [], activeId: undefined, defaultId: undefined });
    await store.syncWithServer(server);
    await flush();
    expect(server.saved.at(-1)?.profiles.map((p) => p.name)).toEqual(['Coastal']);
  });

  it('pushes the latest state after a mutation following a sync', async () => {
    const store = new ProfileStore(fakeAdapter());
    const server = fakeServer({ profiles: [], activeId: undefined, defaultId: undefined });
    await store.syncWithServer(server);
    store.save('New profile', settings());
    await flush();
    expect(server.saved.at(-1)?.profiles.map((p) => p.name)).toContain('New profile');
  });

  it('stops pushing after a rejected write, so a read-only server is not hammered', async () => {
    const store = new ProfileStore(fakeAdapter());
    store.save('Coastal', settings());
    // Reachable for reads (the GET succeeds, so the adapter attaches), but every write is rejected,
    // as with a read-only or device token whose POST returns 401.
    const save = vi.fn(async () => false);
    await store.syncWithServer({
      load: async () => ({ profiles: [], activeId: undefined, defaultId: undefined }),
      save,
    });
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    // The first failure detached the server, so a later mutation must not fire another doomed write.
    store.save('Offshore', settings());
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
