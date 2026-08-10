import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnitsMode } from '$shared/lib';
import { MarineRadarStore } from './marine-radar-store.svelte';
import RadarControls from './RadarControls.svelte';

const mounted: Array<() => void> = [];

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
});

function mountControls(store: MarineRadarStore, onSetControl = vi.fn()) {
  const target = document.createElement('div');
  document.body.append(target);
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(RadarControls, {
      target,
      props: {
        store,
        onSetControl,
        onSetAuto: vi.fn(),
        onSetAreaControl: vi.fn(),
        onSetAreaDraft: vi.fn(),
        onStartAreaChartEdit: vi.fn(),
        onStopAreaChartEdit: vi.fn(),
        onSetPower: vi.fn(),
        echoShown: true,
        onToggleEcho: vi.fn(),
        unitsMode: 'metric' as UnitsMode,
      },
    });
  });
  mounted.push(() => {
    void unmount(component);
    target.remove();
  });
  return { target, onSetControl };
}

function discoverRadar(store: MarineRadarStore, controls: Record<string, { value: number }> = {}) {
  store.setDiscovered([
    {
      id: 'radar',
      name: 'Radar',
      status: 'standby',
      spokesPerRevolution: 2048,
      maxSpokeLen: 1024,
      range: 1852,
      controls,
    },
  ]);
}

describe('RadarControls enum values', () => {
  it('keeps typed values and whitespace-bearing wire ids distinct from DOM ids', () => {
    const store = new MarineRadarStore();
    discoverRadar(store, { 'mode port': { value: 1 }, 'mode-port': { value: 2 } });
    store.setCapabilities([
      {
        id: 'mode port',
        name: 'Port mode',
        dialect: 'v5',
        type: 'enum',
        values: [
          { value: 1, label: 'Numeric mode' },
          { value: '1', label: 'String mode' },
        ],
      },
      {
        id: 'mode-port',
        name: 'Dashed mode',
        dialect: 'v5',
        type: 'enum',
        values: [{ value: 2, label: 'Second mode' }],
      },
    ]);
    const { target, onSetControl } = mountControls(store);

    const selects = [...target.querySelectorAll<HTMLSelectElement>('select[aria-labelledby]')];
    expect(selects).toHaveLength(2);
    const labelIds = selects.map((entry) => entry.getAttribute('aria-labelledby'));
    expect(labelIds).toEqual(['radar-control-label-0', 'radar-control-label-1']);
    expect(new Set(labelIds).size).toBe(2);
    expect(labelIds.every((id) => id !== null && !/\s/.test(id))).toBe(true);
    const select = selects.find(
      (entry) =>
        document.getElementById(entry.getAttribute('aria-labelledby') ?? '')?.textContent ===
        'Port mode',
    );
    if (!select) throw new Error('expected port mode select');
    expect([...select.options].map(({ value }) => value)).toEqual(['number:1', 'string:1']);
    select.value = 'string:1';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onSetControl).toHaveBeenCalledWith('mode port', '1');
  });
});

describe('RadarControls status', () => {
  it('reports a live stream without claiming a spoke arrival time it cannot know', () => {
    const store = new MarineRadarStore();
    discoverRadar(store);
    store.setStatus('live');
    const { target } = mountControls(store);

    expect(target.textContent).toContain('Connected');
    expect(target.textContent).not.toContain('Latest spoke received');
  });

  it('keeps the discovery detail visible beside the unavailable hint', () => {
    const store = new MarineRadarStore();
    store.setAvailability('unreachable', 'Radar discovery returned HTTP 503.');
    const { target } = mountControls(store);

    expect(target.textContent).toContain('The Signal K radar provider could not be reached.');
    expect(target.textContent).toContain('Radar discovery returned HTTP 503.');
  });
});

describe('RadarControls pending writes', () => {
  it('keeps a scalar widget usable while its write is pending, gating only power', () => {
    const store = new MarineRadarStore();
    discoverRadar(store, { gain: { value: 50 } });
    store.setCapabilities([
      {
        id: 'gain',
        name: 'Gain',
        dialect: 'v5',
        type: 'number',
        range: { min: 0, max: 100 },
        modes: ['auto', 'manual'],
      },
    ]);
    store.setControlPending('gain', true);
    store.setControlPending('power', true);
    const { target } = mountControls(store);

    const slider = target.querySelector<HTMLInputElement>('input[type="range"]');
    expect(slider?.disabled).toBe(false);
    const auto = target.querySelector<HTMLButtonElement>('button.auto-toggle');
    expect(auto?.disabled).toBe(false);
    expect(target.textContent).toContain('Applying');
    const standby = [...target.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === 'Standby',
    );
    expect(standby?.disabled).toBe(true);
  });
});

describe('RadarControls sliders', () => {
  it('announces the live value with its unit, and says so when no value has arrived', () => {
    const store = new MarineRadarStore();
    discoverRadar(store, { gain: { value: 50 }, range: { value: 1852 } });
    store.setCapabilities([
      { id: 'gain', name: 'Gain', dialect: 'v5', type: 'number', range: { min: 0, max: 100 } },
      {
        id: 'range',
        name: 'Range',
        dialect: 'v5',
        type: 'number',
        range: { min: 0, max: 100_000, unit: 'm' },
      },
      {
        id: 'bearing',
        name: 'Bearing alignment',
        dialect: 'v5',
        type: 'number',
        range: { min: 0, max: Math.PI, unit: 'rad' },
      },
    ]);
    const { target } = mountControls(store);

    const sliders = [...target.querySelectorAll<HTMLInputElement>('input[type="range"]')];
    expect(sliders).toHaveLength(3);
    const valueTexts = sliders.map((slider) => slider.getAttribute('aria-valuetext'));
    expect(valueTexts).toEqual(['50', '1852.0 m', 'No value reported']);
  });
});
