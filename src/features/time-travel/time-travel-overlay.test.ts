import { describe, expect, it } from 'vitest';
import { mapThemePaint } from '$shared/map';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';
import type { TimeTravelData } from './time-travel-client';
import type { TimeTravelController } from './time-travel-controller.svelte';
import { createTimeTravelOverlay, createTimeTravelTrackOverlay } from './time-travel-overlay';
import { timeTravelPreset } from './time-travel-presets';

function fakeController() {
  const accepted: TimeTravelData = {
    provider: 'p',
    preset: timeTravelPreset('24h'),
    from: 0,
    to: 2_000,
    samples: [
      { t: 0, lon: 179, lat: 1 },
      { t: 1_000, lon: -179, lat: 2 },
      { t: 2_000, lon: -178, lat: 3 },
    ],
  };
  const state = {
    active: true,
    accepted,
    scrubMs: 1_000,
    markerSample: accepted.samples[1] as TimeTravelData['samples'][number] | undefined,
  };
  const controller = {
    get active() {
      return state.active;
    },
    status: 'ready',
    refreshing: false,
    get accepted() {
      return state.accepted;
    },
    requestedRangeId: undefined,
    rangeId: '24h',
    get samples() {
      return state.accepted.samples;
    },
    from: 0,
    to: 2_000,
    get scrubMs() {
      return state.scrubMs;
    },
    current: accepted.samples[1],
    get markerSample() {
      return state.markerSample;
    },
    playing: false,
    speed: 1,
    reducedMotion: false,
    error: undefined,
    enter: async () => {},
    exit: () => {},
    reload: async () => {},
    retry: async () => {},
    setRange: async () => {},
    setScrub: () => {},
    step: () => {},
    goToLatest: () => {},
    play: () => {},
    pause: () => {},
    setSpeed: () => {},
    dispose: () => {},
  } as TimeTravelController;
  return { controller, state };
}

describe('time-travel overlays', () => {
  it('adds separate marker and selected-range track layers', async () => {
    const { controller } = fakeController();
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    const marker = createTimeTravelOverlay(controller);
    const track = createTimeTravelTrackOverlay(controller);
    await marker.add(ctx);
    await track.add(ctx);
    expect(map.sources.has('binnacle-time-travel-marker')).toBe(true);
    expect(map.sources.has('binnacle-time-travel-track')).toBe(true);
    expect(map.layers.has('binnacle-time-travel-marker-circle')).toBe(true);
    expect(map.layers.has('binnacle-time-travel-track-line')).toBe(true);
  });

  it('updates the marker only when its accepted sample changes and hides it when unavailable', async () => {
    const { controller, state } = fakeController();
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    const overlay = createTimeTravelOverlay(controller);
    await overlay.add(ctx);
    overlay.sync(ctx);
    const marker = map.sources.get('binnacle-time-travel-marker')
      ?.data as GeoJSON.FeatureCollection;
    expect(marker.features).toHaveLength(1);
    overlay.sync(ctx);
    state.markerSample = undefined;
    overlay.sync(ctx);
    const hidden = map.sources.get('binnacle-time-travel-marker')?.data as
      | GeoJSON.FeatureCollection
      | undefined;
    expect(hidden?.features).toEqual([]);
  });

  it('clips the track at the scrub time and keeps antimeridian geometry short', async () => {
    const { controller, state } = fakeController();
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    const overlay = createTimeTravelTrackOverlay(controller);
    await overlay.add(ctx);
    overlay.sync(ctx);
    const track = map.sources.get('binnacle-time-travel-track')?.data as GeoJSON.FeatureCollection;
    expect(track.features).toHaveLength(1);
    const coordinates = (
      track.features[0].geometry as GeoJSON.MultiLineString | GeoJSON.LineString
    ).coordinates.flat(2) as number[];
    expect(Math.min(...coordinates)).toBeGreaterThanOrEqual(-180);
    expect(Math.max(...coordinates)).toBeLessThanOrEqual(180);

    state.scrubMs = 2_000;
    overlay.sync(ctx);
    const expanded = map.sources.get('binnacle-time-travel-track')
      ?.data as GeoJSON.FeatureCollection;
    expect(expanded.features).toHaveLength(1);
  });

  it('clips the track through the accepted sample backing a marker ahead of the scrub time', async () => {
    const { controller, state } = fakeController();
    state.scrubMs = 500;
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    const overlay = createTimeTravelTrackOverlay(controller);
    await overlay.add(ctx);
    overlay.sync(ctx);

    const track = map.sources.get('binnacle-time-travel-track')?.data as GeoJSON.FeatureCollection;
    expect(track.features).toHaveLength(1);
  });

  it('recolors and removes both overlays cleanly', async () => {
    const { controller } = fakeController();
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    const marker = createTimeTravelOverlay(controller);
    const track = createTimeTravelTrackOverlay(controller);
    await marker.add(ctx);
    await track.add(ctx);
    marker.applyTheme?.(ctx, mapThemePaint('night-red'));
    track.applyTheme?.(ctx, mapThemePaint('night-red'));
    expect(map.setPaintProperty).toHaveBeenCalled();
    marker.remove(ctx);
    track.remove(ctx);
    expect(map.sources.size).toBe(0);
    expect(map.layers.size).toBe(0);
  });
});
