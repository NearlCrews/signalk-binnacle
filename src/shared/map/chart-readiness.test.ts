import { describe, expect, it, vi } from 'vitest';
import { createFakeMap } from '$shared/testing';
import { createChartReadinessTracker } from './chart-readiness';

function setup() {
  const map = createFakeMap();
  map.addSource('chart', { type: 'raster' });
  const tiles = new Map<string, { state: string; texture?: object; buckets?: object }>();
  const manager = {
    getIds: () => [...tiles.keys()],
    getTileByID: (id: string) => tiles.get(id),
    getRenderableIds: () =>
      [...tiles].filter(([, tile]) => tile.state === 'loaded').map(([id]) => id),
  };
  Object.assign(map, { style: { tileManagers: { chart: manager } } });
  const changed = vi.fn();
  const tracker = createChartReadinessTracker(map as never, changed);
  return { map, tiles, changed, tracker };
}

describe('chart readiness', () => {
  it('requires real drawable tiles, not metadata or empty vector tiles', () => {
    const { map, tiles, tracker } = setup();
    expect(tracker.getState(['chart'])).toBe('loading');
    map.emit('sourcedata', { sourceId: 'chart', sourceDataType: 'metadata', isSourceLoaded: true });
    expect(tracker.getState(['chart'])).toBe('loading');
    tiles.set('empty', { state: 'loaded', buckets: {} });
    map.emit('sourcedata', { sourceId: 'chart' });
    expect(tracker.getState(['chart'])).toBe('empty');
    tiles.set('empty', { state: 'loaded', buckets: { water: {} } });
    map.emit('render', {});
    expect(tracker.getState(['chart'])).toBe('ready');
    tracker.destroy();
    expect(map.handlerCount('sourcedata')).toBe(0);
    expect(map.handlerCount('error')).toBe(0);
    expect(map.handlerCount('render')).toBe(0);
  });

  it('re-evaluates when panning from drawn tiles to empty or cached tiles', () => {
    const { map, tiles, tracker, changed } = setup();
    tiles.set('first', { state: 'loaded', texture: {} });
    expect(tracker.getState(['chart'])).toBe('ready');
    tiles.clear();
    tiles.set('new', { state: 'loaded', buckets: {} });
    map.emit('render', {});
    expect(tracker.getState(['chart'])).toBe('empty');
    expect(changed).toHaveBeenCalledOnce();
    tiles.clear();
    tiles.set('cached', { state: 'loaded', texture: {} });
    map.emit('idle', {});
    expect(tracker.getState(['chart'])).toBe('ready');
    expect(changed).toHaveBeenCalledTimes(2);
    tracker.destroy();
  });

  it('retains visible failures but drops failed tiles once they leave the current view', () => {
    const { map, tiles, tracker } = setup();
    tiles.set('bad', { state: 'errored' });
    tiles.set('good', { state: 'loaded', texture: {} });
    expect(tracker.getState(['chart'])).toBe('error');
    map.emit('sourcedata', { sourceId: 'chart', sourceDataType: 'metadata' });
    expect(tracker.getState(['chart'])).toBe('error');
    tiles.delete('bad');
    map.emit('render', {});
    expect(tracker.getState(['chart'])).toBe('ready');
    tracker.destroy();
  });

  it('keeps metadata failures until metadata recovery or source replacement', () => {
    const { map, tiles, tracker } = setup();
    tracker.getState(['chart']);
    map.emit('error', { sourceId: 'chart' });
    expect(tracker.getState(['chart'])).toBe('error');
    map.removeSource('chart');
    map.addSource('chart', { type: 'raster' });
    expect(tracker.getState(['chart'])).toBe('loading');
    map.emit('error', { sourceId: 'chart' });
    tiles.set('good', { state: 'loaded', texture: {} });
    map.emit('sourcedata', { sourceId: 'chart', sourceDataType: 'metadata' });
    expect(tracker.getState(['chart'])).toBe('ready');
    tracker.destroy();
  });
});
