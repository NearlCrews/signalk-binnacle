import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { UnitsStore } from '$entities/units';
import ForecastList from './ForecastList.svelte';

const mounted: Array<() => void> = [];

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
});

describe('ForecastList identities', () => {
  it('mounts repeated timestamps without a keyed-list collision', () => {
    const target = document.createElement('div');
    document.body.append(target);
    let component!: ReturnType<typeof mount>;
    flushSync(() => {
      component = mount(ForecastList, {
        target,
        props: {
          forecast: [
            { timeMs: 1_000, pressurePa: 100_000 },
            { timeMs: 1_000, pressurePa: 101_000 },
          ],
          horizonH: 1,
          units: { mode: 'metric' } as UnitsStore,
        },
      });
    });
    mounted.push(() => {
      void unmount(component);
      target.remove();
    });

    expect(target.querySelectorAll('li')).toHaveLength(2);
  });
});
