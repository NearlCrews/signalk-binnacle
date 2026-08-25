import { binnacleStorageKeysForScope } from '$shared/persistence';

export type PrivacyDataClass = 'credentials' | 'device-data';
export type PrivacyOperation = 'forget-credentials' | 'erase-device-data' | 'erase-all-local-data';
type PrivacyReportStatus = 'completed' | 'partial' | 'blocked';

export interface PrivacyStorageOwner {
  id: string;
  dataClass: PrivacyDataClass;
  // Lower-priority owners clear first. Producers such as service workers stop before their backing
  // caches, preventing a late response from repopulating storage after deletion.
  clearPriority?: number;
  clear(): void | Promise<void>;
}

interface PrivacyFailure {
  ownerId: string;
  message: string;
}

export interface PrivacyReport {
  operation: PrivacyOperation;
  status: PrivacyReportStatus;
  clearedOwnerIds: string[];
  failures: PrivacyFailure[];
  reason?: string;
}

export interface PrivacyBroadcastEvent {
  type: 'credentials-forgotten' | 'device-data-erased' | 'local-data-erased';
  status: 'completed' | 'partial';
  clearedOwnerIds: string[];
  failedOwnerIds: string[];
  sourceId?: string;
}

export interface PrivacyBroadcaster {
  broadcast(event: PrivacyBroadcastEvent): void | Promise<void>;
}

export const BINNACLE_PRIVACY_CHANNEL = 'binnacle:privacy';

export interface EraseSafetyDecision {
  allowed: boolean;
  reason?: string;
  /** Releases an inter-tab erase lease after registered owners finish. */
  release?: () => void;
}

export type EraseSafetyGuard = () => EraseSafetyDecision | Promise<EraseSafetyDecision>;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Unknown failure.';
}

// Owners must register explicitly. This prevents a privacy action from widening into origin-wide
// deletion on a Signal K server that hosts several webapps under the same origin.
export class PrivacyStorageRegistry {
  readonly #owners = new Map<string, PrivacyStorageOwner>();

  register(owner: PrivacyStorageOwner): void {
    if (!owner.id) throw new TypeError('A privacy storage owner requires an id.');
    if (this.#owners.has(owner.id)) {
      throw new TypeError(`Privacy storage owner "${owner.id}" is already registered.`);
    }
    this.#owners.set(owner.id, owner);
  }

  owners(dataClass: PrivacyDataClass): readonly PrivacyStorageOwner[] {
    return [...this.#owners.values()].filter((owner) => owner.dataClass === dataClass);
  }
}

export interface DevicePrivacyControllerOptions {
  registry: PrivacyStorageRegistry;
  canErase: EraseSafetyGuard;
  broadcaster?: PrivacyBroadcaster;
}

export class DevicePrivacyController {
  readonly #registry: PrivacyStorageRegistry;
  readonly #canErase: EraseSafetyGuard;
  readonly #broadcaster: PrivacyBroadcaster | undefined;

  constructor(options: DevicePrivacyControllerOptions) {
    this.#registry = options.registry;
    this.#canErase = options.canErase;
    this.#broadcaster = options.broadcaster;
  }

  // Credentials are their own operation. Erasing device data does not silently revoke or forget a
  // Signal K token, and forgetting a token does not remove offline charts or user preferences.
  forgetCredentials(): Promise<PrivacyReport> {
    return this.#clear('forget-credentials', 'credentials', 'credentials-forgotten');
  }

  async eraseDeviceData(): Promise<PrivacyReport> {
    return this.#eraseAfterSafetyCheck('erase-device-data', ['device-data'], 'device-data-erased');
  }

  async eraseAllLocalData(): Promise<PrivacyReport> {
    return this.#eraseAfterSafetyCheck(
      'erase-all-local-data',
      ['device-data', 'credentials'],
      'local-data-erased',
    );
  }

