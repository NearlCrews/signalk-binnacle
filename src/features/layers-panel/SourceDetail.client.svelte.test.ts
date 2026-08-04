import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserChartSource, UserCharts } from '$entities/user-charts';
import type { LayerListItem } from '$shared/map';
import SourceDetail from './SourceDetail.svelte';

const url = 'https://charts.example/harbor.pmtiles';
const source: UserChartSource = {
  id: 'chart-1',
  name: 'Harbor',
  kind: 'vector',
  origin: { type: 'url', url },
  shareWithServer: false,
};
const item: LayerListItem = {
  id: 'chart-source-chart-1',
  title: 'Harbor',
  visible: true,
  opacity: 1,
  supportsOpacity: true,
  pinned: false,
  band: 'bathymetry',
  available: true,
  chart: { identifier: source.id, source: 'user', kind: 'vector', type: 'tileJSON', url },
};
const mounted: Array<() => void> = [];

function mountDetail() {
  const target = document.createElement('div');
  document.body.append(target);
  const remove = vi.fn();
  // Never settles, so the panel stays in its 'reading' operation for the length of the test.
  const stageReplacement = vi.fn(() => new Promise<never>(() => {}));
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(SourceDetail, {
      target,
      props: {
        item,
        userCharts: { remove, stageReplacement } as unknown as UserCharts,
        userSource: source,
        writeBlocked: false,
        onBack: () => {},
      },
    });
  });
  mounted.push(() => {
    void unmount(component);
    target.remove();
  });
  const button = (label: string): HTMLButtonElement | undefined =>
    [...target.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
  const click = (label: string): void => {
    const found = button(label);
    if (!found) throw new Error(`no button labeled ${label}`);
    found.click();
    flushSync();
  };
  return { target, remove, button, click };
}

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
});

describe('SourceDetail delete gating', () => {
  it('disarms the delete confirm and blocks deletion once a source write starts', () => {
    const detail = mountDetail();
    detail.click('Delete chart');
    expect(detail.target.textContent).toContain('Delete this chart?');

    detail.click('Refresh metadata');

    expect(detail.target.textContent).not.toContain('Delete this chart?');
    expect(detail.button('Delete chart')?.disabled).toBe(true);
    expect(detail.remove).not.toHaveBeenCalled();
  });

  it('deletes normally when no source write is in flight', () => {
    const detail = mountDetail();
    detail.click('Delete chart');
    detail.click('Delete');

    expect(detail.remove).toHaveBeenCalledWith('chart-1');
  });
});
