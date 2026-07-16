import { tick } from 'svelte';
import type {
  AsyncProfileAdapter,
  PortableProfileSettingKey,
  Profile,
  ProfileSettings,
  ProfileStore,
} from '$entities/profile';
import { PORTABLE_PROFILE_SETTING_KEYS } from '$entities/profile';
import { sameJsonValue } from '$shared/lib';
import type { ProfileBindings } from './profile-bindings';
import { seedStarterProfiles } from './starter-profiles';

interface ProfilesControllerDeps {
  store: ProfileStore;
  bindings: ProfileBindings;
  applyRuntime(settings: ProfileSettings): void;
  autosaveMs?: number;
}

interface PendingAutosave {
  id: string;
  settings: ProfileSettings;
  keys: Set<PortableProfileSettingKey>;
}

export function createProfilesController(deps: ProfilesControllerDeps) {
  const autosaveMs = deps.autosaveMs ?? 350;
  let applying = false;
  let initialized = false;
  let initializing: Promise<void> | undefined;
  let syncing: Promise<void> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingAutosave: PendingAutosave | undefined;
  let lastObserved: ProfileSettings | undefined;
  let applyGeneration = 0;
  let preInitializationChanged = false;
  let suspended = false;
  let provisionalProfileId: string | undefined;
  let provisionalChanged = false;
  let provisionalBaseline:
    | {
        name: string;
        settings: ProfileSettings;
      }
    | undefined;

  function capture(): ProfileSettings {
    return deps.bindings.capture();
  }

  function applySettings(settings: ProfileSettings): void {
    const generation = ++applyGeneration;
    applying = true;
    try {
      deps.bindings.apply(settings);
      deps.applyRuntime(settings);
      lastObserved = capture();
    } catch (error) {
      if (generation === applyGeneration) applying = false;
      throw error;
    }
    void tick().then(() => {
      if (generation === applyGeneration) applying = false;
    });
  }

  function flushAutosave(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = undefined;
    const pending = pendingAutosave;
    pendingAutosave = undefined;
    if (pending && !suspended)
      deps.store.updateFields(pending.id, pending.settings, [...pending.keys]);
  }

  function scheduleAutosave(
    id: string,
    settings: ProfileSettings,
    keys: PortableProfileSettingKey[],
  ): void {
    pendingAutosave = {
      id,
      settings,
      keys: new Set([...(pendingAutosave?.id === id ? pendingAutosave.keys : []), ...keys]),
    };
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushAutosave, autosaveMs);
  }

  function observeSettings(): void {
    deps.bindings.track();
    const current = capture();
    if (!initialized) {
      if (
        lastObserved &&
        PORTABLE_PROFILE_SETTING_KEYS.some(
          (key) => !sameJsonValue(lastObserved?.[key], current[key]),
        )
      ) {
        preInitializationChanged = true;
      }
      lastObserved = current;
      return;
    }
    if (applying || suspended) {
      lastObserved = current;
      return;
    }
    const id = deps.store.activeId;
    if (!id) return;
    const previous = lastObserved;
    lastObserved = current;
    if (!previous) return;
    const changed = PORTABLE_PROFILE_SETTING_KEYS.filter(
      (key) => !sameJsonValue(previous[key], current[key]),
    );
    if (changed.length > 0) {
      if (id === provisionalProfileId) provisionalChanged = true;
      scheduleAutosave(id, current, changed);
    }
  }

  function selectStartupProfile(provisional = false): Profile {
    let profile = deps.store.active;
    if (!profile && deps.store.defaultId) profile = deps.store.profileById(deps.store.defaultId);
    if (profile) return profile;
    if (deps.store.profiles.length === 0) {
      if (preInitializationChanged || provisional) {
        profile = deps.store.save('Current setup', capture());
      } else {
        seedStarterProfiles(deps.store, capture());
        profile = deps.store.profiles[0];
      }
    }
    return profile ?? deps.store.save('Current setup', capture());
  }

  function preserveLocalDrift(): void {
    const active = deps.store.active;
    const applied = deps.store.appliedSettings;
    if (active && applied && !sameJsonValue(applied, capture())) {
      deps.store.update(active.id, capture());
    }
  }

  async function initialize(server?: AsyncProfileAdapter, provisional = false): Promise<void> {
    if (initialized) {
      if (server) await deps.store.syncWithServer(server);
      return;
    }
    if (initializing) return initializing;
    initializing = (async () => {
      try {
        preserveLocalDrift();
        const syncResult = server ? await deps.store.syncWithServer(server) : undefined;
        if (!server) deps.store.setLocalOnly();
        const provisionalStartup = provisional || syncResult?.ok === false;
        const profile = selectStartupProfile(provisionalStartup);
        if (
          provisionalStartup &&
          deps.store.profiles.length === 1 &&
          profile.name === 'Current setup'
        ) {
          provisionalProfileId = profile.id;
          provisionalChanged = preInitializationChanged;
          provisionalBaseline = { name: profile.name, settings: capture() };
        }
        if (deps.store.activeId === profile.id && deps.store.remoteUpdateAvailable) {
          // The cached profile is newer than the setup this browser last applied. Keep the live
          // persisted stores in place until the navigator resolves the remote-update prompt.
          lastObserved = capture();
        } else {
          applySettings(profile.settings);
          deps.store.setActive(profile.id);
        }
        initialized = true;
      } finally {
        initializing = undefined;
      }
    })();
    return initializing;
  }

  function initializeFallback(): Promise<void> {
    return initialize(undefined, true);
  }

  async function sync(server: AsyncProfileAdapter): Promise<void> {
    if (syncing) return syncing;
    if (!initialized) {
      await initialize(server);
      return;
    }
    syncing = (async () => {
      try {
        flushAutosave();
        const activeBefore = deps.store.activeId;
        const provisional = deps.store.profileById(provisionalProfileId);
        const provisionalUntouched =
          provisionalProfileId !== undefined &&
          deps.store.activeId === provisionalProfileId &&
          provisionalBaseline !== undefined &&
          !provisionalChanged &&
          provisional?.name === provisionalBaseline.name &&
          sameJsonValue(provisional.settings, provisionalBaseline.settings);
        const discardProvisional =
          provisionalUntouched && provisionalProfileId ? [provisionalProfileId] : undefined;
        const result = await deps.store.syncWithServer(server, {
          discardUnsyncedProfileIds: discardProvisional,
        });
        if (result.ok && discardProvisional) {
          provisionalProfileId = undefined;
          provisionalChanged = false;
          provisionalBaseline = undefined;
          const profile = selectStartupProfile();
          applySettings(profile.settings);
          deps.store.setActive(profile.id);
          return;
        }
        if (result.ok) {
          provisionalProfileId = undefined;
          provisionalBaseline = undefined;
        }
        if (activeBefore && !deps.store.activeId) {
          const replacement = deps.store.save('Current setup', capture());
          deps.store.setActive(replacement.id);
        }
      } finally {
        syncing = undefined;
      }
    })();
    return syncing;
  }

  function apply(id: string): void {
    flushAutosave();
    const profile = deps.store.profileById(id);
    if (!profile) return;
    applySettings(profile.settings);
    deps.store.setActive(id);
  }

  function applyRemoteUpdate(): void {
    flushAutosave();
    const active = deps.store.active;
    if (!active) return;
    applySettings(active.settings);
    deps.store.markRemoteUpdateApplied();
  }

  function keepCurrentSetup(): void {
    flushAutosave();
    const active = deps.store.active;
    if (!active) return;
    deps.store.update(active.id, capture());
    deps.store.markRemoteUpdateApplied();
  }

  function saveNew(name: string): Profile {
    flushAutosave();
    const profile = deps.store.save(name, capture());
    deps.store.setActive(profile.id);
    return profile;
  }

  function remove(id: string): void {
    flushAutosave();
    const wasActive = deps.store.activeId === id;
    deps.store.remove(id);
    if (!wasActive) return;
    const next = deps.store.profileById(deps.store.defaultId) ?? deps.store.profiles[0];
    if (next) {
      apply(next.id);
      return;
    }
    const replacement = deps.store.save('Current setup', capture());
    deps.store.setActive(replacement.id);
  }

  function suspend(): void {
    suspended = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = undefined;
    pendingAutosave = undefined;
    deps.store.suspendPersistence();
  }

  function resume(): void {
    suspended = false;
    lastObserved = capture();
    deps.store.resumePersistence();
  }

  function dispose(): void {
    if (suspended) return;
    flushAutosave();
  }

  return {
    initialize,
    initializeFallback,
    sync,
    apply,
    applyRemoteUpdate,
    keepCurrentSetup,
    saveNew,
    remove,
    observeSettings,
    flushAutosave,
    dispose,
    suspend,
    resume,
    capture,
  };
}
