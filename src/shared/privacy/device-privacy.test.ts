import { describe, expect, it, vi } from 'vitest';
import {
  createBinnaclePrivacyRegistry,
  createIndexedDbOwner,
  createServiceWorkerOwner,
  DevicePrivacyController,
  PrivacyStorageRegistry,
} from './device-privacy';

function fakeLocalStorage(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    storage: {
      get length() {
        return values.size;
      },
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
    },
  };
}

describe('DevicePrivacyController', () => {
  it('keeps credential forgetting separate from device-data erasure', async () => {
    const local = fakeLocalStorage({
      'binnacle:signalk-auth': 'token',
      'binnacle:theme': 'night',
      'another-app:token': 'keep',
    });
    const broadcast = vi.fn();
    const controller = new DevicePrivacyController({
      registry: createBinnaclePrivacyRegistry({ localStorage: local.storage }),
      canErase: () => ({ allowed: true }),
      broadcaster: { broadcast },
    });

    const report = await controller.forgetCredentials();

    expect(report.status).toBe('completed');
    expect(local.values.has('binnacle:signalk-auth')).toBe(false);
    expect(local.values.get('binnacle:theme')).toBe('night');
    expect(local.values.get('another-app:token')).toBe('keep');
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'credentials-forgotten', status: 'completed' }),
    );
  });

  it('erases only Binnacle-owned device data and preserves credentials', async () => {
    const local = fakeLocalStorage({
      'binnacle:signalk-auth': 'token',
      'binnacle:theme': 'night',
      'binnacle:map-view': '{}',
      'another-app:theme': 'keep',
    });
    const controller = new DevicePrivacyController({
      registry: createBinnaclePrivacyRegistry({ localStorage: local.storage }),
      canErase: () => ({ allowed: true }),
    });

    const report = await controller.eraseDeviceData();

    expect(report.status).toBe('completed');
    expect(local.values.get('binnacle:signalk-auth')).toBe('token');
    expect(local.values.has('binnacle:theme')).toBe(false);
    expect(local.values.has('binnacle:map-view')).toBe(false);
    expect(local.values.get('another-app:theme')).toBe('keep');
  });

  it('erases device data and credentials through the explicit full-wipe action', async () => {
    const local = fakeLocalStorage({
      'binnacle:signalk-auth': 'token',
      'binnacle:theme': 'night',
      'another-app:token': 'keep',
    });
    const controller = new DevicePrivacyController({
      registry: createBinnaclePrivacyRegistry({ localStorage: local.storage }),
      canErase: () => ({ allowed: true }),
    });

    const report = await controller.eraseAllLocalData();

    expect(report.status).toBe('completed');
    expect(local.values.has('binnacle:signalk-auth')).toBe(false);
    expect(local.values.has('binnacle:theme')).toBe(false);
    expect(local.values.get('another-app:token')).toBe('keep');
  });

  it('blocks erasure before any owner runs when the injected safety guard refuses', async () => {
    const clear = vi.fn();
    const registry = new PrivacyStorageRegistry();
    registry.register({ id: 'data', dataClass: 'device-data', clear });
    const controller = new DevicePrivacyController({
      registry,
      canErase: () => ({ allowed: false, reason: 'Navigation is active.' }),
    });

    expect(await controller.eraseDeviceData()).toEqual({
      operation: 'erase-device-data',
      status: 'blocked',
      clearedOwnerIds: [],
      failures: [],
      reason: 'Navigation is active.',
    });
    expect(clear).not.toHaveBeenCalled();
  });

  it('reports partial failures while continuing independent owners', async () => {
    const registry = new PrivacyStorageRegistry();
    registry.register({ id: 'ok', dataClass: 'device-data', clear: vi.fn() });
    registry.register({
      id: 'blocked-db',
      dataClass: 'device-data',
      clear: () => {
        throw new Error('Database is open in another tab.');
      },
    });
    const controller = new DevicePrivacyController({
      registry,
      canErase: () => ({ allowed: true }),
    });

    expect(await controller.eraseDeviceData()).toEqual({
      operation: 'erase-device-data',
      status: 'partial',
      clearedOwnerIds: ['ok'],
      failures: [{ ownerId: 'blocked-db', message: 'Database is open in another tab.' }],
    });
  });

  it('rejects duplicate storage-owner ids', () => {
    const registry = new PrivacyStorageRegistry();
    registry.register({ id: 'same', dataClass: 'device-data', clear: vi.fn() });
    expect(() =>
      registry.register({ id: 'same', dataClass: 'credentials', clear: vi.fn() }),
    ).toThrow('already registered');
  });
});

describe('browser privacy owners', () => {
  it('reports an IndexedDB deletion that is blocked by another tab', async () => {
    const request = {} as IDBOpenDBRequest;
    const owner = createIndexedDbOwner('db', { deleteDatabase: () => request }, ['binnacle']);
    const clearing = owner.clear();
    request.onblocked?.(new Event('blocked') as IDBVersionChangeEvent);
    await expect(clearing).rejects.toThrow('blocked');
  });

  it('unregisters only service workers with an exact owned scope', async () => {
    const owned = { scope: 'https://pi/binnacle/', unregister: vi.fn().mockResolvedValue(true) };
    const foreign = { scope: 'https://pi/admin/', unregister: vi.fn().mockResolvedValue(true) };
    const owner = createServiceWorkerOwner(
      'workers',
      {
        getRegistrations: vi.fn().mockResolvedValue([owned, foreign]),
      } as unknown as Pick<ServiceWorkerContainer, 'getRegistrations'>,
      ['https://pi/binnacle/'],
    );

    await owner.clear();

    expect(owned.unregister).toHaveBeenCalledOnce();
    expect(foreign.unregister).not.toHaveBeenCalled();
  });

  it('deletes exact runtime caches and only the owned Workbox precache prefix', async () => {
    const deleted: string[] = [];
    const storage = {
      keys: async () => [
        'binnacle-chart-tiles',
        'workbox-precache-v2-http://pi/signalk-binnacle/',
        'workbox-precache-v2-http://pi/other-app/',
      ],
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    };
    const registry = createBinnaclePrivacyRegistry({
      cacheStorage: storage,
      cachePrefixes: ['workbox-precache-v2-http://pi/signalk-binnacle/'],
    });

    await registry.owners('device-data')[0].clear();

    expect(deleted).toEqual([
      'binnacle-chart-tiles',
      'workbox-precache-v2-http://pi/signalk-binnacle/',
    ]);
  });
});
