import { type ComponentProps, flushSync, mount, tick, unmount, untrack } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnitsStore } from '$entities/units';
import type { OwnVessel } from '$entities/vessel';
import PoiSearchPanel from './PoiSearchPanel.svelte';
import PoiSearchPanelTestHarness from './PoiSearchPanelTestHarness.svelte';
import type { Poi } from './poi-search-rows';

const places: Poi[] = [
  {
    id: 'harbor-1',
    name: 'Harbor Marina',
    position: { latitude: 42.6, longitude: -83.5 },
    category: 'marina',
    source: "Crow's Nest",
  },
  {
    id: 'fuel-1',
    name: 'North Fuel Dock',
    position: { latitude: 42.601, longitude: -83.499 },
    category: 'fuel',
    source: 'Harbor Guide',
  },
];

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function mountPanel(overrides: Partial<ComponentProps<typeof PoiSearchPanel>> = {}) {
  let notes = $state.raw<Poi[]>([]);
  let shown = $state(true);
  const pois = $derived(notes.filter(() => true).map((note) => ({ ...note })));
  const target = document.createElement('div');
  document.body.append(target);
  const props: ComponentProps<typeof PoiSearchPanel> = {
    get pois() {
      return pois;
    },
    vessel: { coarsePosition: undefined } as OwnVessel,
    units: { mode: 'metric' } as UnitsStore,
    viewState: { phase: 'ready', offline: false },
    get placesShown() {
      return shown;
    },
    onTogglePlaces: (value) => {
      shown = value;
      if (!value) notes = [];
    },
    onSelect: vi.fn(),
    onHover: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const component = mount(PoiSearchPanel, { target, props });
  flushSync();
  cleanups.push(() => {
    void unmount(component);
    target.remove();
  });
  return {
    target,
    setNotes: (next: Poi[]) => {
      notes = next;
    },
    toggle: () => {
      target.querySelector<HTMLButtonElement>('.show-on-chart')?.click();
      flushSync();
    },
    rowNames: () => [...target.querySelectorAll('.nav-name')].map((row) => row.textContent),
  };
}

describe('PoiSearchPanel reactive results', () => {
  it('retries failed current-view results without requiring chart movement', () => {
    const onRetry = vi.fn();
    const panel = mountPanel({ viewState: { phase: 'error', offline: false }, onRetry });
    const retry = [...panel.target.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Retry places',
    );
    expect(retry).toBeDefined();
    retry?.click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('keeps lazy-mounted derived results live through a hidden-cache round trip', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const component = mount(PoiSearchPanelTestHarness, { target });
    cleanups.push(() => {
      void unmount(component);
      target.remove();
    });
    component.open();
    await tick();
    await tick();
    expect(target.querySelector('[role="complementary"]')).not.toBeNull();
    const toggle = target.querySelector<HTMLButtonElement>('.show-on-chart');
    if (!toggle) throw new Error('Missing places toggle');
    toggle.click();
    flushSync();
    toggle.click();
    flushSync();
    component.setNotes(places);
    await tick();
    expect(target.querySelectorAll('.nav-name')).toHaveLength(2);
    expect(target.textContent).toContain('2 in view');
  });
  it('updates derived rows after an asynchronous first result', async () => {
    const panel = mountPanel();
    expect(panel.rowNames()).toEqual([]);
    await Promise.resolve();
    panel.setNotes(places);
    await tick();
    expect(panel.rowNames()).toEqual(['Harbor Marina', 'North Fuel Dock']);
    expect(panel.target.textContent).toContain('2 in view');
  });

  it('restores rows after hidden results clear and the same cached array returns', async () => {
    const panel = mountPanel();
    panel.setNotes(places);
    await tick();
    expect(panel.rowNames()).toHaveLength(2);
    panel.toggle();
    expect(panel.rowNames()).toHaveLength(0);
    panel.toggle();
    untrack(() => panel.setNotes(places));
    await tick();
    expect(panel.rowNames()).toHaveLength(2);
    expect(panel.target.textContent).toContain('2 in view');
  });

  it('shows the first result after hide and show while loading', async () => {
    const panel = mountPanel();
    panel.toggle();
    panel.toggle();
    panel.setNotes(places);
    await tick();
    expect(panel.rowNames()).toHaveLength(2);
    expect(panel.target.textContent).not.toContain('No places match your search');
  });
});