  async #eraseAfterSafetyCheck(
    operation: Extract<PrivacyOperation, 'erase-device-data' | 'erase-all-local-data'>,
    dataClasses: readonly PrivacyDataClass[],
    eventType: PrivacyBroadcastEvent['type'],
  ): Promise<PrivacyReport> {
    let decision: EraseSafetyDecision;
    try {
      decision = await this.#canErase();
    } catch {
      return {
        operation,
        status: 'blocked',
        clearedOwnerIds: [],
        failures: [],
        reason: 'The erase safety check failed.',
      };
    }
    if (!decision.allowed) {
      return {
        operation,
        status: 'blocked',
        clearedOwnerIds: [],
        failures: [],
        reason: decision.reason ?? 'The device is not in a safe state for erasure.',
      };
    }
    try {
      return await this.#clear(operation, dataClasses, eventType);
    } finally {
      decision.release?.();
    }
  }

  async #clear(
    operation: PrivacyOperation,
    dataClass: PrivacyDataClass | readonly PrivacyDataClass[],
    eventType: PrivacyBroadcastEvent['type'],
  ): Promise<PrivacyReport> {
    const dataClasses = new Set(Array.isArray(dataClass) ? dataClass : [dataClass]);
    const owners = [...dataClasses]
      .flatMap((value) => this.#registry.owners(value))
      .sort((left, right) => (left.clearPriority ?? 0) - (right.clearPriority ?? 0));
    const clearedOwnerIds: string[] = [];
    const failures: PrivacyFailure[] = [];
    for (const owner of owners) {
      try {
        await owner.clear();
        clearedOwnerIds.push(owner.id);
      } catch (error) {
        failures.push({ ownerId: owner.id, message: errorMessage(error) });
      }
    }

    const event: PrivacyBroadcastEvent = {
      type: eventType,
      status: failures.length === 0 ? 'completed' : 'partial',
      clearedOwnerIds: [...clearedOwnerIds],
      failedOwnerIds: failures.map((failure) => failure.ownerId),
    };
    try {
      await this.#broadcaster?.broadcast(event);
    } catch (error) {
      failures.push({ ownerId: 'cross-tab-broadcast', message: errorMessage(error) });
    }

    return {
      operation,
      status: failures.length === 0 ? 'completed' : 'partial',
      clearedOwnerIds,
      failures,
    };
  }
}

const PRIVACY_ACTIVITY_LOCK = 'binnacle:privacy-activity';

type PrivacyLockManager = Pick<LockManager, 'request'>;

/**
 * Holds a shared browser lock while this tab has unsaved or safety-critical state. An erase first
 * obtains the exclusive counterpart, so another Binnacle tab cannot clear shared storage while that
 * state is active. Browsers without Web Locks retain the local safety check.
 */
export class PrivacyActivityCoordinator {
  readonly #locks: PrivacyLockManager | undefined;
  #generation = 0;
  #releaseShared: (() => void) | undefined;
  #unsafe = false;

  constructor(locks?: PrivacyLockManager) {
    this.#locks = locks;
  }

