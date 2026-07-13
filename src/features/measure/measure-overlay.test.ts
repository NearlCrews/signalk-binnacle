import { describe, expect, it } from 'vitest';
import { MeasureStore } from '$entities/measure';
import type { UnitsMode } from '$shared/lib';
import type { OverlayContext } from '$shared/map';
import { createFakeMap, sourceFeatures } from '$shared/testing/fake-map';
import { createMeasureOverlay } from './measure-overlay';

function ctxFor(map: ReturnType<typeof createFakeMap>): OverlayContext {
  return { map: map as never, beforeIdFor: () => undefined };
}

function setup(mode: UnitsMode = 'metric') {
  const measure = new MeasureStore();
  const map = createFakeMap();
  const units: { mode: UnitsMode } = { mode };
  const overlay = createMeasureOverlay(measure, units);
  return { measure, map, units, overlay, ctx: ctxFor(map) };
}

describe('measure overlay', () => {
  it('renders nothing while no measurement is in progress', () => {
    const { overlay, map, ctx } = setup();
    overlay.add(ctx);
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-measure')).toHaveLength(0);
  });

  it('renders vertices, the line, and the total label on the last point', () => {
    const { measure, overlay, map, ctx } = setup();
    overlay.add(ctx);
    measure.start();
    measure.add({ latitude: 0, longitude: 0 });
    measure.add({ latitude: 0.001, longitude: 0 });
    overlay.sync(ctx);
    const all = sourceFeatures(map, 'binnacle-measure');
    expect(all.filter((f) => f.geometry.type === 'Point')).toHaveLength(2);
    expect(all.filter((f) => f.geometry.type === 'LineString')).toHaveLength(1);
    const labeled = all.find((f) => f.properties?.label);
    expect(labeled?.properties?.label).toBe('111 m');
  });

  it('redraws after each accepted point, not only the first one', () => {
    const { measure, overlay, map, ctx } = setup();
    overlay.add(ctx);
    measure.start();
    measure.add({ latitude: 0, longitude: 0 });
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-measure')).toHaveLength(1);
    measure.add({ latitude: 0.001, longitude: 0 });
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-measure')).toHaveLength(3);
  });

  it('unwraps an antimeridian crossing into the short visual leg', () => {
    const { measure, overlay, map, ctx } = setup();
    overlay.add(ctx);
    measure.start();
    measure.add({ latitude: 0, longitude: 179 });
    measure.add({ latitude: 0, longitude: -179 });
    overlay.sync(ctx);
    const line = sourceFeatures(map, 'binnacle-measure').find(
      (feature) => feature.geometry.type === 'LineString',
    );
    expect(line?.geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [179, 0],
        [181, 0],
      ],
    });
  });

  it('relabels the total when the unit preference flips', () => {
    const { measure, overlay, map, units, ctx } = setup();
    overlay.add(ctx);
    measure.start();
    measure.add({ latitude: 0, longitude: 0 });
    measure.add({ latitude: 0.001, longitude: 0 });
    overlay.sync(ctx);
    units.mode = 'imperial';
    overlay.sync(ctx);
    const labeled = sourceFeatures(map, 'binnacle-measure').find((f) => f.properties?.label);
    expect(labeled?.properties?.label).toMatch(/ ft$/);
  });

  it('scales the line, the vertices, and the label with the overlay opacity', () => {
    const { overlay, map, ctx } = setup();
    overlay.add(ctx);
    overlay.setOpacity?.(ctx, 0.4);
    expect(map.setPaintProperty).toHaveBeenCalledWith('binnacle-measure-line', 'line-opacity', 0.4);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-measure-vertex',
      'circle-opacity',
      0.4,
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-measure-vertex',
      'circle-stroke-opacity',
      0.4,
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-measure-label',
      'text-opacity',
      0.4,
    );
  });

  it('clears once the tool stops', () => {
    const { measure, overlay, map, ctx } = setup();
    overlay.add(ctx);
    measure.start();
    measure.add({ latitude: 0, longitude: 0 });
    overlay.sync(ctx);
    measure.stop();
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-measure')).toHaveLength(0);
  });
});
