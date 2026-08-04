import { isRecord, isSafeNonNegativeInteger, sameJsonValue, uuidv4 } from '$shared/lib';
import { binnacleStorageKey } from '$shared/persistence';
import type {
  PendingProfileChange,
  PortableProfileSettingKey,
  Profile,
  ProfilePendingJournal,
  ProfileServerMutation,
  ProfileSettings,
  ProfilesState,
  ProfileTombstone,
  RemoteProfilesSnapshot,
} from './profile-types';
import { PORTABLE_PROFILE_SETTING_KEYS } from './profile-types';
import {
  adoptStoredProfile,
  cleanProfileId,
  cleanProfileName,
  isProfileSettings,
  isProfileTombstone,
  isStoredProfile,
  MAX_PROFILES,
  sanitizeProfileSettings,
} from './profile-validation';

const STORAGE_KEY = binnacleStorageKey('profiles');
const DEVICE_STORAGE_KEY = binnacleStorageKey('profileDevice');
const MAX_SYNC_RETRIES = 3;

export interface ProfileAdapter {
  load(): ProfilesState | undefined;
  save(state: ProfilesState): void;
}

export type ProfileRemoteLoadResult =
  | { state: 'ok'; snapshot: RemoteProfilesSnapshot; writable?: boolean }
  | { state: 'unavailable' }
  | { state: 'corrupt' };

export type ProfileRemoteMutationResult = 'ok' | 'conflict' | 'unavailable';

export interface AsyncProfileAdapter {
  load(): Promise<ProfileRemoteLoadResult>;
  mutate(revision: number, mutation: ProfileServerMutation): Promise<ProfileRemoteMutationResult>;
}

export type ProfileSyncState =
  | 'local'
  | 'waiting'
  | 'syncing'
  | 'synced'
  | 'conflict'
  | 'capacity-conflict'
  | 'error';

export interface ProfileSyncResult {
  ok: boolean;
  activeChanged: boolean;
}

class LocalProfileAdapter implements ProfileAdapter {
  load(): ProfilesState | undefined {
    if (typeof localStorage === 'undefined') return undefined;
    let raw: string | null;
    let deviceRaw: string | null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
      deviceRaw = localStorage.getItem(DEVICE_STORAGE_KEY);
    } catch {
      // Storage access itself can throw under browser privacy policy. Start with an empty local
      // library, matching the guarded-write behavior, rather than failing app construction.
      return undefined;
    }
    if (raw == null && deviceRaw == null) return undefined;
    let library: Record<string, unknown> | undefined;
    let device: Record<string, unknown> | undefined;
    try {
      const parsedLibrary: unknown = raw == null ? {} : JSON.parse(raw);
      if (isRecord(parsedLibrary)) library = parsedLibrary;
    } catch {
      // A corrupt shared library cannot be recovered from device-only selection state.
    }
    try {
      const parsedDevice: unknown = deviceRaw == null ? undefined : JSON.parse(deviceRaw);
      if (isRecord(parsedDevice)) device = parsedDevice;
    } catch {
      // Keep the valid shared profile library and reset only this device's selection state.
    }
    if (!library) return undefined;
    return {
      profiles: validProfiles(library.profiles),
      activeId: validStoredId(device?.activeId ?? library.activeId),
      defaultId: validStoredId(library.defaultId),
      applied: validApplied(device?.applied ?? library.applied),
      tombstones: validTombstones(library.tombstones),
      pending: validPending(library.pending),
    };
  }

  save(state: ProfilesState): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const { activeId, applied, ...library } = state;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
      localStorage.setItem(
        DEVICE_STORAGE_KEY,
        JSON.stringify({ schemaVersion: 1, activeId, applied }),
      );
    } catch {
      // A failed persist must not break the in-memory profile currently running the chart.
    }
  }
}

function validStoredId(value: unknown): string | undefined {
  return typeof value === 'string' && cleanProfileId(value) === value ? value : undefined;
}

function validApplied(value: unknown): ProfilesState['applied'] {
  if (!isRecord(value)) return undefined;
  const profileId = validStoredId(value.profileId);
  return profileId !== undefined && isProfileSettings(value.settings)
    ? { profileId, settings: value.settings }
    : undefined;
}

function validProfiles(value: unknown): Profile[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const profiles: Profile[] = [];
  for (const profile of value) {
    if (!isStoredProfile(profile) || seen.has(profile.id)) continue;
    seen.add(profile.id);
    profiles.push(adoptStoredProfile(profile));
    if (profiles.length >= MAX_PROFILES) break;
  }
  return profiles;
}

