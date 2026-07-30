import { describe, expect, it, vi } from 'vitest';
import { MeasureStore } from '$entities/measure';
import type { UnitsMode } from '$shared/lib';
import { createFakeMap, fakeOverlayContext, sourceFeatures } from '$shared/testing';
import { createMeasureOverlay, rhumbDisplayMidpoint } from './measure-overlay';

function setup(mode: UnitsMode = 'metric') {
  const measure = new MeasureStore();
  const map = createFakeMap();
  const units: { mode: UnitsMode } = { mode };
  const overlay = createMeasureOverlay(measure, units);
  return { measure, map, units, overlay, ctx: fakeOverlayContext(map) };
}

describe('measure overlay', () => {
  it('renders nothing while no measurement is in progress', async () => {
    const { overlay, map, ctx } = setup();
    await overlay.add(ctx);
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-measure')).toHaveLength(0);
  });

  it('renders vertices, a leg, its label, and the total label on the last point', async () => {
    const { measure, overlay, map, ctx } = setup();
    await overlay.add(ctx);
    measure.start();
    measure.add({ latitude: 0, longitude: 0 });
    measure.add({ latitude: 0.001, longitude: 0 });
    overlay.sync(ctx);
    const all = sourceFeatures(map, 'binnacle-measure');
    expect(all.filter((f) => f.properties?.kind === 'vertex')).toHaveLength(2);
    expect(all.filter((f) => f.geometry.type === 'LineString')).toHaveLength(1);
    expect(all.find((f) => f.properties?.kind === 'leg-label')?.properties?.label).toBe('111 m');
    expect(all.find((f) => f.properties?.totalLabel)?.properties?.totalLabel).toBe('111 m');
  });

  it('redraws after each accepted point, not only the first one', async () => {
    const { measure, overlay, map, ctx } = setup();
    await overlay.add(ctx);
    measure.start();
    measure.add({ latitude: 0, longitude: 0 });
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-measure')).toHaveLength(1);
    measure.add({ latitude: 0.001, longitude: 0 });
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-measure')).toHaveLength(4);
  });

  it('unwraps an antimeridian crossing into the short visual leg', async () => {
    const { measure, overlay, map, ctx } = setup();
    await overlay.add(ctx);
    measure.start();
    measure.add({ latitude: 0, longitude: 179 });
    measure.add({ latitude: 0, longitude: -179 });
    overlay.sync(ctx);
    const line = sourceFeatures(map, 'binnacle-measure').find(
      (feature) => feature.geometry.type === 'MultiLineString',
    );
    expect(line?.geometry).toEqual({
      type: 'MultiLineString',
      coordinates: [
        [
          [179, 0],
          [180, 0],
        ],
        [
          [-180, 0],
          [-179, 0],
        ],
      ],
    });
  });

  it('relabels the total when the unit preference flips', async () => {
    const { measure, overlay, map, units, ctx } = setup();
    await overlay.add(ctx);
    measure.start();
    measure.add({ latitude: 0, longitude: 0 });
    measure.add({ latitude: 0.001, longitude: 0 });
    overlay.sync(ctx);
    units.mode = 'imperial';
    overlay.sync(ctx);
    const labeled = sourceFeatures(map, 'binnacle-measure').find(
      (f) => f.properties?.kind === 'leg-label',
    );
    expect(labeled?.properties?.label).toMatch(/ ft$/);
  });

  it('places an antimeridian leg label on the seam instead of near Greenwich', async () => {
    const { measure, overlay, map, ctx } = setup();
    await overlay.add(ctx);
    measure.start();
    measure.add({ latitude: 10, longitude: 179 });
    measure.add({ latitude: 12, longitude: -179 });
    overlay.sync(ctx);
    const label = sourceFeatures(map, 'binnacle-measure').find(
      (feature) => feature.properties?.kind === 'leg-label',
    );
    expect(label?.geometry.type).toBe('Point');
    if (label?.geometry.type !== 'Point') throw new Error('leg label is not a point');
    expect(Math.abs(label.geometry.coordinates[0])).toBeGreaterThan(179);
    expect(rhumbDisplayMidpoint(measure.points[0], measure.points[1]).latitude).toBeCloseTo(11, 1);
  });

  it('uses a 44 pixel hit target and collision-managed labels above a bounded zoom', async () => {
    const { overlay, map, ctx } = setup();
    await overlay.add(ctx);
    const hit = map.layers.get('binnacle-measure-hit') as {
      paint: Record<string, unknown>;
    };
    const labels = map.layers.get('binnacle-measure-leg-label') as {
      minzoom: number;
      layout: Record<string, unknown>;
    };
    expect(hit.paint['circle-radius']).toBe(22);
    expect(labels.minzoom).toBe(8);
    expect(labels.layout['text-allow-overlap']).toBe(false);
    expect(labels.layout['text-ignore-placement']).toBe(false);
    expect(labels.layout['symbol-avoid-edges']).toBe(true);
  });

  it('selects through the hit surface and commits one deliberate drag operation', async () => {
    const { measure, overlay, map, ctx } = setup();
    await overlay.add(ctx);
    measure.start();
    measure.add({ latitude: 0, longitude: 0 });
    measure.add({ latitude: 0.001, longitude: 0 });
    const vertexId = measure.vertices[0].id;
    map.renderedFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { vertexId },
    });
    expect(overlay.hitTestVertex([0, 0])).toBe(vertexId);
    measure.select(vertexId);
    measure.armMove();
    const preventDefault = vi.fn();
    map.emitLayer('mousedown', 'binnacle-measure-hit', {
      features: [{ properties: { vertexId } }],
      lngLat: { lat: 0, lng: 0 },
      preventDefault,
    });
    map.emit('mousemove', { lngLat: { lat: 0.0005, lng: 0.0005 } });
    overlay.sync(ctx);
    expect(measure.displayPoints[0]).toEqual({ latitude: 0.0005, longitude: 0.0005 });
    map.emit('mouseup', { lngLat: { lat: 0.0005, lng: 0.0005 } });
    expect(preventDefault).toHaveBeenCalled();
    expect(measure.points[0]).toEqual({ latitude: 0.0005, longitude: 0.0005 });
    expect(measure.moveArmed).toBe(false);
    expect(overlay.consumeTrailingClick()).toBe(true);
    measure.undo();
    expect(measure.points[0]).toEqual({ latitude: 0, longitude: 0 });
  });

  it('ignores a rendered vertex that no longer exists in the current measurement', async () => {
    const { measure, overlay, map, ctx } = setup();
    await overlay.add(ctx);
    measure.start();
    measure.add({ latitude: 0, longitude: 0 });
    const vertexId = measure.vertices[0].id;
    map.renderedFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { vertexId },
    });

    expect(overlay.hitTestVertex([0, 0])).toBe(vertexId);
    measure.undo();
    expect(overlay.hitTestVertex([0, 0])).toBeUndefined();
  });

  it('does not resolve a stale rendered vertex to a new measurement session', async () => {
    const { measure, overlay, map, ctx } = setup();
    await overlay.add(ctx);
    measure.start();
    measure.add({ latitude: 0, longitude: 0 });
    const staleId = measure.vertices[0].id;
    map.renderedFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { vertexId: staleId },
    });

    measure.start();
    measure.add({ latitude: 1, longitude: 1 });

    expect(measure.vertices[0].id).not.toBe(staleId);
    expect(overlay.hitTestVertex([0, 0])).toBeUndefined();
  });

  it('finds the first current point behind stale and non-point rendered features', async () => {
    const { measure, overlay, map, ctx } = setup();
    await overlay.add(ctx);
    measure.start();
    measure.add({ latitude: -1, longitude: -1 });
    const staleId = measure.vertices[0].id;
    measure.start();
    measure.add({ latitude: 0, longitude: 0 });
    measure.add({ latitude: 1, longitude: 1 });
    const [lineOnlyId, pointId] = measure.vertices.map((vertex) => vertex.id);
    map.renderedFeatures.push(
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
        properties: { vertexId: lineOnlyId },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { vertexId: staleId },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [1, 1] },
        properties: { vertexId: pointId },
      },
    );

    expect(overlay.hitTestVertex([0, 0])).toBe(pointId);
  });

  it('cancels an interrupted touch drag and restores map panning', async () => {
    const { measure, overlay, map, ctx } = setup();
    await overlay.add(ctx);
    measure.start();
    measure.add({ latitude: 0, longitude: 0 });
    const vertexId = measure.vertices[0].id;
    measure.select(vertexId);
    measure.armMove();
    map.emitLayer('touchstart', 'binnacle-measure-hit', {
      features: [{ properties: { vertexId } }],
      points: [{ x: 0, y: 0 }],
      lngLat: { lat: 0, lng: 0 },
      preventDefault: vi.fn(),
    });
    map.emit('touchmove', { lngLat: { lat: 1, lng: 1 } });
    map.emit('touchcancel', {});
    expect(measure.points[0]).toEqual({ latitude: 0, longitude: 0 });
    expect(measure.moveArmed).toBe(false);
    expect(map.dragPan.disable).toHaveBeenCalledOnce();
    expect(map.dragPan.enable).toHaveBeenCalledOnce();
  });

  it('scales the line, the vertices, and the label with the overlay opacity', async () => {
    const { overlay, map, ctx } = setup();
    await overlay.add(ctx);
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
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-measure-leg-label',
      'text-opacity',
      0.4,
    );
  });

  it('clears once the tool stops', async () => {
    const { measure, overlay, map, ctx } = setup();
    await overlay.add(ctx);
    measure.start();
    measure.add({ latitude: 0, longitude: 0 });
    overlay.sync(ctx);
    measure.stop();
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-measure')).toHaveLength(0);
  });
});
