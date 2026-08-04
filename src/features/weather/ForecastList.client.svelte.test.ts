import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { UnitsStore } from '$entities/units';
import ForecastList from './ForecastList.svelte';

const mounted: Array<() => void> = [];

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
});

function renderList(props: Record<string, unknown>): HTMLElement {
  const target = document.createElement('div');
  document.body.append(target);
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(ForecastList, {
      target,
      props: { horizonH: 1, units: { mode: 'metric' } as UnitsStore, forecast: [], ...props },
    });
  });
  mounted.push(() => {
    void unmount(component);
    target.remove();
  });
  return target;
}

describe('ForecastList identities', () => {
  it('mounts repeated timestamps without a keyed-list collision', () => {
    const target = renderList({
      forecast: [
        { timeMs: 1_000, pressurePa: 100_000 },
        { timeMs: 1_000, pressurePa: 101_000 },
      ],
    });

    expect(target.querySelectorAll('li')).toHaveLength(2);
  });

  it('names the provider instead of the internal provenance token', () => {
    const target = renderList({
      forecast: [{ timeMs: 1_000, pressurePa: 100_000, provenance: 'provider' }],
      providerLabel: 'Meteo Nord',
    });

    expect(target.textContent).toContain('Meteo Nord');
    expect(target.textContent).not.toMatch(/provider/i);
  });

  it('renders the wind-wave height the conditions block shows', () => {
    const target = renderList({
      forecast: [{ timeMs: 1_000, waveHeightM: 2, windWaveHeightM: 1.2 }],
    });

    expect(target.textContent).toContain('Wind waves');
  });
});
