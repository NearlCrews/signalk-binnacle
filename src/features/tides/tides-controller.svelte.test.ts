import { afterEach, describe, expect, it, vi } from 'vitest';
import { TidesStore } from '$entities/tides';
import { createTidesController } from './tides-controller.svelte';
import type { TidesLoader } from './tides-loader';

const tideStation = { id: 'T1', name: 'Tide', latitude: 27.7, longitude: -82.7 };
const currentStation = { id: 'C1', name: 'Current', latitude: 27.8, longitude: -82.8 };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createTidesController', () => {
  it('refreshes a stationary wanted view on a bounded cadence and focus, using current context', async () => {
    vi.useFakeTimers();
    const focus = new EventTarget();
    vi.stubGlobal('window', focus);
    const state = {
      wanted: true,
      online: true,
      visible: true,
      token: 'first',
      view: { lat: 1, lon: 2 },
    };
    const store = new TidesStore();
    const load = vi.fn(async () => undefined);
    const controller = createTidesController(store, { load }, () => state.view, {
      wanted: () => state.wanted,
      online: () => state.online,
      visible: () => state.visible,
      token: () => state.token,
    });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i += 1) focus.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(load).toHaveBeenCalledTimes(1);
    state.view = { lat: 3, lon: 4 };
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenLastCalledWith(store, 3, 4, false);
    expect(load).toHaveBeenCalledTimes(2);
    state.token = 'approved';
    focus.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenLastCalledWith(store, 3, 4, true);
    expect(load).toHaveBeenCalledTimes(3);
    state.visible = false;
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    state.visible = true;
    state.online = false;
    focus.dispatchEvent(new Event('focus'));
    expect(load).toHaveBeenCalledTimes(3);
    state.online = true;
    focus.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(4);
    state.wanted = false;
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(load).toHaveBeenCalledTimes(4);
    controller.stop();
    state.wanted = true;
    focus.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(load).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not queue automatic requests while another load is pending', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const load = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const controller = createTidesController(
      new TidesStore(),
      { load },
      () => ({ lat: 1, lon: 2 }),
      {
        wanted: () => true,
        online: () => true,
        visible: () => true,
        token: () => undefined,
      },
    );
    controller.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(load).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(2);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    controller.stop();
  });

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
