import { describe, expect, it } from 'vitest';
import type { TrackRecorder } from '$entities/track';
import { mapThemePaint } from '$shared/map';
import type { PersistedValue, TrackSettings } from '$shared/settings';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';
import { createTrackOverlay } from './track-overlay';

function stubRecorder(points: TrackRecorder['points']): TrackRecorder {
  return { points } as unknown as TrackRecorder;
}

function stubSettings(colorMode: TrackSettings['colorMode']): PersistedValue<TrackSettings> {
  return {
    value: { intervalSeconds: 10, minMeters: 10, colorMode },
  } as PersistedValue<TrackSettings>;
}

describe('track overlay', () => {
  it('adds active and saved sources and line layers in the track band', async () => {
    const overlay = createTrackOverlay(stubRecorder([]), stubSettings('speed'));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    expect(overlay.band).toBe('track');
    expect(map.sources.size).toBe(2);
    expect(map.layers.has('binnacle-track-active-line')).toBe(true);
    expect(map.layers.has('binnacle-track-saved-line')).toBe(true);
  });

  it('sync sets the active source data from the recorder points', async () => {
    const overlay = createTrackOverlay(
      stubRecorder([
        { lat: 0, lon: 0, t: 0, sog: 1 },
        { lat: 0, lon: 0.01, t: 10_000, sog: 2 },
      ]),
      stubSettings('speed'),
    );
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.sync(fakeOverlayContext(map));
    const source = map.sources.get('binnacle-track-active');
    const fc = source?.data as GeoJSON.FeatureCollection;
    expect(fc.features.length).toBe(1);
  });

  it('simplifies a straight run of collinear points to a single segment', async () => {
    // Five points on one east-west line, more than 9 m apart end to end: Douglas-Peucker collapses
    // the three interior points, leaving one segment from the first to the last.
    const points = [
      { lat: 0, lon: 0, t: 0, sog: 1 },
      { lat: 0, lon: 0.01, t: 10_000, sog: 1 },
      { lat: 0, lon: 0.02, t: 20_000, sog: 1 },
      { lat: 0, lon: 0.03, t: 30_000, sog: 1 },
      { lat: 0, lon: 0.04, t: 40_000, sog: 1 },
    ];
    const overlay = createTrackOverlay(stubRecorder(points), stubSettings('speed'));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.sync(fakeOverlayContext(map));
    const fc = map.sources.get('binnacle-track-active')?.data as GeoJSON.FeatureCollection;
    expect(fc.features.length).toBe(1);
    const line = fc.features[0].geometry as GeoJSON.LineString;
    expect(line.coordinates).toEqual([
      [0, 0],
      [0.04, 0],
    ]);
  });

  it('splits the active line at a gap point so no segment crosses the break', async () => {
    // Two legs separated by a gap point: the segment from the last point of leg one to the gap point
    // is suppressed, so the result is two single-segment legs, not one line drawn across the break.
    const points = [
      { lat: 0, lon: 0, t: 0, sog: 1 },
      { lat: 0, lon: 0.01, t: 10_000, sog: 1 },
      { lat: 1, lon: 1, t: 1_000_000, sog: 1, gap: true },
      { lat: 1, lon: 1.01, t: 1_010_000, sog: 1 },
    ];
    const overlay = createTrackOverlay(stubRecorder(points), stubSettings('speed'));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.sync(fakeOverlayContext(map));
    const fc = map.sources.get('binnacle-track-active')?.data as GeoJSON.FeatureCollection;
    expect(fc.features.length).toBe(2);
    const legs = fc.features.map((f) => (f.geometry as GeoJSON.LineString).coordinates);
    expect(legs).toContainEqual([
      [0, 0],
      [0.01, 0],
    ]);
    expect(legs).toContainEqual([
      [1, 1],
      [1.01, 1],
    ]);
  });

  it('extends the active line incrementally as new fixes arrive', async () => {
    // The recorder array is shared by reference, so appending a fix and re-syncing must extend the
    // rendered line. A turn (not collinear) keeps both segments rather than collapsing them.
    const points = [
      { lat: 0, lon: 0, t: 0, sog: 1 },
      { lat: 0, lon: 0.02, t: 10_000, sog: 1 },
    ];
    const overlay = createTrackOverlay(stubRecorder(points), stubSettings('speed'));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.sync(fakeOverlayContext(map));
    let fc = map.sources.get('binnacle-track-active')?.data as GeoJSON.FeatureCollection;
    expect(fc.features.length).toBe(1);

    points.push({ lat: 0.02, lon: 0.02, t: 20_000, sog: 1 });
    overlay.sync(fakeOverlayContext(map));
    fc = map.sources.get('binnacle-track-active')?.data as GeoJSON.FeatureCollection;
    expect(fc.features.length).toBe(2);
  });

  it('applyTheme recolors both layers', async () => {
    const overlay = createTrackOverlay(stubRecorder([]), stubSettings('solid'));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.applyTheme?.(fakeOverlayContext(map), mapThemePaint('night-red'));
    expect(map.setPaintProperty).toHaveBeenCalled();
  });

  it('remove tears down layers and sources', async () => {
    const overlay = createTrackOverlay(stubRecorder([]), stubSettings('speed'));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.remove(fakeOverlayContext(map));
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });

  it('absorbs a theme, opacity, or sync that lands before add attaches the layers', async () => {
    const overlay = createTrackOverlay(stubRecorder([]), stubSettings('speed'));
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    expect(() => overlay.applyTheme?.(ctx, mapThemePaint('night-red'))).not.toThrow();
    expect(() => overlay.setOpacity?.(ctx, 0.4)).not.toThrow();
    expect(() => overlay.sync(ctx)).not.toThrow();
    expect(map.setPaintProperty).not.toHaveBeenCalled();

    await overlay.add(ctx);
    overlay.setOpacity?.(ctx, 0.4);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-track-active-line',
      'line-opacity',
      0.4,
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-track-saved-line',
      'line-opacity',
      0.4,
    );
  });

  it('still applies the color mode on the sync after add when an earlier sync found no layer', async () => {
    const overlay = createTrackOverlay(stubRecorder([]), stubSettings('speed'));
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    overlay.sync(ctx);
    await overlay.add(ctx);
    overlay.sync(ctx);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-track-active-line',
      'line-color',
      expect.anything(),
    );
  });
});
