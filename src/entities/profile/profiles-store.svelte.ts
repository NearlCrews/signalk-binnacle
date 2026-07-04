import { isRecord, uuidv4 } from '$shared/lib';
import type { Profile, ProfileSettings, ProfilesState } from './profile-types';

const STORAGE_KEY = 'binnacle:profiles';

// The local persistence seam: production reads and writes localStorage, tests inject an in-memory fake.
export interface ProfileAdapter {
  load(): ProfilesState | undefined;
  save(state: ProfilesState): void;
}

// The optional server persistence seam (v2): the SignalK applicationData adapter persists per-user
// across devices. Both calls degrade gracefully (load resolves undefined, save resolves false) when the
// server is unsecured, unauthenticated, or unreachable, so the store falls back to the local cache.
export interface AsyncProfileAdapter {
  load(): Promise<ProfilesState | undefined>;
  save(state: ProfilesState): Promise<boolean>;
}

// Reads and writes the whole profiles state to localStorage as one JSON document. Guarded for SSR
// (no localStorage) and for a throwing or quota-full store, returning undefined on any read failure
// so a corrupt or absent value falls back to empty rather than breaking startup.
class LocalProfileAdapter implements ProfileAdapter {
  load(): ProfilesState | undefined {
    if (typeof localStorage === 'undefined') return undefined;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw == null) return undefined;
      return JSON.parse(raw) as ProfilesState;
    } catch {
      return undefined;
    }
  }

  save(state: ProfilesState): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // A failed persist (quota exceeded, private mode) must not break the in-memory update.
    }
  }
}

// A light shape guard for a stored profile: enough to drop a grossly malformed or drifted entry at
// load rather than trust it. The deep settings validation lives in the features layer (isProfileSettings)
// and runs on import; entities cannot reach up to it, so a load-time guard stays minimal here.
function isStoredProfile(value: unknown): value is Profile {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' && typeof value.name === 'string' && isRecord(value.settings);
}

// The reactive home for saved profiles. Each mutation updates the runes and persists the whole
// state through the adapter, so the on-disk document always matches what the UI shows.
export class ProfileStore {
  profiles = $state<Profile[]>([]);
  activeId = $state<string | undefined>(undefined);
  // True when the active profile's live settings have drifted from what was saved, so the UI can
  // offer to update it. Cleared on every profile switch and on an explicit save or update.
  isDirty = $state(false);

  #defaultId = $state<string | undefined>(undefined);
  #adapter: ProfileAdapter;
  // The optional server adapter and a single-flight push state, so concurrent saves never collide on a
  // server that has no write-conflict detection: the latest state is always the one that lands.
  #server: AsyncProfileAdapter | undefined;
  #pushPending = false;
  #pushing = false;

  // True when the constructor found a stored document, even an empty one. Distinguishes a fresh
  // device (seed the starter profiles) from a store the user deliberately emptied (do not
  // resurrect the starters on the next launch).
  readonly loadedFromStorage: boolean = false;

  constructor(adapter: ProfileAdapter = new LocalProfileAdapter()) {
    this.#adapter = adapter;
    const stored = adapter.load();
    if (stored) {
      this.loadedFromStorage = true;
      // Array.isArray, not a nullish fallback: a corrupt document where profiles is a truthy
      // non-array would otherwise throw here during App init and blank the app.
      this.profiles = Array.isArray(stored.profiles) ? stored.profiles.filter(isStoredProfile) : [];
      this.activeId = stored.activeId;
      this.#defaultId = stored.defaultId;
    }
  }

  // Id lookups go through a derived index rather than a per-call array scan, so profileById stays
  // O(1) however many profiles a long-lived account accumulates. The index rebuilds only when the
  // profiles array changes.
  #byId = $derived(new Map(this.profiles.map((p) => [p.id, p])));

  get active(): Profile | undefined {
    return this.profileById(this.activeId);
  }

  profileById(id: string | undefined): Profile | undefined {
    return id === undefined ? undefined : this.#byId.get(id);
  }

  get defaultId(): string | undefined {
    return this.#defaultId;
  }

  // Seed starter profiles only when the store is empty, so a fresh device or browser is not blank.
  // Seeds carry stable ids so the same starters from two devices merge to one, not duplicate.
  seed(profiles: Profile[]): void {
    if (this.profiles.length > 0) return;
    this.profiles = profiles;
    this.#persist();
  }

