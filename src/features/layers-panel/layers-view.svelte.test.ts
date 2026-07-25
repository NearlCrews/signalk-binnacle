import { describe, expect, it } from 'vitest';
import type { OverlayContext, OverlayModule } from '$shared/map';
import { LayerManager } from '$shared/map';
import { fakeOverlayContext } from '$shared/testing';
import { LayersView } from './layers-view.svelte';

// The empty map is load-bearing: any direct map access from the view would throw, proving the
// view goes through the LayerManager only.
const fakeCtx = (): OverlayContext => fakeOverlayContext({});

function fakeOverlay(id: string): OverlayModule {
  return {
    id,
    title: id.toUpperCase(),
    band: 'basemap',
    supportsOpacity: true,
    layerIds: [id],
    add: () => {},
    remove: () => {},
    setVisible: () => {},
    setOpacity: () => {},
  };
}

describe('LayersView', () => {
  it('reflects the manager snapshot', async () => {
    const manager = new LayerManager(fakeCtx());
    await manager.register(fakeOverlay('noaa'));
    const view = new LayersView(manager);
    view.refresh();
    expect(view.items.map((i) => i.title)).toEqual(['NOAA']);
  });

  it('toggle delegates to the manager and refreshes', async () => {
    const manager = new LayerManager(fakeCtx());
    await manager.register(fakeOverlay('noaa'));
    const view = new LayersView(manager);
    view.refresh();
    view.toggle('noaa', false);
    expect(view.items[0].visible).toBe(false);
  });

  it('setOpacity delegates and refreshes', async () => {
    const manager = new LayerManager(fakeCtx());
    await manager.register(fakeOverlay('noaa'));
    const view = new LayersView(manager);
    view.refresh();
    view.setOpacity('noaa', 0.3);
    expect(view.items[0].opacity).toBe(0.3);
  });
});
