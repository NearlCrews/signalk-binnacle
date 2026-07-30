import type { MapLayerMouseEvent, MapLayerTouchEvent, MapTouchEvent } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';
import { activeLayerHitCursor, createLayerHitHandlers } from './layer-hit-handlers';

function hitEvent(originalEvent?: object): MapLayerMouseEvent {
  return {
    features: [],
    originalEvent,
    point: { x: 10, y: 10 },
    type: 'click',
  } as unknown as MapLayerMouseEvent;
}

function touchEvent(
  type: MapTouchEvent['type'],
  point: { x: number; y: number },
  originalEvent: object,
  features?: GeoJSON.Feature[],
): MapTouchEvent {
  return {
    features,
    originalEvent,
    point,
    points: [point],
    type,
  } as unknown as MapLayerTouchEvent;
}

describe('layer hit handlers', () => {
  it('keeps direct test and programmatic events synchronous', () => {
    const map = createFakeMap();
    const onTap = vi.fn(() => true);
    createLayerHitHandlers('marker', onTap).attach(fakeOverlayContext(map));

    map.emitLayer('click', 'marker', hitEvent());

    expect(onTap).toHaveBeenCalledOnce();
  });

  it('routes an overlapping DOM gesture only to the visually highest overlay band', async () => {
    const map = createFakeMap();
    const onSafetyTap = vi.fn(() => true);
    const onTrafficTap = vi.fn(() => true);
    const onRouteTap = vi.fn(() => true);
    const originalEvent = {};
    createLayerHitHandlers('tide', onSafetyTap, { band: 'safety' }).attach(fakeOverlayContext(map));
    createLayerHitHandlers('ais', onTrafficTap, { band: 'traffic' }).attach(
      fakeOverlayContext(map),
    );
    createLayerHitHandlers('note', onRouteTap, { band: 'routes' }).attach(fakeOverlayContext(map));

    map.emitLayer('click', 'tide', hitEvent(originalEvent));
    map.emitLayer('click', 'note', hitEvent(originalEvent));
    map.emitLayer('click', 'ais', hitEvent(originalEvent));
    await Promise.resolve();

    expect(onSafetyTap).not.toHaveBeenCalled();
    expect(onTrafficTap).not.toHaveBeenCalled();
    expect(onRouteTap).toHaveBeenCalledOnce();
  });

  it('uses explicit visual order for overlapping handlers in the same band', async () => {
    const map = createFakeMap();
    const onTopTap = vi.fn(() => true);
    const onLowerTap = vi.fn(() => true);
    const originalEvent = {};
    createLayerHitHandlers('top-note', onTopTap, {
      band: 'routes',
      withinBandOrder: 1,
    }).attach(fakeOverlayContext(map));
    createLayerHitHandlers('lower-cluster', onLowerTap, { band: 'routes' }).attach(
      fakeOverlayContext(map),
    );

    map.emitLayer('click', 'top-note', hitEvent(originalEvent));
    map.emitLayer('click', 'lower-cluster', hitEvent(originalEvent));
    await Promise.resolve();

    expect(onTopTap).toHaveBeenCalledOnce();
    expect(onLowerTap).not.toHaveBeenCalled();
  });

  it('falls through a stale higher hit to the next actionable surface', async () => {
    const map = createFakeMap();
    const onStaleTrafficTap = vi.fn(() => false);
    const onTideTap = vi.fn(() => true);
    const originalEvent = {};
    createLayerHitHandlers('ais', onStaleTrafficTap, { band: 'traffic' }).attach(
      fakeOverlayContext(map),
    );
    createLayerHitHandlers('tide', onTideTap, { band: 'safety' }).attach(fakeOverlayContext(map));

    map.emitLayer('click', 'tide', hitEvent(originalEvent));
    map.emitLayer('click', 'ais', hitEvent(originalEvent));
    await Promise.resolve();

    expect(onStaleTrafficTap).toHaveBeenCalledOnce();
    expect(onTideTap).toHaveBeenCalledOnce();
  });

  it('keeps the pressed feature when a valid touch lifts just outside its layer', async () => {
    const map = createFakeMap();
    const onTap = vi.fn(() => true);
    const feature: GeoJSON.Feature<GeoJSON.Point> = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { id: 'station' },
    };
    createLayerHitHandlers('marker', onTap).attach(fakeOverlayContext(map));

    const start = touchEvent('touchstart', { x: 10, y: 10 }, {}, [feature]);
    map.emit('touchstart', start);
    map.emitLayer('touchstart', 'marker', start);
    map.emit('touchmove', touchEvent('touchmove', { x: 17, y: 10 }, {}));
    map.emit('touchend', touchEvent('touchend', { x: 17, y: 10 }, {}));
    await Promise.resolve();

    expect(onTap).toHaveBeenCalledOnce();
    expect(onTap).toHaveBeenCalledWith(
      expect.objectContaining({
        features: [expect.objectContaining({ properties: { id: 'station' } })],
      }),
    );
  });

  it('keeps the pointer while another overlapping hit surface still owns it', () => {
    const map = createFakeMap();
    const first = createLayerHitHandlers(
      'first',
      vi.fn(() => true),
    );
    const second = createLayerHitHandlers(
      'second',
      vi.fn(() => true),
    );
    const ctx = fakeOverlayContext(map);
    const canvas = map.getCanvas() as unknown as HTMLElement;
    first.attach(ctx);
    second.attach(ctx);

    map.emitLayer('mouseenter', 'first', {});
    map.emitLayer('mouseenter', 'second', {});
    map.emitLayer('mouseleave', 'first', {});
    expect(canvas.style.cursor).toBe('pointer');
    expect(activeLayerHitCursor(canvas)).toBe('pointer');

    map.emitLayer('mouseleave', 'second', {});
    expect(canvas.style.cursor).toBe('');
    expect(activeLayerHitCursor(canvas)).toBeUndefined();
  });

  it('releases cursor ownership without overwriting an active tool cursor', () => {
    const map = createFakeMap();
    const hit = createLayerHitHandlers(
      'marker',
      vi.fn(() => true),
    );
    const canvas = map.getCanvas() as unknown as HTMLElement;
    hit.attach(fakeOverlayContext(map));

    map.emitLayer('mouseenter', 'marker', {});
    canvas.style.cursor = 'crosshair';
    map.emitLayer('mouseleave', 'marker', {});

    expect(canvas.style.cursor).toBe('crosshair');
    expect(activeLayerHitCursor(canvas)).toBeUndefined();
  });

  it('tracks hover while interactions are gated so a tool can restore the pointer', () => {
    const map = createFakeMap();
    let allowed = false;
    const hit = createLayerHitHandlers(
      'marker',
      vi.fn(() => true),
      {
        interactionsAllowed: () => allowed,
      },
    );
    const canvas = map.getCanvas() as unknown as HTMLElement;
    hit.attach(fakeOverlayContext(map));

    map.emitLayer('mouseenter', 'marker', {});
    expect(canvas.style.cursor).toBeFalsy();
    expect(activeLayerHitCursor(canvas)).toBeUndefined();

    allowed = true;
    expect(activeLayerHitCursor(canvas)).toBe('pointer');
  });

  it('refreshes cursor and touch state when a live interaction gate changes', async () => {
    const map = createFakeMap();
    let allowed = true;
    const onTap = vi.fn(() => true);
    const hit = createLayerHitHandlers('marker', onTap, {
      interactionsAllowed: () => allowed,
    });
    const canvas = map.getCanvas() as unknown as HTMLElement;
    hit.attach(fakeOverlayContext(map));

    map.emitLayer('mouseenter', 'marker', {});
    expect(canvas.style.cursor).toBe('pointer');
    const originalEvent = {};
    const start = touchEvent('touchstart', { x: 10, y: 10 }, originalEvent, []);
    map.emit('touchstart', start);
    map.emitLayer('touchstart', 'marker', start);

    allowed = false;
    hit.refreshInteractionState();
    expect(canvas.style.cursor).toBe('');
    map.emit('touchend', touchEvent('touchend', { x: 10, y: 10 }, originalEvent));
    await Promise.resolve();
    expect(onTap).not.toHaveBeenCalled();

    allowed = true;
    hit.refreshInteractionState();
    expect(canvas.style.cursor).toBe('pointer');
  });

  it('cancels an armed touch when the handlers detach', async () => {
    const map = createFakeMap();
    const onTap = vi.fn(() => true);
    const hit = createLayerHitHandlers('marker', onTap);
    const ctx = fakeOverlayContext(map);
    const start = touchEvent('touchstart', { x: 10, y: 10 }, {}, []);
    hit.attach(ctx);
    map.emit('touchstart', start);
    map.emitLayer('touchstart', 'marker', start);

    hit.detach(ctx);
    hit.attach(ctx);
    map.emit('touchend', touchEvent('touchend', { x: 10, y: 10 }, {}));
    await Promise.resolve();

    expect(onTap).not.toHaveBeenCalled();
  });
});