  // Attach the SignalK applicationData adapter and reconcile with the server: merge the remote profiles
  // in by id (the later updatedAt wins), then push the reconciled state back so the server converges
  // (and an empty server is seeded from this device). Idempotent for the success case: once a server is
  // attached this is a no-op, so a second call (a component remount, a re-auth) does not re-merge, while
  // a prior failure leaves no server attached so a later call can still retry.
  // Resolves true when profiles are synced to the server (already attached, or attached on this
  // call), false when it stayed local because the server was unavailable, so the caller can retry
  // on a later auth or reconnect rather than latching after one transient failure.
  async syncWithServer(server: AsyncProfileAdapter): Promise<boolean> {
    if (this.#server) return true;
    let remote: ProfilesState | undefined;
    try {
      remote = await server.load();
    } catch {
      remote = undefined;
    }
    // undefined means the server is unavailable (unsecured, the token lacks access, or unreachable):
    // stay local and do not attach the adapter, so no further writes are attempted and the console is
    // not flooded with failures. A reachable server (even an empty one) attaches and pushes once.
    if (remote === undefined) return false;
    this.#server = server;
    this.#mergeRemote(remote);
    this.#schedulePush();
    return true;
  }

  #mergeRemote(remote: ProfilesState): void {
    const byId = new Map<string, Profile>();
    for (const p of this.profiles) byId.set(p.id, p);
    // The same shape guards the local load applies: a remote document is just another stored
    // document, so a malformed entry (or a non-array profiles field) must not enter the store.
    const incoming = Array.isArray(remote.profiles) ? remote.profiles.filter(isStoredProfile) : [];
    for (const p of incoming) {
      const existing = byId.get(p.id);
      if (!existing || (p.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) byId.set(p.id, p);
    }
    this.profiles = [...byId.values()];
    // Merge only the profile list and the default. The active selection is per-device state:
    // adopting the remote activeId would show a profile as Active while this device still runs
    // its previous settings, with no dirty flag to say so.
    this.#defaultId = remote.defaultId ?? this.#defaultId;
    // Cache the merged state locally without re-scheduling a push; syncWithServer pushes once.
    this.#adapter.save(this.#snapshot());
  }

  save(name: string, settings: ProfileSettings): Profile {
    const now = Date.now();
    const profile: Profile = { id: uuidv4(), name, settings, createdAt: now, updatedAt: now };
    this.profiles = [...this.profiles, profile];
    this.#persist();
    return profile;
  }

  update(id: string, settings: ProfileSettings): void {
    const now = Date.now();
    this.profiles = this.profiles.map((p) =>
      p.id === id ? { ...p, settings, updatedAt: now } : p,
    );
    this.#persist();
  }

  rename(id: string, name: string): void {
    this.profiles = this.profiles.map((p) =>
      p.id === id ? { ...p, name, updatedAt: Date.now() } : p,
    );
    this.#persist();
  }

  remove(id: string): void {
    this.profiles = this.profiles.filter((p) => p.id !== id);
    if (this.activeId === id) this.activeId = undefined;
    if (this.#defaultId === id) this.#defaultId = undefined;
    this.#persist();
  }

  setDefault(id: string): void {
    this.#defaultId = id;
    this.#persist();
  }

  // Mark which profile is active and clear the dirty flag. This does NOT apply the profile's settings:
  // the settings live in App's stores, so the caller applies them and then marks the result active.
  setActive(id: string | undefined): void {
    this.activeId = id;
    this.isDirty = false;
    this.#persist();
  }

  markDirty(): void {
    // Only a live profile can be edited, and only flip the flag once: a no-op write is wasted reactivity.
    if (this.activeId !== undefined && !this.isDirty) this.isDirty = true;
  }

  clearDirty(): void {
    this.isDirty = false;
  }

  #snapshot(): ProfilesState {
    return { profiles: this.profiles, activeId: this.activeId, defaultId: this.#defaultId };
  }

  #persist(): void {
    this.#adapter.save(this.#snapshot());
    this.#schedulePush();
  }

  // Single-flight server push: mark a write pending and start the runner if idle; the runner loops
  // until no write is pending, always sending the latest snapshot, so rapid edits collapse to one
  // in-flight request followed by one more with the final state.
  #schedulePush(): void {
    if (!this.#server) return;
    this.#pushPending = true;
    if (this.#pushing) return;
    void this.#runPush();
  }

  async #runPush(): Promise<void> {
    if (!this.#server) return;
    this.#pushing = true;
    while (this.#pushPending) {
      this.#pushPending = false;
      let ok = false;
      try {
        ok = await this.#server.save(this.#snapshot());
      } catch {
        ok = false;
      }
      if (!ok) {
        // A rejected write (a read-only token, or the server refusing writes) will not start
        // succeeding under this token, so detach and let the local cache stay authoritative
        // rather than firing a doomed request on every later edit. The next auth change (a
        // read-write upgrade, a reconnect, or a new session) re-attaches and retries.
        this.#server = undefined;
        break;
      }
    }
    this.#pushing = false;
  }
}