function validTombstones(value: unknown): ProfileTombstone[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, ProfileTombstone>();
  for (const item of value) {
    if (!isProfileTombstone(item)) continue;
    const existing = byId.get(item.id);
    if (!existing || item.deletedAt > existing.deletedAt) byId.set(item.id, item);
    if (byId.size >= MAX_PROFILES) break;
  }
  return [...byId.values()];
}

function validRemoteSnapshot(snapshot: RemoteProfilesSnapshot): boolean {
  if (
    !isSafeNonNegativeInteger(snapshot.revision) ||
    !Array.isArray(snapshot.profiles) ||
    snapshot.profiles.length > MAX_PROFILES ||
    !Array.isArray(snapshot.tombstones) ||
    snapshot.tombstones.length > MAX_PROFILES * 10
  ) {
    return false;
  }
  const profiles = validProfiles(snapshot.profiles);
  if (profiles.length !== snapshot.profiles.length) return false;
  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) return false;
  if (!snapshot.tombstones.every(isProfileTombstone)) return false;
  if (new Set(snapshot.tombstones.map((item) => item.id)).size !== snapshot.tombstones.length) {
    return false;
  }
  return (
    snapshot.defaultId === undefined ||
    profiles.some((profile) => profile.id === snapshot.defaultId)
  );
}

function validPendingChange(value: unknown): PendingProfileChange | undefined {
  if (!isRecord(value)) return undefined;
  const settings: Partial<Record<PortableProfileSettingKey, number>> = {};
  if (isRecord(value.settings)) {
    for (const key of PORTABLE_PROFILE_SETTING_KEYS) {
      const timestamp = value.settings[key];
      if (isSafeNonNegativeInteger(timestamp)) settings[key] = timestamp;
    }
  }
  const change: PendingProfileChange = {};
  if (value.full === true) change.full = true;
  if (Object.keys(settings).length > 0) change.settings = settings;
  if (isSafeNonNegativeInteger(value.nameUpdatedAt)) {
    change.nameUpdatedAt = value.nameUpdatedAt;
  }
  if (isSafeNonNegativeInteger(value.deletedAt)) {
    change.deletedAt = value.deletedAt;
  }
  return Object.keys(change).length > 0 ? change : undefined;
}

function validPending(value: unknown): ProfilePendingJournal {
  const journal: ProfilePendingJournal = {
    profiles: Object.create(null) as Record<string, PendingProfileChange>,
  };
  if (!isRecord(value)) return journal;
  if (isRecord(value.profiles)) {
    for (const [id, raw] of Object.entries(value.profiles).slice(0, MAX_PROFILES)) {
      if (!isProfileTombstone({ id, deletedAt: 0 })) continue;
      const change = validPendingChange(raw);
      if (change) journal.profiles[id] = change;
    }
  }
  if (value.defaultId === null || typeof value.defaultId === 'string') {
    journal.defaultId = value.defaultId;
  }
  return journal;
}

function cloneValue<T>(value: T): T {
  return structuredClone($state.snapshot(value)) as T;
}

function cloneSettings(settings: ProfileSettings): ProfileSettings {
  return cloneValue(settings);
}

