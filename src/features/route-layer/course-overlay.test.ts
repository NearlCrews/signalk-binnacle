import { describe, expect, it, vi } from 'vitest';
import { mapThemePaint, type OverlayContext } from '$shared/map';
import { createFakeMap } from '$shared/testing';
import { createCourseOverlay } from './course-overlay';

const LINE_SRC = 'binnacle-course-line-src';
const POINT_SRC = 'binnacle-course-point-src';
const LINE_LAYER = 'binnacle-course-line';
const POINT_LAYER = 'binnacle-course-point';

interface FakeGuidance {
  active: boolean;
  nextPosition: { latitude: number; longitude: number } | undefined;
  nextPointName: string | undefined;
}

interface FakeVessel {
  position: { latitude: number; longitude: number } | undefined;
  positionStale: boolean;
}

function ctxFor(map: ReturnType<typeof createFakeMap>): OverlayContext {
  return { map: map as never, beforeIdFor: () => undefined };
}

function lineFeatures(map: ReturnType<typeof createFakeMap>): GeoJSON.Feature[] {
  return ((map.sources.get(LINE_SRC)?.data as GeoJSON.FeatureCollection | undefined)?.features ??
    []) as GeoJSON.Feature[];
}

function pointFeatures(map: ReturnType<typeof createFakeMap>): GeoJSON.Feature[] {
  return ((map.sources.get(POINT_SRC)?.data as GeoJSON.FeatureCollection | undefined)?.features ??
    []) as GeoJSON.Feature[];
}

