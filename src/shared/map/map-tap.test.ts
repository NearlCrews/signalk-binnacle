import type { MapMouseEvent, MapTouchEvent } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import { createMapTapRecognizer } from './map-tap';

function mouseEvent(
  target?: object,
  x = 4,
  y = 5,
  originalEvent: object = { pointerType: 'mouse' },
): MapMouseEvent {
  return { point: { x, y }, target, originalEvent } as MapMouseEvent;
}

function touchEvent(
  x: number,
  y: number,
  points = 1,
  target?: object,
  originalEvent: object = {},
): MapTouchEvent {
  return {
    point: { x, y },
    points: Array.from({ length: points }, () => ({ x, y })),
    target,
    originalEvent,
  } as unknown as MapTouchEvent;
}

describe('map tap recognizer', () => {
  it('dispatches mouse clicks', () => {
    const onTap = vi.fn();
    createMapTapRecognizer(onTap).click(mouseEvent());
    expect(onTap).toHaveBeenCalledOnce();
  });

  it('dispatches a still one-finger touch and cancels its native compatibility click', () => {
    let now = 1_000;
    const onTap = vi.fn();
    const preventDefault = vi.fn();
    const tap = createMapTapRecognizer(
      onTap,
      () => true,
      () => now,
    );

    tap.touchstart(touchEvent(10, 20));
    now += 100;
    tap.touchend(touchEvent(14, 24, 1, undefined, { preventDefault }));

    expect(onTap).toHaveBeenCalledOnce();
    expect(onTap).toHaveBeenCalledWith(expect.objectContaining({ point: { x: 14, y: 24 } }));
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('preserves a real mouse click at the same point immediately after touch', () => {
    let now = 1_000;
    const target = {};
    const onTap = vi.fn();
    const preventDefault = vi.fn();
    const tap = createMapTapRecognizer(
      onTap,
      () => true,
      () => now,
    );

    tap.touchstart(touchEvent(10, 20, 1, target));
    now += 100;
    tap.touchend(touchEvent(10, 20, 1, target, { preventDefault }));
    tap.click(mouseEvent(target, 10, 20, { pointerType: 'mouse' }));

    expect(onTap).toHaveBeenCalledTimes(2);
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('rejects pans, long presses, and multi-touch gestures without canceling native input', () => {
    let now = 1_000;
    const onTap = vi.fn();
    const preventDefault = vi.fn();
    const tap = createMapTapRecognizer(
      onTap,
      () => true,
      () => now,
    );

    tap.touchstart(touchEvent(10, 20));
    tap.touchmove(touchEvent(30, 20));
    tap.touchend(touchEvent(30, 20, 1, undefined, { preventDefault }));

    tap.touchstart(touchEvent(10, 20));
    now += 451;
    tap.touchend(touchEvent(10, 20, 1, undefined, { preventDefault }));

    tap.touchstart(touchEvent(10, 20, 2));
    tap.touchend(touchEvent(10, 20, 1, undefined, { preventDefault }));

    expect(onTap).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('honors a live interaction gate for mouse and touch', () => {
    let allowed = false;
    const onTap = vi.fn();
    const preventDefault = vi.fn();
    const tap = createMapTapRecognizer(onTap, () => allowed);

    tap.click(mouseEvent());
    tap.touchstart(touchEvent(10, 20));
    allowed = true;
    tap.touchend(touchEvent(10, 20, 1, undefined, { preventDefault }));
    expect(onTap).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();

    tap.touchstart(touchEvent(10, 20));
    tap.touchend(touchEvent(10, 20, 1, undefined, { preventDefault }));
    expect(onTap).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('does not cancel native input after an armed touch is canceled', () => {
    const onTap = vi.fn();
    const preventDefault = vi.fn();
    const tap = createMapTapRecognizer(onTap);

    tap.touchstart(touchEvent(10, 20));
    tap.cancel();
    tap.touchend(touchEvent(10, 20, 1, undefined, { preventDefault }));

    expect(onTap).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('lets a marker accept a real mouse click immediately after another recognizer handles touch', () => {
    let now = 1_000;
    let markerAllowed = false;
    const target = {};
    const chartTap = vi.fn();
    const markerTap = vi.fn();
    const preventDefault = vi.fn();
    const chart = createMapTapRecognizer(
      chartTap,
      () => true,
      () => now,
    );
    const marker = createMapTapRecognizer(
      markerTap,
      () => markerAllowed,
      () => now,
    );

    chart.touchstart(touchEvent(10, 20, 1, target));
    marker.touchstart(touchEvent(10, 20, 1, target));
    now += 100;
    const touchEnd = touchEvent(10, 20, 1, target, { preventDefault });
    chart.touchend(touchEnd);
    marker.touchend(touchEnd);
    markerAllowed = true;
    marker.click(mouseEvent(target, 10, 20));

    expect(chartTap).toHaveBeenCalledOnce();
    expect(markerTap).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('does not suppress a genuine mixed-input click elsewhere on the map', () => {
    let now = 1_000;
    const target = {};
    const onTap = vi.fn();
    const tap = createMapTapRecognizer(
      onTap,
      () => true,
      () => now,
    );

    tap.touchstart(touchEvent(10, 20, 1, target));
    now += 100;
    tap.touchend(touchEvent(10, 20, 1, target));
    tap.click(mouseEvent(target, 200, 200));

    expect(onTap).toHaveBeenCalledTimes(2);
  });
});