function setOwn(record: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function fieldTimestamp(profile: Profile, key: string): number {
  return profile.settingUpdatedAt?.[key] ?? profile.updatedAt;
}

function nextWallTimestamp(...values: Array<number | undefined>): number {
  const current = Math.max(Date.now(), ...values.map((value) => value ?? 0));
  return current >= Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : current + 1;
}

function profileClock(profile: Profile): number {
  return Math.max(
    profile.nameUpdatedAt ?? profile.updatedAt,
    ...PORTABLE_PROFILE_SETTING_KEYS.map((key) => fieldTimestamp(profile, key)),
    ...Object.values(profile.settingUpdatedAt ?? {}),
  );
}

function nextLogicalTimestamp(...values: Array<number | undefined>): number {
  const current = Math.max(0, ...values.map((value) => value ?? 0));
  return current >= Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : current + 1;
}

function mergeProfiles(
  local: Profile,
  remote: Profile,
  pending: PendingProfileChange | undefined,
): Profile {
  const localNameTime = local.nameUpdatedAt ?? local.updatedAt;
  const remoteNameTime = remote.nameUpdatedAt ?? remote.updatedAt;
  const pendingName = pending?.nameUpdatedAt !== undefined;
  const localNameWins = pendingName || localNameTime > remoteNameTime;
  const mergedNameTime =
    pendingName && localNameTime <= remoteNameTime
      ? nextLogicalTimestamp(localNameTime, remoteNameTime)
      : localNameWins
        ? localNameTime
        : remoteNameTime;
  const base = local.updatedAt > remote.updatedAt ? local : remote;
  const other = base === local ? remote : local;
  const settings = {
    ...cloneSettings(other.settings),
    ...cloneSettings(base.settings),
  };
  const settingUpdatedAt: Record<string, number> = {};

  for (const key of PORTABLE_PROFILE_SETTING_KEYS) {
    const localTime = fieldTimestamp(local, key);
    const remoteTime = fieldTimestamp(remote, key);
    const pendingSetting = pending?.settings?.[key] !== undefined;
    const localWins = pendingSetting || localTime > remoteTime;
    const source = localWins ? local.settings : remote.settings;
    if (Object.hasOwn(source, key)) {
      Object.assign(settings, { [key]: cloneValue(source[key]) });
    } else {
      delete settings[key];
    }
    settingUpdatedAt[key] =
      pendingSetting && localTime <= remoteTime
        ? nextLogicalTimestamp(localTime, remoteTime)
        : localWins
          ? localTime
          : remoteTime;
  }

  const portableKeys = new Set<string>(PORTABLE_PROFILE_SETTING_KEYS);
  const extensionKeys = new Set([
    ...Object.keys(local.settings),
    ...Object.keys(remote.settings),
    ...Object.keys(local.settingUpdatedAt ?? {}),
    ...Object.keys(remote.settingUpdatedAt ?? {}),
  ]);
  const settingsRecord = settings as unknown as Record<string, unknown>;
  for (const key of extensionKeys) {
    if (portableKeys.has(key)) continue;
    const localTime = fieldTimestamp(local, key);
    const remoteTime = fieldTimestamp(remote, key);
    const localHasValue = Object.hasOwn(local.settings, key);
    const remoteHasValue = Object.hasOwn(remote.settings, key);
    const localHasClock = Object.hasOwn(local.settingUpdatedAt ?? {}, key);
    const remoteHasClock = Object.hasOwn(remote.settingUpdatedAt ?? {}, key);
    const localWins =
      localHasValue && !remoteHasValue && !remoteHasClock
        ? true
        : remoteHasValue && !localHasValue && !localHasClock
          ? false
          : localTime > remoteTime;
    const source = localWins ? local : remote;
    const sourceSettings = source.settings as unknown as Record<string, unknown>;
    if (Object.hasOwn(sourceSettings, key)) {
      setOwn(settingsRecord, key, cloneValue(sourceSettings[key]));
    } else {
      delete settingsRecord[key];
    }
    setOwn(settingUpdatedAt, key, fieldTimestamp(source, key));
  }

  return {
    ...base,
    id: local.id,
    name: localNameWins ? local.name : remote.name,
    settings,
    createdAt: Math.min(local.createdAt, remote.createdAt),
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
    nameUpdatedAt: mergedNameTime,
    settingUpdatedAt,
  };
}

function tombstoneMap(items: readonly ProfileTombstone[]): Map<string, ProfileTombstone> {
  return new Map(items.map((item) => [item.id, item]));
}

export class ProfileStore {
  profiles = $state<Profile[]>([]);
  activeId = $state<string | undefined>(undefined);
  syncState = $state<ProfileSyncState>('local');
  remoteUpdateAvailable = $state(false);

  #defaultId = $state<string | undefined>(undefined);
  // Which portable settings a pending remote update would change, so the prompt can name them
  // instead of asking for a blind choice.
  #remoteUpdateChanges = $state<PortableProfileSettingKey[]>([]);
  #tombstones: ProfileTombstone[] = [];
  #pending: ProfilePendingJournal = {
    profiles: Object.create(null) as Record<string, PendingProfileChange>,
  };
  #adapter: ProfileAdapter;
  #server: AsyncProfileAdapter | undefined;
  #serverRevision = 0;
  #pushPromise: Promise<void> | undefined;
  #applied:
    | {
        profileId: string;
        settings: ProfileSettings;
      }
    | undefined;
  #persistenceSuspended = false;

  constructor(adapter: ProfileAdapter = new LocalProfileAdapter()) {
    this.#adapter = adapter;
    const stored = adapter.load();
    if (!stored) return;
    this.profiles = validProfiles(stored.profiles);
    this.#tombstones = validTombstones(stored.tombstones);
    this.#pending = validPending(stored.pending);
    this.activeId = this.profiles.some((profile) => profile.id === stored.activeId)
      ? stored.activeId
      : undefined;
    this.#defaultId = this.profiles.some((profile) => profile.id === stored.defaultId)
      ? stored.defaultId
      : undefined;
    if (
      this.activeId &&
      stored.applied?.profileId === this.activeId &&
      isProfileSettings(stored.applied.settings)
    ) {
      this.#applied = {
        profileId: this.activeId,
        settings: cloneSettings(sanitizeProfileSettings(stored.applied.settings)),
      };
    } else if (this.active) {
      this.#applied = {
        profileId: this.active.id,
        settings: cloneSettings(this.active.settings),
      };
    }
    this.#dropOrphanPending();
    this.#refreshRemoteUpdateState();
    if (this.#hasPending()) this.syncState = 'waiting';
  }

  #byId = $derived(new Map(this.profiles.map((profile) => [profile.id, profile])));

  get active(): Profile | undefined {
    return this.profileById(this.activeId);
  }

  get defaultId(): string | undefined {
    return this.#defaultId;
  }

  get remoteUpdateChanges(): readonly PortableProfileSettingKey[] {
    return this.#remoteUpdateChanges;
  }

  get hasPendingChanges(): boolean {
    return this.#hasPending();
  }

  get appliedSettings(): ProfileSettings | undefined {
    const applied = this.#applied;
    return applied && applied.profileId === this.activeId
      ? cloneSettings(applied.settings)
      : undefined;
  }

  profileById(id: string | undefined): Profile | undefined {
    return id === undefined ? undefined : this.#byId.get(id);
  }

  seed(profiles: Profile[]): void {
    if (this.profiles.length > 0) return;
    this.profiles = validProfiles(profiles).map((profile) => ({
      ...profile,
      settings: cloneSettings(sanitizeProfileSettings(profile.settings)),
      settingUpdatedAt: Object.fromEntries(
        PORTABLE_PROFILE_SETTING_KEYS.map((key) => [key, profile.updatedAt]),
      ),
      nameUpdatedAt: profile.updatedAt,
    }));
    for (const profile of this.profiles) this.#markFull(profile.id);
    this.#persist();
  }

  save(name: string, settings: ProfileSettings): Profile {
    if (this.profiles.length >= MAX_PROFILES) throw new Error('Profile limit reached.');
    const safeName = cleanProfileName(name);
    if (!safeName || !isProfileSettings(settings)) throw new Error('Profile is invalid.');
    const now = nextWallTimestamp();
    const clock = 1;
    const profile: Profile = {
      id: uuidv4(),
      name: safeName,
      settings: cloneSettings(sanitizeProfileSettings(settings)),
      createdAt: now,
      updatedAt: now,
      nameUpdatedAt: clock,
      settingUpdatedAt: Object.fromEntries(
        PORTABLE_PROFILE_SETTING_KEYS.map((key) => [key, clock]),
      ),
    };
    this.profiles = [...this.profiles, profile];
    this.#markFull(profile.id);
    this.#persist();
    return profile;
  }

  update(id: string, settings: ProfileSettings): void {
    this.updateFields(id, settings, PORTABLE_PROFILE_SETTING_KEYS);
  }

  updateFields(
    id: string,
    settings: ProfileSettings,
    keys: readonly PortableProfileSettingKey[],
  ): void {
    const existing = this.profileById(id);
    if (!existing || !isProfileSettings(settings)) return;
    const changed = [...new Set(keys)].filter(
      (key) =>
        PORTABLE_PROFILE_SETTING_KEYS.includes(key) &&
        !sameJsonValue(existing.settings[key], settings[key]),
    );
    if (changed.length === 0) return;
    const now = nextWallTimestamp(existing.updatedAt);
    const clock = nextLogicalTimestamp(profileClock(existing));
    const mergedSettings = cloneSettings(existing.settings);
    const timestamps = { ...existing.settingUpdatedAt };
    const pending = this.#pending.profiles[id] ?? {};
    const pendingSettings = { ...pending.settings };
    for (const key of changed) {
      if (Object.hasOwn(settings, key)) {
        Object.assign(mergedSettings, { [key]: cloneValue(settings[key]) });
      } else {
        delete mergedSettings[key];
      }
      timestamps[key] = clock;
      pendingSettings[key] = clock;
    }
    this.profiles = this.profiles.map((profile) =>
      profile.id === id
        ? { ...profile, settings: mergedSettings, settingUpdatedAt: timestamps, updatedAt: now }
        : profile,
    );
    if (this.#applied?.profileId === id) {
      const applied = cloneSettings(this.#applied.settings);
      for (const key of changed) {
        if (Object.hasOwn(settings, key)) {
          Object.assign(applied, { [key]: cloneValue(settings[key]) });
        } else {
          delete applied[key];
        }
      }
      this.#applied = { profileId: id, settings: applied };
      this.#refreshRemoteUpdateState();
    }
    this.#pending.profiles[id] = { ...pending, settings: pendingSettings };
    this.#persist();
  }

  rename(id: string, name: string): void {
    const existing = this.profileById(id);
    const safeName = cleanProfileName(name);
    if (!existing || !safeName || existing.name === safeName) return;
    const now = nextWallTimestamp(existing.updatedAt);
    const clock = nextLogicalTimestamp(profileClock(existing));
    this.profiles = this.profiles.map((profile) =>
      profile.id === id
        ? { ...profile, name: safeName, nameUpdatedAt: clock, updatedAt: now }
        : profile,
    );
    this.#pending.profiles[id] = {
      ...this.#pending.profiles[id],
      nameUpdatedAt: clock,
    };
    this.#persist();
  }

  remove(id: string): void {
    const existing = this.profileById(id);
    if (!existing) return;
    const deletedAt = nextLogicalTimestamp(profileClock(existing));
    this.profiles = this.profiles.filter((profile) => profile.id !== id);
    this.#tombstones = [
      ...this.#tombstones.filter((tombstone) => tombstone.id !== id),
      { id, deletedAt },
    ];
    this.#pending.profiles[id] = { deletedAt };
    if (this.activeId === id) this.activeId = undefined;
    if (this.#applied?.profileId === id) this.#applied = undefined;
    if (this.#defaultId === id) {
      this.#defaultId = undefined;
      this.#pending.defaultId = null;
    }
    this.#persist();
  }

  setDefault(id: string): void {
    if (!this.#byId.has(id) || this.#defaultId === id) return;
    this.#defaultId = id;
    this.#pending.defaultId = id;
    this.#persist();
  }

  setActive(id: string | undefined): void {
    if (id !== undefined && !this.#byId.has(id)) return;
    this.activeId = id;
    const active = this.profileById(id);
    this.#applied = active
      ? { profileId: active.id, settings: cloneSettings(active.settings) }
      : undefined;
    this.#refreshRemoteUpdateState();
    this.#persist(false);
  }

  markRemoteUpdateApplied(): void {
    const active = this.active;
    if (active) {
      this.#applied = { profileId: active.id, settings: cloneSettings(active.settings) };
    }
    this.#refreshRemoteUpdateState();
    this.#persist(false);
  }

  suspendPersistence(): void {
    this.#persistenceSuspended = true;
    this.#server = undefined;
  }

  resumePersistence(): void {
    if (!this.#persistenceSuspended) return;
    this.#persistenceSuspended = false;
    this.#adapter.save(this.#snapshot());
    if (this.#hasPending()) this.syncState = 'waiting';
  }

  setLocalOnly(): void {
    if (!this.#server) this.syncState = 'local';
  }

  async syncWithServer(
    server: AsyncProfileAdapter,
    options: { discardUnsyncedProfileIds?: readonly string[] } = {},
  ): Promise<ProfileSyncResult> {
    if (this.#persistenceSuspended) return { ok: false, activeChanged: false };
    if (this.#pushPromise) await this.#pushPromise;
    if (this.#persistenceSuspended) return { ok: false, activeChanged: false };
    this.syncState = 'syncing';
    const activeBefore = this.active ? cloneValue(this.active) : undefined;
    const loaded = await server.load();
    if (this.#persistenceSuspended) return { ok: false, activeChanged: false };
    if (loaded.state !== 'ok') {
      this.#server = undefined;
      this.syncState = loaded.state === 'unavailable' ? 'waiting' : 'error';
      return { ok: false, activeChanged: false };
    }
    if (!validRemoteSnapshot(loaded.snapshot)) {
      this.#server = undefined;
      this.syncState = 'error';
      return { ok: false, activeChanged: false };
    }
    this.#server = loaded.writable === false ? undefined : server;
    this.#serverRevision = loaded.snapshot.revision;
    for (const id of options.discardUnsyncedProfileIds ?? []) {
      this.#discardUnsyncedProfile(id);
    }
    const capacityConflict = this.#mergeRemote(loaded.snapshot);
    const activeChanged =
      activeBefore !== undefined &&
      this.active !== undefined &&
      !sameJsonValue(activeBefore.settings, this.active.settings);
    this.#refreshRemoteUpdateState();
    this.#persist(false);
    if (capacityConflict) {
      // Do not push a truncated union back to the server. Keep every local profile, surface the
      // capacity conflict, and require the user to reduce the library before synchronization retries.
      this.#server = undefined;
      this.syncState = 'capacity-conflict';
      return { ok: false, activeChanged };
    }
    if (this.#hasPending()) {
      if (this.#server) this.#schedulePush();
      else this.syncState = 'waiting';
    } else {
      this.syncState = this.#server ? 'synced' : 'waiting';
    }
    return { ok: true, activeChanged };
  }

  #mergeRemote(remote: RemoteProfilesSnapshot): boolean {
    const localById = new Map(this.profiles.map((profile) => [profile.id, profile]));
    const remoteById = new Map(remote.profiles.map((profile) => [profile.id, profile]));
    const localTombstones = tombstoneMap(this.#tombstones);
    const remoteTombstones = tombstoneMap(remote.tombstones);
    const ids = new Set([
      ...localById.keys(),
      ...remoteById.keys(),
      ...localTombstones.keys(),
      ...remoteTombstones.keys(),
    ]);
    const mergedProfiles: Profile[] = [];
    const mergedTombstones: ProfileTombstone[] = [];

    for (const id of ids) {
      const local = localById.get(id);
      const incoming = remoteById.get(id);
      const localDeleted = localTombstones.get(id);
      const remoteDeleted = remoteTombstones.get(id);
      const pending = this.#pending.profiles[id];
      const latestDeleted =
        !localDeleted || (remoteDeleted?.deletedAt ?? -1) > localDeleted.deletedAt
          ? remoteDeleted
          : localDeleted;
      const latestProfileTime = Math.max(
        local ? profileClock(local) : -1,
        incoming ? profileClock(incoming) : -1,
      );

      if (latestDeleted && pending?.deletedAt !== undefined) {
        const deletedAt =
          latestDeleted.deletedAt <= latestProfileTime
            ? nextLogicalTimestamp(latestDeleted.deletedAt, latestProfileTime)
            : latestDeleted.deletedAt;
        const rebased = { id, deletedAt };
        mergedTombstones.push(rebased);
        this.#pending.profiles[id] = { deletedAt };
        continue;
      }

      if (latestDeleted && latestDeleted.deletedAt >= latestProfileTime) {
        mergedTombstones.push(latestDeleted);
        if (remoteDeleted?.deletedAt !== latestDeleted.deletedAt) {
          this.#pending.profiles[id] = { deletedAt: latestDeleted.deletedAt };
        } else {
          delete this.#pending.profiles[id];
        }
        continue;
      }

      let merged: Profile | undefined;
      if (local && incoming) merged = mergeProfiles(local, incoming, pending);
      else merged = local ?? incoming;
      if (!merged) continue;
      mergedProfiles.push(merged);
      if (!incoming) {
        this.#markFull(id);
      } else {
        this.#markRemoteDelta(incoming, merged);
      }
    }

    const capacityConflict = mergedProfiles.length > MAX_PROFILES;
    this.profiles = mergedProfiles.slice(0, MAX_PROFILES);
    this.#tombstones = mergedTombstones.slice(0, MAX_PROFILES);
    if (this.activeId && !this.profiles.some((profile) => profile.id === this.activeId)) {
      this.activeId = undefined;
      this.#applied = undefined;
    }

    if (this.#pending.defaultId !== undefined) {
      this.#defaultId =
        this.#pending.defaultId &&
        this.profiles.some((profile) => profile.id === this.#pending.defaultId)
          ? this.#pending.defaultId
          : undefined;
    } else if (
      remote.defaultId &&
      this.profiles.some((profile) => profile.id === remote.defaultId)
    ) {
      this.#defaultId = remote.defaultId;
    } else if (this.#defaultId && this.profiles.some((profile) => profile.id === this.#defaultId)) {
      this.#pending.defaultId = this.#defaultId;
    } else {
      this.#defaultId = undefined;
    }
    return capacityConflict;
  }

  #markRemoteDelta(remote: Profile, merged: Profile): void {
    const pending = this.#pending.profiles[merged.id] ?? {};
    const settings = { ...pending.settings };
    for (const key of PORTABLE_PROFILE_SETTING_KEYS) {
      if (
        !sameJsonValue(remote.settings[key], merged.settings[key]) ||
        fieldTimestamp(remote, key) !== fieldTimestamp(merged, key)
      ) {
        settings[key] = fieldTimestamp(merged, key);
      }
    }
    const next: PendingProfileChange = { ...pending };
    if (Object.keys(settings).length > 0) next.settings = settings;
    if (
      remote.name !== merged.name ||
      (remote.nameUpdatedAt ?? remote.updatedAt) !== (merged.nameUpdatedAt ?? merged.updatedAt)
    ) {
      next.nameUpdatedAt = merged.nameUpdatedAt ?? merged.updatedAt;
    }
    if (Object.keys(next).length > 0) this.#pending.profiles[merged.id] = next;
  }

  #markFull(id: string): void {
    this.#pending.profiles[id] = { full: true };
  }

  #discardUnsyncedProfile(id: string): boolean {
    if (!this.#pending.profiles[id]?.full || !this.#byId.has(id)) return false;
    this.profiles = this.profiles.filter((profile) => profile.id !== id);
    delete this.#pending.profiles[id];
    this.#tombstones = this.#tombstones.filter((tombstone) => tombstone.id !== id);
    if (this.activeId === id) this.activeId = undefined;
    if (this.#applied?.profileId === id) this.#applied = undefined;
    if (this.#defaultId === id) {
      this.#defaultId = undefined;
      if (this.#pending.defaultId === id) this.#pending.defaultId = undefined;
    }
    this.#refreshRemoteUpdateState();
    return true;
  }

  #snapshot(): ProfilesState {
    return {
      schemaVersion: 2,
      profiles: this.profiles,
      activeId: this.activeId,
      defaultId: this.#defaultId,
      applied: this.#applied,
      tombstones: this.#tombstones,
      pending: this.#pending,
    };
  }

  #persist(schedulePush = true): void {
    if (this.#persistenceSuspended) return;
    this.#adapter.save(this.#snapshot());
    if (!schedulePush) return;
    if (!this.#server) {
      if (this.#hasPending() && this.syncState !== 'error') this.syncState = 'waiting';
      return;
    }
    this.#schedulePush();
  }

  #hasPending(): boolean {
    return Object.keys(this.#pending.profiles).length > 0 || this.#pending.defaultId !== undefined;
  }

  #dropOrphanPending(): void {
    const profileIds = new Set(this.profiles.map((profile) => profile.id));
    for (const [id, change] of Object.entries(this.#pending.profiles)) {
      if (change.deletedAt === undefined && !profileIds.has(id)) {
        delete this.#pending.profiles[id];
      }
    }
    if (typeof this.#pending.defaultId === 'string' && !profileIds.has(this.#pending.defaultId)) {
      this.#pending.defaultId = undefined;
    }
  }

  #buildMutation(): {
    mutation: ProfileServerMutation;
    journal: ProfilePendingJournal;
  } | null {
    this.#dropOrphanPending();
    if (!this.#hasPending()) return null;
    const journal = cloneValue(this.#pending);
    const mutations: ProfileServerMutation['profiles'] = [];
    for (const [id, change] of Object.entries(journal.profiles)) {
      if (change.deletedAt !== undefined) {
        mutations.push({ type: 'delete', tombstone: { id, deletedAt: change.deletedAt } });
        continue;
      }
      const profile = this.profileById(id);
      if (!profile) continue;
      if (change.full) {
        mutations.push({ type: 'put', profile: cloneValue(profile) });
        continue;
      }
      if (change.settings && Object.keys(change.settings).length > 0) {
        const settings: Partial<Pick<ProfileSettings, PortableProfileSettingKey>> = {};
        for (const key of PORTABLE_PROFILE_SETTING_KEYS) {
          if (change.settings[key] === undefined) continue;
          Object.assign(settings, { [key]: cloneValue(profile.settings[key]) });
        }
        mutations.push({
          type: 'patch',
          id,
          settings,
          settingUpdatedAt: { ...profile.settingUpdatedAt },
          updatedAt: profile.updatedAt,
        });
      }
      if (change.nameUpdatedAt !== undefined) {
        mutations.push({
          type: 'rename',
          id,
          name: profile.name,
          nameUpdatedAt: profile.nameUpdatedAt ?? profile.updatedAt,
          updatedAt: profile.updatedAt,
        });
      }
    }
    return {
      mutation: {
        profiles: mutations,
        ...(journal.defaultId !== undefined ? { defaultId: journal.defaultId } : {}),
      },
      journal,
    };
  }

  #ackMutation(sent: ProfilePendingJournal, mutation: ProfileServerMutation): void {
    for (const [id, change] of Object.entries(sent.profiles)) {
      const current = this.#pending.profiles[id];
      if (!current) continue;
      const sentOps = mutation.profiles.filter((operation) =>
        operation.type === 'delete'
          ? operation.tombstone.id === id
          : operation.type === 'put'
            ? operation.profile.id === id
            : operation.id === id,
      );
      const put = sentOps.find((operation) => operation.type === 'put');
      if (put?.type === 'put') {
        if (current.full && sameJsonValue(this.profileById(id), put.profile)) {
          delete this.#pending.profiles[id];
        }
        continue;
      }
      if (change.deletedAt !== undefined) {
        if (current.deletedAt === change.deletedAt) delete this.#pending.profiles[id];
        continue;
      }
      const next: PendingProfileChange = { ...current };
      if (change.settings && next.settings) {
        const remaining = { ...next.settings };
        for (const [key, timestamp] of Object.entries(change.settings)) {
          if (remaining[key as PortableProfileSettingKey] === timestamp) {
            delete remaining[key as PortableProfileSettingKey];
          }
        }
        next.settings = Object.keys(remaining).length > 0 ? remaining : undefined;
      }
      if (change.nameUpdatedAt !== undefined && next.nameUpdatedAt === change.nameUpdatedAt) {
        next.nameUpdatedAt = undefined;
      }
      if (
        !next.full &&
        next.settings === undefined &&
        next.nameUpdatedAt === undefined &&
        next.deletedAt === undefined
      ) {
        delete this.#pending.profiles[id];
      } else {
        this.#pending.profiles[id] = next;
      }
    }
    if (sent.defaultId !== undefined && this.#pending.defaultId === sent.defaultId) {
      this.#pending.defaultId = undefined;
    }
  }

  #schedulePush(): void {
    if (this.#persistenceSuspended || this.#pushPromise || !this.#server) return;
    this.#pushPromise = this.#runPush().finally(() => {
      this.#pushPromise = undefined;
    });
  }

  async #runPush(): Promise<void> {
    if (this.#persistenceSuspended || !this.#server) return;
    let retries = 0;
    while (this.#server && this.#hasPending()) {
      const built = this.#buildMutation();
      if (!built) break;
      // A rebased retry is still ordinary syncing. Only an exhausted retry budget below is a
      // conflict the navigator has to act on.
      this.syncState = 'syncing';
      const result = await this.#server.mutate(this.#serverRevision, built.mutation);
      if (this.#persistenceSuspended) return;
      if (result === 'ok') {
        this.#serverRevision += 1;
        this.#ackMutation(built.journal, built.mutation);
        this.#adapter.save(this.#snapshot());
        retries = 0;
        continue;
      }
      if (result === 'unavailable') {
        this.#server = undefined;
        this.syncState = 'waiting';
        break;
      }
      retries += 1;
      if (retries > MAX_SYNC_RETRIES) {
        this.syncState = 'conflict';
        break;
      }
      const refreshed = await this.#server.load();
      if (this.#persistenceSuspended) return;
      if (refreshed.state !== 'ok') {
        this.#server = undefined;
        this.syncState = refreshed.state === 'unavailable' ? 'waiting' : 'error';
        break;
      }
      this.#serverRevision = refreshed.snapshot.revision;
      if (this.#mergeRemote(refreshed.snapshot)) {
        this.#server = undefined;
        this.syncState = 'capacity-conflict';
        this.#adapter.save(this.#snapshot());
        break;
      }
      this.#adapter.save(this.#snapshot());
    }
    if (this.#server && !this.#hasPending()) this.syncState = 'synced';
  }

  #refreshRemoteUpdateState(): void {
    const active = this.active;
    const applied = this.#applied;
    if (active === undefined || applied === undefined || applied.profileId !== active.id) {
      this.remoteUpdateAvailable = false;
      this.#remoteUpdateChanges = [];
      return;
    }
    const appliedSettings = applied.settings;
    const activeSettings = active.settings;
    this.remoteUpdateAvailable = !sameJsonValue(appliedSettings, activeSettings);
    this.#remoteUpdateChanges = PORTABLE_PROFILE_SETTING_KEYS.filter(
      (key) => !sameJsonValue(appliedSettings[key], activeSettings[key]),
    );
  }
}
