import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TidesStore } from '$entities/tides';
import type { UnitsStore } from '$entities/units';
import TidesPanel from './TidesPanel.svelte';
import type { TidesController } from './tides-controller.svelte';

const tideStation = { id: 'T1', name: 'Harbor tide', latitude: 27.7, longitude: -82.7 };
const currentStation = {
  id: 'C1',
  name: 'Channel current',
  latitude: 27.71,
  longitude: -82.71,
};
const mounted: Array<() => void> = [];

function mountPanel() {
  const store = new TidesStore();
  store.setCatalogs(
    [{ station: tideStation, distanceMeters: 1000 }],
    [{ station: currentStation, distanceMeters: 2000 }],
  );
  const controller: TidesController = {
    load: vi.fn(async () => undefined),
    loadCurrent: vi.fn(async () => undefined),
    selectStation: vi.fn(async () => undefined),
    useAutomatic: vi.fn(async () => undefined),
    useNearestStations: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
  };
  const target = document.createElement('div');
  document.body.append(target);
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(TidesPanel, {
      target,
      props: {
        store,
        controller,
        units: { mode: 'metric' } as UnitsStore,
        onClose: vi.fn(),
      },
    });
  });
  mounted.push(() => {
    void unmount(component);
    target.remove();
  });
  const button = (text: string): HTMLButtonElement => {
    const found = [...target.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.replaceAll(/\s+/g, ' ').trim() === text,
    );
    if (!found) throw new Error(`no button labeled ${text}`);
    return found;
  };
  return { store, controller, target, button };
}

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
});

describe('TidesPanel interactions', () => {
  it('routes native station, automatic, and global reset controls independently', () => {
    const panel = mountPanel();
    panel.button('Harbor tide 1 km straight-line').click();
    panel.button('Use nearest stations').click();
    const automaticButtons = [...panel.target.querySelectorAll<HTMLButtonElement>('button')].filter(
      (button) => button.textContent?.includes('Automatic, nearest available'),
    );
    automaticButtons[1]?.click();
    flushSync();

    expect(panel.controller.selectStation).toHaveBeenCalledWith('tide', tideStation);
    expect(panel.controller.useNearestStations).toHaveBeenCalledTimes(1);
    expect(panel.controller.useAutomatic).toHaveBeenCalledWith('current');
  });

  it('expands a minimized panel when the selection revision changes', () => {
    const panel = mountPanel();
    panel.target.querySelector<HTMLButtonElement>('button[aria-label="Minimize panel"]')?.click();
    flushSync();
    expect(panel.target.querySelector('.panel-body')?.classList).toContain('panel-body--collapsed');

    panel.store.requestManual('tide', tideStation, 1000);
    flushSync();

    expect(panel.target.querySelector('.panel-body')?.classList).not.toContain(
      'panel-body--collapsed',
    );
  });
});
