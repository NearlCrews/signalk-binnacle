import './maplibre-worker';
import { Map as MapLibreMap } from 'maplibre-gl';
import { expect, it, vi } from 'vitest';
import { type ContextMenuHandle, installContextMenu } from './long-press';

it('emits chart actions once when the real map also recognizes a touch long press', async () => {
  const container = document.createElement('div');
  container.style.width = '400px';
  container.style.height = '300px';
  document.body.append(container);
  const map = new MapLibreMap({
    container,
    style: { version: 8, sources: {}, layers: [] },
    center: [0, 0],
    zoom: 1,
    attributionControl: false,
  });
  let handle: ContextMenuHandle | undefined;
  try {
    await map.once('load');
    const emit = vi.fn();
    const upstreamContextMenu = vi.fn();
    handle = installContextMenu(map, emit);
    map.on('contextmenu', upstreamContextMenu);
    const canvas = map.getCanvas();
    const rect = canvas.getBoundingClientRect();
    const clientX = rect.left + 100;
    const clientY = rect.top + 100;
    const touch = new Touch({ identifier: 1, target: canvas, clientX, clientY });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerType: 'touch',
        pointerId: 1,
        isPrimary: true,
        clientX,
        clientY,
        bubbles: true,
      }),
    );
    canvas.dispatchEvent(
      new TouchEvent('touchstart', {
        touches: [touch],
        targetTouches: [touch],
        changedTouches: [touch],
        bubbles: true,
        cancelable: true,
      }),
    );
    vi.advanceTimersByTime(500);
    expect(upstreamContextMenu).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ x: 100, y: 100 }));
  } finally {
    handle?.remove();
    map.remove();
    container.remove();
    vi.useRealTimers();
  }
});
