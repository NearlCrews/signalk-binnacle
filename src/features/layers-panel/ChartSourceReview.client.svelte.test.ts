import { type ComponentProps, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { UserChartSource } from '$entities/user-charts';
import ChartSourceReview from './ChartSourceReview.svelte';

const source: UserChartSource = {
  id: 'chart-1',
  name: 'Harbor',
  kind: 'vector',
  origin: { type: 'url', url: 'https://charts.example/harbor.pmtiles?access_token=secret' },
  shareWithServer: false,
};
const mounted: Array<() => void> = [];

function mountReview(shareWithServer: boolean) {
  const target = document.createElement('div');
  document.body.append(target);
  const props = $state<ComponentProps<typeof ChartSourceReview>>({
    source,
    shareWithServer,
    showSpecs: false,
    onShareChange: (share: boolean) => {
      props.shareWithServer = share;
    },
  });
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(ChartSourceReview, { target, props });
  });
  mounted.push(() => {
    void unmount(component);
    target.remove();
  });
  const noteRole = (): string | null =>
    target.querySelector('.privacy-note')?.getAttribute('role') ?? null;
  const setSharing = (share: boolean): void => {
    props.shareWithServer = share;
    flushSync();
  };
  return { noteRole, setSharing };
}

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
});

describe('ChartSourceReview query-value warning', () => {
  it('announces assertively once sharing is turned on', () => {
    const review = mountReview(false);
    expect(review.noteRole()).toBe('status');

    review.setSharing(true);
    expect(review.noteRole()).toBe('alert');
  });

  it('stays polite when the review opens with sharing already on', () => {
    const review = mountReview(true);

    expect(review.noteRole()).toBe('status');
  });

  it('returns to assertive after sharing is turned off and back on', () => {
    const review = mountReview(true);
    review.setSharing(false);
    expect(review.noteRole()).toBe('status');

    review.setSharing(true);
    expect(review.noteRole()).toBe('alert');
  });
});
