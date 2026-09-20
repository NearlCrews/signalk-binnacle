import { afterEach, describe, expect, it, vi } from 'vitest';
import { RAMP_WIDTH } from '../wind-color-texture';
import type { WindField } from '../wind-field-texture';
import { WindParticles } from './wind-particles';

afterEach(() => vi.restoreAllMocks());

const SIZE = 96;
const matrix = new Float32Array([2, 0, 0, 0, 0, -2, 0, 0, 0, 0, 1, 0, -1, 1, 0, 1]);

function draw(inheritedBlend: boolean, opacity = 1, uMin = 5, uMax = 5): Uint8Array {
  let seed = 123;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 2 ** 32;
  });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 is required for the wind rendering regression');
  const particles = new WindParticles(gl, {
    resolution: 16,
    dropRate: 0,
    dropRateBump: 0,
    fadeOpacity: 0,
  });
  try {
    const data = new Uint8Array(16);
    for (let i = 0; i < 4; i += 1) data.set([127, 0, 0, 255], i * 4);
    const field: WindField = {
      data,
      width: 2,
      height: 2,
      uMin,
      uMax,
      vMin: 0,
      vMax: 0,
      west: -170,
      east: 170,
      south: -70,
      north: 70,
    };
    particles.setWind(field);
    const ramp = new Uint8Array(RAMP_WIDTH * 4);
    for (let i = 0; i < RAMP_WIDTH; i += 1) ramp.set([200, 0, 0, 128], i * 4);
    particles.setTheme(ramp);
    particles.setOpacity(opacity);
    for (let frame = 0; frame < 20; frame += 1) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (inheritedBlend) gl.enable(gl.BLEND);
      else gl.disable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      particles.render(matrix, SIZE, SIZE, frame === 0);
    }
    const pixels = new Uint8Array(SIZE * SIZE * 4);
    gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.clear(gl.COLOR_BUFFER_BIT);
    particles.blit(SIZE, SIZE);
    const blitted = new Uint8Array(pixels.length);
    gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, blitted);
    expect(blitted).toEqual(pixels);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    return pixels;
  } finally {
    particles.dispose();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    vi.restoreAllMocks();
  }
}

describe('wind particle GPU composition', () => {
  it('treats negative-to-zero encoding like the equivalent constant velocity', () => {
    const velocity = -5 + (5 * 127) / 255;
    expect(draw(true, 1, -5, 0)).toEqual(draw(true, 1, velocity, velocity));
  });
  it.each([
    [5, 5],
    [-5, 0],
    [0, 0],
  ])('ignores inherited blending for a %s to %s m/s field', (min, max) => {
    const clean = draw(false, 1, min, max);
    expect(draw(true, 1, min, max)).toEqual(clean);
    expect(Array.from(clean).filter((v, i) => i % 4 === 3 && v > 0).length).toBeGreaterThan(100);
  });

  it('preserves particle alpha and applies overlay opacity once', () => {
    const full = draw(true);
    const half = draw(true, 0.5);
    const isolated = Array.from(full).findIndex((v, i) => i % 4 === 3 && v === 128);
    expect(isolated).toBeGreaterThan(0);
    expect(full[isolated - 3]).toBeGreaterThanOrEqual(99);
    expect(half[isolated]).toBe(64);
    expect(half[isolated - 3]).toBeGreaterThanOrEqual(49);
    expect(half[isolated - 3]).toBeLessThanOrEqual(51);
  });
});
