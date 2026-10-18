import type { Map as MapLibreMap } from 'maplibre-gl';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import VesselOffScreenIndicator from './VesselOffScreenIndicator.svelte';

const mounted: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()?.();
});

// A chart 400 by 300 inside a host that publishes the access banner's height, with the vessel far
// above the view, so the arrow clamps to the top of the clear rectangle.
function setup(bannerPx: number) {
  const host = document.createElement('section');
  host.style.setProperty('--chrome-inset-top', '0px');
  host.style.setProperty('--auth-banner-height', `${bannerPx}px`);
  const container = document.createElement('div');
  container.style.cssText = 'position:relative;width:400px;height:300px;';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:400px;height:300px;display:block;';
  container.append(canvas);
  host.append(container);
  document.body.append(host);
  const map = {
    getContainer: () => container,
    getCanvas: () => canvas,
    getBounds: () => ({ getWest: () => 0, getSouth: () => 0, getEast: () => 1, getNorth: () => 1 }),
    project: () => ({ x: 200, y: -2000 }),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as MapLibreMap;
  const component = mount(VesselOffScreenIndicator, {
    target: container,
    props: { map, position: { latitude: 10, longitude: 0.5 }, onCenter: () => {} },
  });
  flushSync();
  mounted.push(async () => {
    await unmount(component);
    host.remove();
  });
  return { host, container };
}

describe('VesselOffScreenIndicator', () => {
  it('keeps the arrow below the access banner rather than under it', () => {
    const { container } = setup(100);
    const arrow = container.querySelector<HTMLElement>('.off-screen-indicator');
    if (!arrow) throw new Error('the arrow did not show');
    // The edge inset (28) below the banner's 100 px.
    expect(Number.parseFloat(arrow.style.top)).toBeCloseTo(128, 0);
  });

  it('hides when the banner leaves no room for it', () => {
    const { container } = setup(260);
    expect(container.querySelector('.off-screen-indicator')).toBeNull();
  });
});
