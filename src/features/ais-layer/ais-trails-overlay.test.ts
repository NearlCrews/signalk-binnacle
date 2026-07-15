import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mapThemePaint, type OverlayContext, rgbaCss } from '$shared/map';
import { createFakeMap, sourceFeatures } from '$shared/testing';
import { type AisTrail, fetchAisTrails } from './ais-trails-client';
import { type AisTrailsOverlay, createAisTrailsOverlay } from './ais-trails-overlay';

vi.mock('./ais-trails-client', () => ({ fetchAisTrails: vi.fn() }));
const fetchMock = vi.mocked(fetchAisTrails);

const LAYER_ID = 'binnacle-ais-trails-line';
const SOURCE_ID = 'binnacle-ais-trails';

function trailA(): AisTrail {
  return {
    context: 'vessels.urn:mrn:imo:mmsi:111111111',
    line: [
      [0, 0],
      [0.1, 0.1],
    ],
  };
}

function trailSelf(): AisTrail {
  return {
    context: 'vessels.urn:self',
    line: [
      [0.2, 0.2],
      [0.3, 0.3],
    ],
  };
}

// A fake map that renders sources and layers (createFakeMap) and also answers the viewport calls
// sync makes: a 2 by 2 degree view around a mutable center, so a test pans by mutating the state.
function viewFakeMap(state: { zoom: number; lng: number; lat: number }) {
  return {
    ...createFakeMap(),
    getZoom: () => state.zoom,
    getCenter: () => ({ lng: state.lng, lat: state.lat }),
    getBounds: () => ({
      getWest: () => state.lng - 1,
      getSouth: () => state.lat - 1,
      getEast: () => state.lng + 1,
      getNorth: () => state.lat + 1,
    }),
  };
}

