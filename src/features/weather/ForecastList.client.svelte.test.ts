import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { UnitsStore } from '$entities/units';
import type { WeatherGrid } from '$entities/weather';
import { HOUR_MS, METRIC_UNITS } from '$shared/lib';
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
      props: {
        horizonH: 1,
        units: { mode: 'metric', profile: METRIC_UNITS } as UnitsStore,
        forecast: [],
        ...props,
      },
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

describe('ForecastList coming days outlook', () => {
  // Local-time constructions keep the day grouping true in any zone the suite runs in.
  const day0 = new Date(2026, 5, 10).getTime();
  const grid: WeatherGrid = {
    lats: [0, 1],
    lons: [0, 1],
    times: [day0 + 20 * HOUR_MS, day0 + 30 * HOUR_MS, day0 + 36 * HOUR_MS, day0 + 50 * HOUR_MS],
    windU: Array.from({ length: 4 }, () => [-10, -10, -10, -10]),
    windV: Array.from({ length: 4 }, () => [0, 0, 0, 0]),
  };
  const forecast = [
    { timeMs: day0 + 12 * HOUR_MS, windMs: 5 },
    { timeMs: day0 + 20 * HOUR_MS, windMs: 6 },
  ];

  it('stays hourly-only without the grid and position', () => {
    const target = renderList({ forecast });
    expect(target.querySelector('button[aria-expanded]')).toBeNull();
  });

  it('collapses one summary row per remaining grid day under a disclosure', () => {
    const target = renderList({ forecast, grid, gridPosition: [0.5, 0.5] });

    const toggle = target.querySelector<HTMLButtonElement>('button[aria-expanded]');
    if (!toggle) throw new Error('expected the Coming days toggle');
    expect(toggle.textContent).toContain('Coming days');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    const body = target.querySelector('.disclosure-body');
    if (!body) throw new Error('expected the disclosure body');
    expect(body.hasAttribute('hidden')).toBe(true);
    expect(body.querySelectorAll('li')).toHaveLength(2);
    expect(body.textContent).toContain('°T');

    flushSync(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(body.hasAttribute('hidden')).toBe(false);
  });
});
