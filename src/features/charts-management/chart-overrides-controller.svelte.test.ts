import { describe, expect, it, vi } from 'vitest';
import { createChartOverridesController } from './chart-overrides-controller.svelte';
import type { ManagedChart } from './charts-management-client';

const chart: ManagedChart = {
  identifier: 'chart-1',
  fileName: 'chart.pmtiles',
  name: 'Chart',
  description: '',
  scale: 10_000,
  minzoom: 0,
  maxzoom: 14,
  format: 'mvt',
  override: {},
};

function deferredBoolean() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('createChartOverridesController', () => {
  it('serializes overlapping fields and sends the merged latest override last', async () => {
    let current = chart;
    const first = deferredBoolean();
    const second = deferredBoolean();
    const write = vi
      .fn<(id: string, override: ManagedChart['override']) => Promise<boolean>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const controller = createChartOverridesController({
      getChart: () => current,
      updateOverride: (_id, override) => {
        current = { ...current, override };
      },
      write,
    });

    controller.save(current, 'name', 'New name');
    controller.save(current, 'description', 'New description');
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[1]).toEqual({ name: 'New name' });

    first.resolve(true);
    await tick();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]?.[1]).toEqual({
      name: 'New name',
      description: 'New description',
    });

    second.resolve(true);
    await tick();
    expect(controller.states['chart-1:name']).toBe('saved');
    expect(controller.states['chart-1:description']).toBe('saved');
    controller.dispose();
  });

  it('keeps the optimistic value and exposes a failed save', async () => {
    let current = chart;
    const controller = createChartOverridesController({
      getChart: () => current,
      updateOverride: (_id, override) => {
        current = { ...current, override };
      },
      write: async () => false,
    });
    controller.save(current, 'name', 'Unsaved name');
    await tick();
    expect(current.override.name).toBe('Unsaved name');
    expect(controller.states['chart-1:name']).toBe('error');
    controller.dispose();
  });

  it('retries the current merged override after a failed save', async () => {
    let current = chart;
    const write = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const controller = createChartOverridesController({
      getChart: () => current,
      updateOverride: (_id, override) => {
        current = { ...current, override };
      },
      write,
    });

    controller.save(current, 'name', 'Retry name');
    await tick();
    controller.retry('chart-1', 'name');
    await tick();

    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith('chart-1', { name: 'Retry name' });
    expect(controller.states['chart-1:name']).toBe('saved');
    controller.dispose();
  });
});