describe('course overlay', () => {
  it('registers in the routes band with the expected ids and opacity support', () => {
    const guidance: FakeGuidance = {
      active: false,
      nextPosition: undefined,
      nextPointName: undefined,
    };
    const vessel: FakeVessel = { position: undefined, positionStale: false };
    const overlay = createCourseOverlay(guidance as never, vessel as never);
    expect(overlay.id).toBe('course');
    expect(overlay.title).toBe('Course');
    expect(overlay.band).toBe('routes');
    expect(overlay.supportsOpacity).toBe(true);
    expect(overlay.defaultVisible).toBe(true);
    expect(overlay.layerIds).toEqual([LINE_LAYER, POINT_LAYER]);
  });

  it('add creates both sources and both layers', () => {
    const guidance: FakeGuidance = {
      active: false,
      nextPosition: undefined,
      nextPointName: undefined,
    };
    const vessel: FakeVessel = { position: undefined, positionStale: false };
    const overlay = createCourseOverlay(guidance as never, vessel as never);
    const map = createFakeMap();
    const ctx = ctxFor(map);
    overlay.add(ctx);
    expect(map.sources.has(LINE_SRC)).toBe(true);
    expect(map.sources.has(POINT_SRC)).toBe(true);
    expect(map.layers.has(LINE_LAYER)).toBe(true);
    expect(map.layers.has(POINT_LAYER)).toBe(true);
    expect(lineFeatures(map)).toHaveLength(0);
    expect(pointFeatures(map)).toHaveLength(0);
  });

  it('sync draws a line from the vessel to the destination and a point at the destination when active', () => {
    const guidance: FakeGuidance = {
      active: true,
      nextPosition: { latitude: 10, longitude: 20 },
      nextPointName: 'Waypoint A',
    };
    const vessel: FakeVessel = {
      position: { latitude: 5, longitude: 15 },
      positionStale: false,
    };
    const overlay = createCourseOverlay(guidance as never, vessel as never);
    const map = createFakeMap();
    const ctx = ctxFor(map);
    overlay.add(ctx);
    overlay.sync(ctx);

    const lines = lineFeatures(map);
    expect(lines).toHaveLength(1);
    const line = lines[0].geometry as GeoJSON.LineString;
    expect(line.type).toBe('LineString');
    expect(line.coordinates).toHaveLength(2);
    // First coordinate: vessel position as [longitude, latitude].
    expect(line.coordinates[0]).toEqual([15, 5]);
    // Second coordinate: destination as [longitude, latitude].
    expect(line.coordinates[1]).toEqual([20, 10]);

    const points = pointFeatures(map);
    expect(points).toHaveLength(1);
    const point = points[0].geometry as GeoJSON.Point;
    expect(point.type).toBe('Point');
    expect(point.coordinates).toEqual([20, 10]);
  });

  it('sync clears both sources when not active', () => {
    const guidance: FakeGuidance = {
      active: true,
      nextPosition: { latitude: 10, longitude: 20 },
      nextPointName: undefined,
    };
    const vessel: FakeVessel = { position: { latitude: 5, longitude: 15 }, positionStale: false };
    const overlay = createCourseOverlay(guidance as never, vessel as never);
    const map = createFakeMap();
    const ctx = ctxFor(map);
    overlay.add(ctx);
    overlay.sync(ctx);
    expect(lineFeatures(map)).toHaveLength(1);

    // Deactivate and sync again.
    guidance.active = false;
    overlay.sync(ctx);
    expect(lineFeatures(map)).toHaveLength(0);
    expect(pointFeatures(map)).toHaveLength(0);
  });

  it('sync clears both sources when the vessel has no position fix', () => {
    const guidance: FakeGuidance = {
      active: true,
      nextPosition: { latitude: 10, longitude: 20 },
      nextPointName: undefined,
    };
    const vessel: FakeVessel = { position: undefined, positionStale: false };
    const overlay = createCourseOverlay(guidance as never, vessel as never);
    const map = createFakeMap();
    const ctx = ctxFor(map);
    overlay.add(ctx);
    overlay.sync(ctx);
    expect(lineFeatures(map)).toHaveLength(0);
    expect(pointFeatures(map)).toHaveLength(0);
  });

  it('sync clears both sources when the vessel position is stale', () => {
    const guidance: FakeGuidance = {
      active: true,
      nextPosition: { latitude: 10, longitude: 20 },
      nextPointName: undefined,
    };
    const vessel: FakeVessel = { position: { latitude: 5, longitude: 15 }, positionStale: false };
    const overlay = createCourseOverlay(guidance as never, vessel as never);
    const map = createFakeMap();
    const ctx = ctxFor(map);
    overlay.add(ctx);
    overlay.sync(ctx);
    expect(lineFeatures(map)).toHaveLength(1);
    vessel.positionStale = true;
    overlay.sync(ctx);
    expect(lineFeatures(map)).toHaveLength(0);
    expect(pointFeatures(map)).toHaveLength(0);
  });

  it('sync is a no-op when neither the vessel nor the destination has moved', () => {
    const guidance: FakeGuidance = {
      active: true,
      nextPosition: { latitude: 10, longitude: 20 },
      nextPointName: undefined,
    };
    const vessel: FakeVessel = { position: { latitude: 5, longitude: 15 }, positionStale: false };
    const overlay = createCourseOverlay(guidance as never, vessel as never);
    const map = createFakeMap();
    const ctx = ctxFor(map);
    overlay.add(ctx);
    overlay.sync(ctx);

    // Capture the source object and spy on setData to confirm it is not called again.
    const lineSrc = map.sources.get(LINE_SRC);
    const pointSrc = map.sources.get(POINT_SRC);
    if (!lineSrc || !pointSrc) throw new Error('course sources not added');
    const lineSpy = vi.spyOn(lineSrc, 'setData');
    const pointSpy = vi.spyOn(pointSrc, 'setData');

    overlay.sync(ctx);
    expect(lineSpy).not.toHaveBeenCalled();
    expect(pointSpy).not.toHaveBeenCalled();
  });

  it('sync redraws when the vessel moves', () => {
    const guidance: FakeGuidance = {
      active: true,
      nextPosition: { latitude: 10, longitude: 20 },
      nextPointName: undefined,
    };
    const vessel: FakeVessel = { position: { latitude: 5, longitude: 15 }, positionStale: false };
    const overlay = createCourseOverlay(guidance as never, vessel as never);
    const map = createFakeMap();
    const ctx = ctxFor(map);
    overlay.add(ctx);
    overlay.sync(ctx);

    vessel.position = { latitude: 5.001, longitude: 15.001 };
    overlay.sync(ctx);

    const line = lineFeatures(map)[0].geometry as GeoJSON.LineString;
    expect(line.coordinates[0]).toEqual([15.001, 5.001]);
  });

  it('applyTheme recolors the line and point layers with the new select paint', () => {
    const guidance: FakeGuidance = {
      active: false,
      nextPosition: undefined,
      nextPointName: undefined,
    };
    const vessel: FakeVessel = { position: undefined, positionStale: false };
    const overlay = createCourseOverlay(guidance as never, vessel as never);
    const map = createFakeMap();
    const ctx = ctxFor(map);
    overlay.add(ctx);
    const nightPaint = mapThemePaint('night-red');
    overlay.applyTheme?.(ctx, nightPaint);
    expect(map.setPaintProperty).toHaveBeenCalledWith(LINE_LAYER, 'line-color', nightPaint.select);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      POINT_LAYER,
      'circle-color',
      nightPaint.select,
    );
  });

  it('remove tears down both layers and both sources', () => {
    const guidance: FakeGuidance = {
      active: false,
      nextPosition: undefined,
      nextPointName: undefined,
    };
    const vessel: FakeVessel = { position: undefined, positionStale: false };
    const overlay = createCourseOverlay(guidance as never, vessel as never);
    const map = createFakeMap();
    const ctx = ctxFor(map);
    overlay.add(ctx);
    overlay.remove(ctx);
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });
});