  setUnsafe(unsafe: boolean): void {
    if (unsafe === this.#unsafe) return;
    this.#unsafe = unsafe;
    this.#generation += 1;
    const generation = this.#generation;
    this.#releaseShared?.();
    this.#releaseShared = undefined;
    if (!unsafe || !this.#locks) return;

    void this.#locks
      .request(PRIVACY_ACTIVITY_LOCK, { mode: 'shared' }, async () => {
        if (generation !== this.#generation) return;
        await new Promise<void>((resolve) => {
          this.#releaseShared = resolve;
        });
        if (generation === this.#generation) this.#releaseShared = undefined;
      })
      .catch(() => undefined);
  }

  async guard(localGuard: EraseSafetyGuard): Promise<EraseSafetyDecision> {
    const local = await localGuard();
    if (!local.allowed || !this.#locks) return local;
    // Release this tab's shared activity lock before trying the exclusive lease. The safety state may
    // have become clear in the same user gesture before Svelte's effect propagated the change.
    this.setUnsafe(false);
    await Promise.resolve();

    return new Promise<EraseSafetyDecision>((resolve) => {
      void this.#locks
        ?.request(PRIVACY_ACTIVITY_LOCK, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
          if (!lock) {
            resolve({
              allowed: false,
              reason: 'Finish or save active work in another Binnacle tab first.',
            });
            return;
          }
          const rechecked = await localGuard();
          if (!rechecked.allowed) {
            resolve(rechecked);
            return;
          }
          let release = (): void => undefined;
          const held = new Promise<void>((releaseLock) => {
            release = releaseLock;
          });
          resolve({ ...rechecked, release });
          await held;
        })
        .catch(() => resolve(local));
    });
  }

  dispose(): void {
    this.#unsafe = false;
    this.#generation += 1;
    this.#releaseShared?.();
    this.#releaseShared = undefined;
  }
}

type LocalStorageLike = Pick<Storage, 'getItem' | 'key' | 'length' | 'removeItem'>;

interface LocalStorageOwnerOptions {
  id: string;
  dataClass: PrivacyDataClass;
  storage: LocalStorageLike;
  keys?: readonly string[];
  prefixes?: readonly string[];
  excludeKeys?: readonly string[];
}

function createLocalStorageOwner(options: LocalStorageOwnerOptions): PrivacyStorageOwner {
  const exact = new Set(options.keys ?? []);
  const prefixes = [...(options.prefixes ?? [])];
  const excluded = new Set(options.excludeKeys ?? []);
  return {
    id: options.id,
    dataClass: options.dataClass,
    clear() {
      const owned = new Set(exact);
      for (let index = 0; index < options.storage.length; index += 1) {
        const key = options.storage.key(index);
        if (key && prefixes.some((prefix) => key.startsWith(prefix))) owned.add(key);
      }
      for (const key of owned) if (!excluded.has(key)) options.storage.removeItem(key);
    },
  };
}

export function createIndexedDbOwner(
  id: string,
  factory: Pick<IDBFactory, 'deleteDatabase'>,
  names: readonly string[],
): PrivacyStorageOwner {
  return {
    id,
    dataClass: 'device-data',
    clear: () =>
      Promise.all(
        names.map(
          (name) =>
            new Promise<void>((resolve, reject) => {
              const request = factory.deleteDatabase(name);
              request.onsuccess = () => resolve();
              request.onerror = () =>
                reject(request.error ?? new Error(`Could not delete ${name}.`));
              request.onblocked = () => reject(new Error(`Deletion of ${name} was blocked.`));
            }),
        ),
      ).then(() => undefined),
  };
}

function createCacheStorageOwner(
  id: string,
  storage: Pick<CacheStorage, 'delete' | 'keys'>,
  names: readonly string[],
  prefixes: readonly string[] = [],
): PrivacyStorageOwner {
  return {
    id,
    dataClass: 'device-data',
    clearPriority: 100,
    async clear() {
      const existing = await storage.keys();
      const owned = existing.filter(
        (name) => names.includes(name) || prefixes.some((prefix) => name.startsWith(prefix)),
      );
      const results = await Promise.all(owned.map((name) => storage.delete(name)));
      const failed = owned.filter((_, index) => !results[index]);
      if (failed.length > 0) {
        throw new Error(
          `Could not delete browser cache${failed.length === 1 ? '' : 's'}: ${failed.join(', ')}.`,
        );
      }
    },
  };
}

export function createServiceWorkerOwner(
  id: string,
  container: Pick<ServiceWorkerContainer, 'getRegistrations'>,
  ownedScopes: readonly string[],
): PrivacyStorageOwner {
  const scopes = new Set(ownedScopes);
  return {
    id,
    dataClass: 'device-data',
    clearPriority: -100,
    async clear() {
      const registrations = await container.getRegistrations();
      const owned = registrations.filter((registration) => scopes.has(registration.scope));
      const results = await Promise.all(owned.map((registration) => registration.unregister()));
      if (results.some((removed) => !removed)) {
        throw new Error('A Binnacle service worker could not be unregistered.');
      }
    },
  };
}

export function createBroadcastChannelBroadcaster(
  channelName = BINNACLE_PRIVACY_CHANNEL,
  sourceId?: string,
): PrivacyBroadcaster {
  return {
    broadcast(event) {
      const channel = new BroadcastChannel(channelName);
      try {
        channel.postMessage(sourceId ? { ...event, sourceId } : event);
      } finally {
        channel.close();
      }
    },
  };
}

const BINNACLE_CREDENTIAL_KEYS = binnacleStorageKeysForScope('credential');
const BINNACLE_LOCAL_DATA_KEYS = binnacleStorageKeysForScope(
  'profile',
  'device',
  'server-resource',
  'safety',
  'cache',
  'draft',
);

const BINNACLE_INDEXED_DB_NAMES = [
  'binnacle',
  'binnacle-pmtiles-blocks',
  'binnacle-notes',
  'binnacle-tides-data',
  'binnacle-weather',
  'binnacle-weather-point',
] as const;

// Every runtime cache the service worker declares, mirrored here as a deliberately explicit
// inventory: an erase never enumerates caches dynamically, it deletes exactly what is named. The
// seam is pinned from the sw-caching side: its test asserts every declared cacheName appears in
// this list, so a new route cannot silently escape the privacy erase.
export const BINNACLE_CACHE_NAMES = [
  'binnacle-basemap-style',
  'binnacle-basemap',
  'binnacle-chart-tiles',
  'binnacle-volatile-overlays',
  'binnacle-overlay-tiles',
  'binnacle-tides',
  'binnacle-radar-index',
  'binnacle-radar-tiles',
  'binnacle-pmtiles',
] as const;

export interface BinnaclePrivacyRegistryOptions {
  localStorage?: LocalStorageLike;
  indexedDB?: Pick<IDBFactory, 'deleteDatabase'>;
  cacheStorage?: Pick<CacheStorage, 'delete' | 'keys'>;
  serviceWorker?: Pick<ServiceWorkerContainer, 'getRegistrations'>;
  // Deployment scope varies with the Signal K base path, so callers must provide exact scopes.
  serviceWorkerScopes?: readonly string[];
  additionalCacheNames?: readonly string[];
  cachePrefixes?: readonly string[];
}

// The production inventory is intentionally explicit. No owner calls localStorage.clear(), lists all
// origin databases or caches, or unregisters a service worker outside an exact Binnacle scope.
export function createBinnaclePrivacyRegistry(
  options: BinnaclePrivacyRegistryOptions,
): PrivacyStorageRegistry {
  const registry = new PrivacyStorageRegistry();
  if (options.localStorage) {
    registry.register(
      createLocalStorageOwner({
        id: 'signalk-credentials',
        dataClass: 'credentials',
        storage: options.localStorage,
        keys: BINNACLE_CREDENTIAL_KEYS,
      }),
    );
    registry.register(
      createLocalStorageOwner({
        id: 'local-settings',
        dataClass: 'device-data',
        storage: options.localStorage,
        keys: BINNACLE_LOCAL_DATA_KEYS,
      }),
    );
  }
  if (options.indexedDB) {
    registry.register(
      createIndexedDbOwner('indexed-db', options.indexedDB, BINNACLE_INDEXED_DB_NAMES),
    );
  }
  if (options.cacheStorage) {
    registry.register(
      createCacheStorageOwner(
        'cache-storage',
        options.cacheStorage,
        [...BINNACLE_CACHE_NAMES, ...(options.additionalCacheNames ?? [])],
        options.cachePrefixes,
      ),
    );
  }
  if (options.serviceWorker && options.serviceWorkerScopes?.length) {
    registry.register(
      createServiceWorkerOwner(
        'service-worker',
        options.serviceWorker,
        options.serviceWorkerScopes,
      ),
    );
  }
  return registry;
}
