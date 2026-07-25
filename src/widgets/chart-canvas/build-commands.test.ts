import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RouteEditor } from '$features/route-edit';
import { buildMapCommands } from './build-commands';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function setup() {
  let zoom = 10;
  let generation = 0;
  let working = false;
  let position: { latitude: number; longitude: number } | undefined = {
    latitude: 44.1,
    longitude: -86.2,
  };
  let positionStale = false;
  const map = {
    getZoom: vi.fn(() => zoom),
    flyTo: vi.fn(),
    setCenter: vi.fn(),
    fitBounds: vi.fn(),
    getBounds: vi.fn(() => ({
      getWest: () => -87,
      getSouth: () => 43,
      getEast: () => -85,
      getNorth: () => 45,
    })),
  };
  const manager = { applySnapshot: vi.fn() };
  const view = { refresh: vi.fn() };
  const notesOverlay = { highlight: vi.fn() };
  const workingRouteOverlay = { raise: vi.fn() };
  const editor = { start: vi.fn(), stop: vi.fn() };
  let loadRouteEditor = vi.fn<() => Promise<RouteEditor | undefined>>(
    async () => editor as unknown as RouteEditor,
  );
  const ctx = { map, beforeIdFor: vi.fn() };
  const vessel = {
    get position() {
      return position;
    },
    get positionStale() {
      return positionStale;
    },
  };
  const routeStore = {
    get working() {
      return working;
    },
  };
  const commands = () =>
    buildMapCommands({
      map,
      ctx,
      view,
      manager,
      vessel,
      routeStore,
      notesOverlay,
      loadRouteEditor,
      getWorkingRouteOverlay: () => workingRouteOverlay,
      getRouteEditor: () => editor as unknown as RouteEditor,
      nextEditGeneration: () => ++generation,
      cancelEditGeneration: () => {
        generation += 1;
      },
      currentEditGeneration: () => generation,
    } as never);
  return {
    commands,
    ctx,
    editor,
    loadRouteEditor: () => loadRouteEditor,
    manager,
    map,
    notesOverlay,
    setLoadRouteEditor(next: typeof loadRouteEditor) {
      loadRouteEditor = next;
    },
    setPosition(next: typeof position, stale = false) {
      position = next;
      positionStale = stale;
    },
    setWorking(next: boolean) {
      working = next;
    },
    setZoom(next: number) {
      zoom = next;
    },
    view,
    workingRouteOverlay,
  };
}

function setReducedMotion(matches: boolean): void {
  vi.stubGlobal('window', {
    matchMedia: vi.fn(() => ({ matches })),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildMapCommands', () => {
  it('centers only on a fresh vessel fix and raises a low zoom', () => {
    const test = setup();
    const commands = test.commands();

    test.setPosition(undefined);
    commands.centerOnVessel();
    test.setPosition({ latitude: 44.1, longitude: -86.2 }, true);
    commands.centerOnVessel();
    expect(test.map.flyTo).not.toHaveBeenCalled();

    test.setPosition({ latitude: 44.1, longitude: -86.2 });
    commands.centerOnVessel();
    expect(test.map.flyTo).toHaveBeenCalledWith({ center: [-86.2, 44.1], zoom: 14 });
  });

  it('preserves useful zooms and disables camera animation for reduced motion', () => {
    setReducedMotion(true);
    const test = setup();
    test.setZoom(13);
    const commands = test.commands();

    commands.centerOnVessel();
    commands.flyTo(42, -83);

    expect(test.map.flyTo).toHaveBeenNthCalledWith(1, {
      center: [-86.2, 44.1],
      zoom: 13,
      duration: 0,
    });
    expect(test.map.flyTo).toHaveBeenNthCalledWith(2, {
      center: [-83, 42],
      zoom: 13,
      duration: 0,
    });
  });

  it('normalizes valid bounds, rejects malformed bounds, and reports the viewport', () => {
    const test = setup();
    const commands = test.commands();

    commands.fitBounds([10, 20, Number.NaN, 30]);
    commands.fitBounds([170, -10, -170, 10]);

    expect(test.map.fitBounds).toHaveBeenCalledOnce();
    expect(test.map.fitBounds).toHaveBeenCalledWith(
      [
        [170, -10],
        [190, 10],
      ],
      { padding: 40, maxZoom: 16, duration: 800 },
    );
    expect(commands.getBounds()).toEqual([-87, 43, -85, 45]);
  });

  it('routes recentering and POI highlighting without moving unrelated state', () => {
    const test = setup();
    const commands = test.commands();
    const point = { latitude: 41, longitude: -82 };

    commands.recenterOnVessel(point.latitude, point.longitude);
    commands.highlightPoi(point);
    commands.highlightPoi(undefined);

    expect(test.map.setCenter).toHaveBeenCalledWith([-82, 41]);
    expect(test.notesOverlay.highlight).toHaveBeenNthCalledWith(1, test.ctx, point);
    expect(test.notesOverlay.highlight).toHaveBeenNthCalledWith(2, test.ctx, undefined);
  });

  it('drops a stale lazy route editor after editing is canceled', async () => {
    const pending = deferred<RouteEditor | undefined>();
    const test = setup();
    test.setLoadRouteEditor(vi.fn(() => pending.promise));
    const commands = test.commands();

    commands.startRouteEdit(undefined, { latitude: 44, longitude: -86 });
    commands.stopRouteEdit();
    pending.resolve(test.editor as unknown as RouteEditor);
    await pending.promise;
    await Promise.resolve();

    expect(test.editor.start).not.toHaveBeenCalled();
    expect(test.editor.stop).toHaveBeenCalledOnce();
    expect(test.workingRouteOverlay.raise).not.toHaveBeenCalled();
  });

  it('starts the current route editor and keeps the working overlay above it', async () => {
    const test = setup();
    const commands = test.commands();
    const route = { id: 'route-1', name: 'Harbor', points: [] };
    const initialPoint = { latitude: 44, longitude: -86 };

    commands.startRouteEdit(route as never, initialPoint);
    await vi.waitFor(() => expect(test.editor.start).toHaveBeenCalledOnce());

    expect(test.editor.start).toHaveBeenCalledWith(route, initialPoint);
    expect(test.workingRouteOverlay.raise).toHaveBeenCalledWith(test.ctx);
  });

  it('applies a layer snapshot, refreshes the view, and re-raises only an active route', () => {
    const test = setup();
    const commands = test.commands();
    const settings = { vessel: { visible: true, opacity: 1 } };
    const order = ['vessel'];

    commands.applyLayers(settings, order);
    expect(test.workingRouteOverlay.raise).not.toHaveBeenCalled();

    test.setWorking(true);
    commands.applyLayers(settings, order);
    expect(test.manager.applySnapshot).toHaveBeenNthCalledWith(1, settings, order);
    expect(test.manager.applySnapshot).toHaveBeenNthCalledWith(2, settings, order);
    expect(test.view.refresh).toHaveBeenCalledTimes(2);
    expect(test.workingRouteOverlay.raise).toHaveBeenCalledOnce();
    expect(test.workingRouteOverlay.raise).toHaveBeenCalledWith(test.ctx);
  });
});