function ctxFor(map: unknown): OverlayContext {
  return { map: map as never, beforeIdFor: () => undefined };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

// Sync once to let the overlay observe any move, wait past the settle debounce, then sync again so
// a settled viewport reaches the fetch decision.
async function settleSync(overlay: AisTrailsOverlay, ctx: OverlayContext): Promise<void> {
  overlay.sync(ctx);
  vi.advanceTimersByTime(500);
  overlay.sync(ctx);
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ais trails overlay', () => {
  it('adds an empty line source and layer in the traffic band', () => {
    const overlay = createAisTrailsOverlay(
      'http://pi',
      () => undefined,
      () => true,
    );
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    expect(overlay.id).toBe('ais-trails');
    expect(overlay.title).toBe('AIS trails');
    expect(overlay.band).toBe('traffic');
    expect(overlay.supportsOpacity).toBe(true);
    expect(map.layers.has(LAYER_ID)).toBe(true);
    expect(sourceFeatures(map, SOURCE_ID)).toHaveLength(0);
  });

  it('fetches nothing while the tracks plugin is unavailable', async () => {
    const overlay = createAisTrailsOverlay(
      'http://pi',
      () => undefined,
      () => false,
    );
    const state = { zoom: 12, lng: 0, lat: 0 };
    const map = viewFakeMap(state);
    const ctx = ctxFor(map);
    overlay.add(ctx);
    await settleSync(overlay, ctx);
    await settleSync(overlay, ctx);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sourceFeatures(map, SOURCE_ID)).toHaveLength(0);
  });

  it('fetches once the viewport settles and renders one line per trail, excluding self', async () => {
    fetchMock.mockResolvedValue([trailA(), trailSelf()]);
    const overlay = createAisTrailsOverlay(
      'http://pi',
      () => undefined,
      () => true,
      () => 'vessels.urn:self',
    );
    const state = { zoom: 12, lng: 0, lat: 0 };
    const map = viewFakeMap(state);
    const ctx = ctxFor(map);
    overlay.add(ctx);
    await settleSync(overlay, ctx);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const features = sourceFeatures<GeoJSON.Feature>(map, SOURCE_ID);
    expect(features).toHaveLength(1);
    expect(features[0].geometry).toEqual({ type: 'LineString', coordinates: trailA().line });
    expect(features[0].properties).toEqual({ context: trailA().context });
  });

  it('skips the rebuild when a refetch returns unchanged trails, rebuilds when one moved', async () => {
    fetchMock.mockImplementation(async () => [trailA()]);
    const overlay = createAisTrailsOverlay(
      'http://pi',
      () => undefined,
      () => true,
    );
    const state = { zoom: 12, lng: 0, lat: 0 };
    const map = viewFakeMap(state);
    const ctx = ctxFor(map);
    overlay.add(ctx);
    const source = [...map.sources.values()][0];
    const spy = vi.spyOn(source, 'setData');
    await settleSync(overlay, ctx);
    expect(spy).toHaveBeenCalledTimes(1);

    // A steady-state refetch with the same trails: no rebuild.
    vi.advanceTimersByTime(30_000);
    await settleSync(overlay, ctx);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledTimes(1);

    // The vessel moved (tail advanced): rebuild.
    const moved = trailA();
    moved.line = [...moved.line, [0.2, 0.2]];
    fetchMock.mockImplementation(async () => [moved]);
    vi.advanceTimersByTime(30_000);
    await settleSync(overlay, ctx);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('holds one fetch in flight', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const overlay = createAisTrailsOverlay(
      'http://pi',
      () => undefined,
      () => true,
    );
    const state = { zoom: 12, lng: 0, lat: 0 };
    const ctx = ctxFor(viewFakeMap(state));
    overlay.add(ctx);
    await settleSync(overlay, ctx);
    state.lng = 30;
    await settleSync(overlay, ctx);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the shown wakes on a failed refetch and clears on a real empty answer', async () => {
    fetchMock.mockResolvedValueOnce([trailA()]);
    const overlay = createAisTrailsOverlay(
      'http://pi',
      () => undefined,
      () => true,
    );
    const state = { zoom: 12, lng: 0, lat: 0 };
    const map = viewFakeMap(state);
    const ctx = ctxFor(map);
    overlay.add(ctx);
    await settleSync(overlay, ctx);
    expect(sourceFeatures(map, SOURCE_ID)).toHaveLength(1);

    fetchMock.mockResolvedValueOnce(undefined);
    vi.advanceTimersByTime(30_000);
    await settleSync(overlay, ctx);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sourceFeatures(map, SOURCE_ID)).toHaveLength(1);

    fetchMock.mockResolvedValueOnce([]);
    vi.advanceTimersByTime(30_000);
    await settleSync(overlay, ctx);
    expect(sourceFeatures(map, SOURCE_ID)).toHaveLength(0);
  });

  it('reuses the padded fetch area for a small pan, refetches once the viewport leaves it', async () => {
    fetchMock.mockResolvedValue([]);
    const overlay = createAisTrailsOverlay(
      'http://pi',
      () => undefined,
      () => true,
    );
    const state = { zoom: 12, lng: 0, lat: 0 };
    const ctx = ctxFor(viewFakeMap(state));
    overlay.add(ctx);
    await settleSync(overlay, ctx);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Still inside the padded fetch area and within the cadence: no fetch.
    state.lng = 0.4;
    await settleSync(overlay, ctx);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Left the fetched area: fetches as soon as it settles, without waiting out the cadence.
    state.lng = 30;
    await settleSync(overlay, ctx);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a hidden layer neither fetches nor renders', async () => {
    fetchMock.mockResolvedValue([trailA()]);
    const overlay = createAisTrailsOverlay(
      'http://pi',
      () => undefined,
      () => true,
    );
    const state = { zoom: 12, lng: 0, lat: 0 };
    const map = viewFakeMap(state);
    const ctx = ctxFor(map);
    overlay.add(ctx);
    overlay.setVisible(ctx, false);
    await settleSync(overlay, ctx);
    expect(fetchMock).not.toHaveBeenCalled();
    overlay.setVisible(ctx, true);
    await settleSync(overlay, ctx);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears the shown wakes when the plugin becomes unavailable', async () => {
    fetchMock.mockResolvedValue([trailA()]);
    let available = true;
    const overlay = createAisTrailsOverlay(
      'http://pi',
      () => undefined,
      () => available,
    );
    const state = { zoom: 12, lng: 0, lat: 0 };
    const map = viewFakeMap(state);
    const ctx = ctxFor(map);
    overlay.add(ctx);
    await settleSync(overlay, ctx);
    expect(sourceFeatures(map, SOURCE_ID)).toHaveLength(1);
    available = false;
    overlay.sync(ctx);
    expect(sourceFeatures(map, SOURCE_ID)).toHaveLength(0);
  });

  it('applyTheme recolors the trail line with the theme AIS color', () => {
    const overlay = createAisTrailsOverlay(
      'http://pi',
      () => undefined,
      () => true,
    );
    const map = createFakeMap();
    const ctx = ctxFor(map);
    overlay.add(ctx);
    const paint = mapThemePaint('night-red');
    overlay.applyTheme?.(ctx, paint);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      LAYER_ID,
      'line-color',
      rgbaCss(paint.aisTarget),
    );
  });

  it('setOpacity scales the built-in fade rather than overriding it', () => {
    const overlay = createAisTrailsOverlay(
      'http://pi',
      () => undefined,
      () => true,
    );
    const map = createFakeMap();
    const ctx = ctxFor(map);
    overlay.add(ctx);
    overlay.setOpacity?.(ctx, 0.5);
    const [, property, value] = vi.mocked(map.setPaintProperty).mock.calls.at(-1) as [
      string,
      string,
      number,
    ];
    expect(property).toBe('line-opacity');
    expect(value).toBeLessThan(0.5);
    expect(value).toBeCloseTo(0.5 * 0.45);
  });
});
