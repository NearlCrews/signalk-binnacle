import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DraftChart, UserCharts } from '$entities/user-charts';
import AddChartForm from './AddChartForm.svelte';

const CHART_URL = 'https://charts.example/harbor.pmtiles';
const mounted: Array<() => void> = [];

function mountForm() {
  const target = document.createElement('div');
  document.body.append(target);
  const draft: DraftChart = {
    source: {
      id: 'chart-1',
      name: 'Harbor',
      kind: 'vector',
      origin: { type: 'url', url: CHART_URL },
    },
  };
  const stageUrl = vi.fn(async (_url: string, _signal?: AbortSignal) => draft);
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(AddChartForm, {
      target,
      props: {
        userCharts: { stageUrl } as unknown as UserCharts,
        onDone: () => {},
      },
    });
  });
  mounted.push(() => {
    void unmount(component);
    target.remove();
  });
  const type = (value: string): void => {
    const input = target.querySelector('input');
    if (!input) throw new Error('no URL input');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  };
  const pressEnter = (): void => {
    const input = target.querySelector('input');
    if (!input) throw new Error('no URL input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    flushSync();
  };
  return { target, stageUrl, type, pressEnter };
}

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
});

describe('AddChartForm URL entry', () => {
  it('stages the typed URL when Enter is pressed', () => {
    const form = mountForm();
    form.type(CHART_URL);
    form.pressEnter();

    expect(form.stageUrl).toHaveBeenCalledTimes(1);
    expect(form.stageUrl.mock.calls[0]?.[0]).toBe(CHART_URL);
  });

  it('ignores Enter on an empty URL field', () => {
    const form = mountForm();
    form.pressEnter();

    expect(form.stageUrl).not.toHaveBeenCalled();
  });
});
