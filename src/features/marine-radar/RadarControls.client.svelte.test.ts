import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnitsMode } from '$shared/lib';
import { MarineRadarStore } from './marine-radar-store.svelte';
import RadarControls from './RadarControls.svelte';

const mounted: Array<() => void> = [];

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
});

describe('RadarControls enum values', () => {
  it('keeps typed values and whitespace-bearing wire ids distinct from DOM ids', () => {
    const store = new MarineRadarStore();
    store.setDiscovered([
      {
        id: 'radar',
        name: 'Radar',
        status: 'standby',
        spokesPerRevolution: 2048,
        maxSpokeLen: 1024,
        range: 1852,
        controls: { 'mode port': { value: 1 }, 'mode-port': { value: 2 } },
      },
    ]);
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
    const onSetControl = vi.fn();
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
