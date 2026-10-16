import { cubicOut } from 'svelte/easing';
import { describe, expect, it } from 'vitest';
import { type SurfaceMotion, surfaceMotionParams } from './transitions';

describe('surfaceMotionParams', () => {
  it('slides a side panel in from the edge it docks to', () => {
    expect(surfaceMotionParams('left', false)).toEqual({
      kind: 'fly',
      params: { x: -24, y: 0, opacity: 0.3, easing: cubicOut, duration: 180 },
    });
    expect(surfaceMotionParams('right', false)).toEqual({
      kind: 'fly',
      params: { x: 24, y: 0, opacity: 0.3, easing: cubicOut, duration: 180 },
    });
  });

  it('raises a bottom sheet from below', () => {
    expect(surfaceMotionParams('below', false)).toEqual({
      kind: 'fly',
      params: { x: 0, y: 32, opacity: 0.3, easing: cubicOut, duration: 180 },
    });
  });

  it('grows a dropdown from its anchor corner', () => {
    expect(surfaceMotionParams('grow', false)).toEqual({
      kind: 'scale',
      params: { start: 0.92, opacity: 0.5, easing: cubicOut, duration: 140 },
    });
  });

  it('holds every surface still under reduced motion', () => {
    for (const motion of ['left', 'right', 'below', 'grow'] satisfies SurfaceMotion[])
      expect(surfaceMotionParams(motion, true).params.duration).toBe(0);
  });
});
