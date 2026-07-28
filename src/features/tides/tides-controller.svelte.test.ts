import { describe, expect, it, vi } from 'vitest';
import { TidesStore } from '$entities/tides';
import { createTidesController } from './tides-controller.svelte';
import type { TidesLoader } from './tides-loader';

const tideStation = { id: 'T1', name: 'Tide', latitude: 27.7, longitude: -82.7 };
const currentStation = { id: 'C1', name: 'Current', latitude: 27.8, longitude: -82.8 };

describe('createTidesController', () => {
  it('changes tide and current selections independently and resets both to automatic', async () => {
    const store = new TidesStore();
    const load = vi.fn(
      async (_store: TidesStore, _lat: number, _lon: number, _force?: boolean) => undefined,
    );
    const loader = { load } as unknown as TidesLoader;
    const controller = createTidesController(store, loader, () => ({ lat: 27.7, lon: -82.7 }));

    await controller.selectStation('tide', tideStation);
    expect(store.requestedTide).toMatchObject({ mode: 'manual', station: { id: 'T1' } });
    expect(store.requestedCurrent).toEqual({ mode: 'automatic' });

    await controller.selectStation('current', currentStation);
    expect(store.requestedTide).toMatchObject({ mode: 'manual', station: { id: 'T1' } });
    expect(store.requestedCurrent).toMatchObject({ mode: 'manual', station: { id: 'C1' } });
    expect(load).toHaveBeenLastCalledWith(store, 27.7, -82.7, true);

    await controller.useAutomatic('tide');
    expect(store.requestedTide).toEqual({ mode: 'automatic' });
    expect(store.requestedCurrent).toMatchObject({ mode: 'manual', station: { id: 'C1' } });

    await controller.useNearestStations();
    expect(store.requestedTide).toEqual({ mode: 'automatic' });
    expect(store.requestedCurrent).toEqual({ mode: 'automatic' });
  });

  it('forces selections and retries and bumps the panel expansion revision', async () => {
    const store = new TidesStore();
    const load = vi.fn(
      async (_store: TidesStore, _lat: number, _lon: number, _force?: boolean) => undefined,
    );
    const controller = createTidesController(store, { load } as unknown as TidesLoader, () => ({
      lat: 27.7,
      lon: -82.7,
    }));

    await controller.selectStation('tide', tideStation);
    const revision = store.selectionRevision;
    await controller.selectStation('tide', tideStation);
    await controller.retry();

    expect(store.selectionRevision).toBe(revision + 1);
    expect(load.mock.calls.every((call) => call[3] === true)).toBe(true);
  });
});
