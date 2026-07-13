import type { Map as MapLibreMap } from 'maplibre-gl';
import { TerraDraw } from 'terra-draw';
import { describe, expect, it, vi } from 'vitest';
import type { RouteWaypoint } from '$entities/route';
import { createRouteEditor, drawFeatureToWaypoints, routeToStoreFeature } from './route-edit';

vi.mock('terra-draw-maplibre-gl-adapter', () => ({
  TerraDrawMapLibreGLAdapter: class {},
}));

vi.mock('terra-draw', () => {
  interface StoreFeature {
    id?: string | number;
    type: 'Feature';
    properties: Record<string, unknown>;
    geometry: { type: string; coordinates: number[][] | number[] };
  }
  class FakeTerraDraw {
    static instances: FakeTerraDraw[] = [];
    features: StoreFeature[] = [];
    #listeners: Array<(ids: Array<string | number>, type: string) => void> = [];
    #finishListeners: Array<() => void> = [];
    #nextId = 1;
    #clock = 1000;
    constructor() {
      FakeTerraDraw.instances.push(this);
    }
    on(event: string, cb: (ids: Array<string | number>, type: string) => void): void {
      if (event === 'change') this.#listeners.push(cb);
      else if (event === 'finish') this.#finishListeners.push(cb as () => void);
    }
    start(): void {}
    stop(): void {}
    setMode(mode: string): void {
      // Real Terra Draw throws on an unregistered mode name, so a typo surfaces in tests too.
      if (mode !== 'point' && mode !== 'linestring' && mode !== 'select') {
        throw new Error(`unknown mode: ${mode}`);
      }
    }
    updateModeOptions(): void {}
    getSnapshot(): StoreFeature[] {
      return [...this.features];
    }
    addFeatures(features: StoreFeature[]): Array<{ valid: boolean }> {
      for (const f of features) {
        this.features.push({
          ...f,
          id: this.#nextId++,
          properties: { ...f.properties, createdAt: this.#clock, updatedAt: this.#clock },
        });
        this.#clock += 1;
      }
      this.#emit();
      // Real Terra Draw returns one StoreValidation per feature; the seed path reads `.valid`.
      return features.map(() => ({ valid: true }));
    }
    removeFeatures(ids: Array<string | number>): void {
      this.features = this.features.filter((f) => f.id == null || !ids.includes(f.id));
      this.#emit();
    }
    // Test helpers, mirroring what a select-mode drag and a fresh linestring tap do to the store.
    mutateLine(coordinates: number[][]): void {
      const line = this.features[0];
      line.geometry.coordinates = coordinates;
      line.properties.updatedAt = this.#clock;
      this.#clock += 1;
      this.#emit();
    }
    addLine(coordinates: number[][]): void {
      this.addFeatures([
        {
          type: 'Feature',
          properties: { mode: 'linestring' },
          geometry: { type: 'LineString', coordinates },
        },
      ]);
    }
    // Terra Draw's cursor and closing points are Point features that carry the SAME mode tag as the
    // line; this models one so the geometry-type filter can be exercised.
    addCursorPoint(coordinates: number[]): void {
      this.features.push({
        type: 'Feature',
        id: this.#nextId++,
        properties: { mode: 'linestring', createdAt: this.#clock, updatedAt: this.#clock },
        geometry: { type: 'Point', coordinates },
      });
      this.#clock += 1;
      this.#emit();
    }
    finishLine(): void {
      for (const feature of this.features) {
        if (feature.geometry.type !== 'LineString') continue;
        const coordinates = feature.geometry.coordinates as number[][];
        const last = coordinates.at(-1);
        const previous = coordinates.at(-2);
        if (last && previous && last[0] === previous[0] && last[1] === previous[1]) {
          feature.geometry.coordinates = coordinates.slice(0, -1);
        }
      }
      for (const cb of [...this.#finishListeners]) cb();
    }
    #emit(): void {
      for (const cb of [...this.#listeners]) cb([], 'update');
    }
  }
  return {
    TerraDraw: FakeTerraDraw,
    TerraDrawLineStringMode: class {},
    TerraDrawPointMode: class {},
    TerraDrawSelectMode: class {},
  } as unknown as typeof import('terra-draw');
});

interface FakeDraw {
  features: Array<{
    id?: string | number;
    properties: Record<string, unknown>;
    geometry: { type: string; coordinates: number[][] | number[] };
  }>;
  mutateLine(coordinates: number[][]): void;
  addLine(coordinates: number[][]): void;
  addCursorPoint(coordinates: number[]): void;
  finishLine(): void;
}

function lastInstance(): FakeDraw {
  const instances = (TerraDraw as unknown as { instances: FakeDraw[] }).instances;
  return instances[instances.length - 1];
}

function startEditor(waypoints: RouteWaypoint[]): { draw: FakeDraw; emitted: RouteWaypoint[][] } {
  const emitted: RouteWaypoint[][] = [];
  const editor = createRouteEditor({
    map: {} as MapLibreMap,
    theme: 'day',
    onChange: (next) => emitted.push(next),
  });
  editor.start({ id: 'r', name: 'R', waypoints });
  return { draw: lastInstance(), emitted };
}

// Start with no route, which puts the editor in linestring drawing mode (drawing = true).
function startDrawing(): {
  draw: FakeDraw;
  editor: ReturnType<typeof createRouteEditor>;
  emitted: RouteWaypoint[][];
} {
  const emitted: RouteWaypoint[][] = [];
  const editor = createRouteEditor({
    map: {} as MapLibreMap,
    theme: 'day',
    onChange: (next) => emitted.push(next),
  });
  editor.start();
  return { draw: lastInstance(), editor, emitted };
}

describe('route-edit converters', () => {
  it('routeToStoreFeature emits a linestring Feature in [lon, lat] with mode linestring', () => {
    const f = routeToStoreFeature({
      id: 'r',
      name: 'R',
      waypoints: [
        { position: { latitude: 0, longitude: 0 } },
        { position: { latitude: 0, longitude: 1 } },
      ],
    });
    expect(f.properties?.mode).toBe('linestring');
    expect((f.geometry as GeoJSON.LineString).coordinates[1]).toEqual([1, 0]);
  });

  it('routeToStoreFeature rounds full-precision coordinates so the draw store accepts the feature', () => {
    // Terra Draw refuses a feature whose coordinates carry more than nine decimal places, which is
    // how a full-precision AI draft seeded into the store renders as nothing. The mapper rounds.
    // 1/3 and 1/7 give a position with a full double's worth of decimals without a precision-losing
    // literal (which the linter rejects), standing in for a raw AI-drafted coordinate.
    const f = routeToStoreFeature({
      id: 'r',
      name: 'R',
      waypoints: [
        { position: { latitude: 42 + 1 / 3, longitude: -83 - 1 / 7 } },
        { position: { latitude: 42 + 2 / 3, longitude: -83 - 2 / 7 } },
      ],
    });
    const coords = (f.geometry as GeoJSON.LineString).coordinates;
    const decimals = (n: number): number => {
      let scale = 1;
      let count = 0;
      while (Math.round(n * scale) / scale !== n) {
        scale *= 10;
        count += 1;
        if (count > 30) break;
      }
      return count;
    };
    for (const [lon, lat] of coords) {
      expect(decimals(lon)).toBeLessThanOrEqual(9);
      expect(decimals(lat)).toBeLessThanOrEqual(9);
    }
  });

  it('drawFeatureToWaypoints reads a linestring Feature back to waypoints', () => {
    const wps = drawFeatureToWaypoints({
      type: 'Feature',
      properties: { mode: 'linestring' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [2, 1],
        ],
      },
    });
    expect(wps).toEqual([
      { position: { latitude: 0, longitude: 0 } },
      { position: { latitude: 1, longitude: 2 } },
    ]);
  });
});

describe('createRouteEditor name reconciliation', () => {
  const named: RouteWaypoint[] = [
    { position: { latitude: 0, longitude: 0 }, name: 'Alpha' },
    { position: { latitude: 1, longitude: 1 }, name: 'Bravo' },
    { position: { latitude: 2, longitude: 2 }, name: 'Charlie' },
  ];

  it('keeps every name when nothing moved', () => {
    const { emitted } = startEditor(named);
    expect(emitted.at(-1)?.map((w) => w.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('dragging one middle waypoint keeps the other two names', () => {
    const { draw, emitted } = startEditor(named);
    draw.mutateLine([
      [0, 0],
      [1.5, 1.2],
      [2, 2],
    ]);
    const result = emitted.at(-1);
    expect(result?.map((w) => w.name)).toEqual(['Alpha', undefined, 'Charlie']);
    expect(result?.[1].position).toEqual({ latitude: 1.2, longitude: 1.5 });
  });

  it('inserting a midpoint keeps all names on the right points', () => {
    const { draw, emitted } = startEditor(named);
    draw.mutateLine([
      [0, 0],
      [0.5, 0.5],
      [1, 1],
      [2, 2],
    ]);
    expect(emitted.at(-1)?.map((w) => w.name)).toEqual(['Alpha', undefined, 'Bravo', 'Charlie']);
  });

  it('sequential edits stay sticky: names reconcile against the last emitted set', () => {
    const { draw, emitted } = startEditor(named);
    draw.mutateLine([
      [0, 0],
      [0.5, 0.5],
      [1, 1],
      [2, 2],
    ]);
    draw.mutateLine([
      [0, 0],
      [0.6, 0.4],
      [1, 1],
      [2, 2],
    ]);
    expect(emitted.at(-1)?.map((w) => w.name)).toEqual(['Alpha', undefined, 'Bravo', 'Charlie']);
  });

  it('a route visiting the same point twice consumes remembered names in order', () => {
    const revisits: RouteWaypoint[] = [
      { position: { latitude: 0, longitude: 0 }, name: 'Out' },
      { position: { latitude: 1, longitude: 1 }, name: 'Mark' },
      { position: { latitude: 0, longitude: 0 }, name: 'Home' },
    ];
    const { emitted } = startEditor(revisits);
    expect(emitted.at(-1)?.map((w) => w.name)).toEqual(['Out', 'Mark', 'Home']);
  });
});

describe('createRouteEditor working-line pruning', () => {
  it('keeps the most recently created linestring and removes the extras from the store', async () => {
    const { draw, emitted } = startEditor([
      { position: { latitude: 0, longitude: 0 } },
      { position: { latitude: 1, longitude: 1 } },
    ]);
    draw.addLine([
      [5, 5],
      [6, 6],
    ]);
    // read() returns the working line synchronously, but the extra is pruned in a microtask so the
    // removal never runs inside Terra Draw's own commit; flush it before asserting the store shrank.
    expect(emitted.at(-1)).toEqual([
      { position: { latitude: 5, longitude: 5 } },
      { position: { latitude: 6, longitude: 6 } },
    ]);
    // The store still holds both lines synchronously: the prune did not run inside the change handler
    // (doing so mid-commit is what crashed Terra Draw on the second waypoint).
    expect(draw.features).toHaveLength(2);
    await Promise.resolve();
    expect(draw.features).toHaveLength(1);
    expect(draw.features[0].geometry.coordinates).toEqual([
      [5, 5],
      [6, 6],
    ]);
  });

  it('the deferred removal change does not emit a duplicate waypoint set', async () => {
    const { draw, emitted } = startEditor([
      { position: { latitude: 0, longitude: 0 } },
      { position: { latitude: 1, longitude: 1 } },
    ]);
    const before = emitted.length;
    draw.addLine([
      [5, 5],
      [6, 6],
    ]);
    // One emit for the tap; the microtask prune's nested change is suppressed, so still one after.
    expect(emitted.length).toBe(before + 1);
    await Promise.resolve();
    expect(emitted.length).toBe(before + 1);
  });
});

describe('createRouteEditor drawing-mode reads', () => {
  it('drops the trailing cursor ghost so each tap counts as one placed waypoint', () => {
    const { draw, emitted } = startDrawing();
    // First tap: Terra Draw makes a two-coordinate line, the second being the cursor ghost.
    draw.addLine([
      [0, 0],
      [0, 0],
    ]);
    expect(emitted.at(-1)).toEqual([{ position: { latitude: 0, longitude: 0 } }]);
    // Second tap committed: [P1, P2, ghost]. The ghost is dropped, so two placed waypoints.
    draw.mutateLine([
      [0, 0],
      [1, 1],
      [1, 1],
    ]);
    expect(emitted.at(-1)).toEqual([
      { position: { latitude: 0, longitude: 0 } },
      { position: { latitude: 1, longitude: 1 } },
    ]);
  });

  it('ignores a cursor Point that carries the linestring mode tag', () => {
    const { draw, emitted } = startDrawing();
    draw.addLine([
      [0, 0],
      [2, 2],
    ]);
    // A Point feature tagged mode 'linestring' (Terra Draw's cursor point) is appended last. Without
    // the geometry-type filter, workingLine would pick it and read zero waypoints (the vanishing-route
    // bug); the working line must stay the LineString.
    draw.addCursorPoint([2, 2]);
    expect(emitted.at(-1)).toEqual([{ position: { latitude: 0, longitude: 0 } }]);
  });

  it('keeps every coordinate once the line is finished and the ghost is removed', () => {
    const { draw, emitted } = startDrawing();
    draw.addLine([
      [0, 0],
      [1, 1],
      [1, 1],
    ]);
    expect(emitted.at(-1)).toHaveLength(2);
    // Finishing removes the ghost and emits the final geometry without waiting for another change.
    draw.finishLine();
    expect(emitted.at(-1)).toEqual([
      { position: { latitude: 0, longitude: 0 } },
      { position: { latitude: 1, longitude: 1 } },
    ]);
  });

  it('does not prune queued stale lines after the editor stops', async () => {
    const { draw, editor } = startDrawing();
    draw.addLine([
      [0, 0],
      [1, 1],
    ]);
    draw.addLine([
      [2, 2],
      [3, 3],
    ]);
    editor.stop();
    await Promise.resolve();
    expect(draw.features.filter((feature) => feature.geometry.type === 'LineString')).toHaveLength(
      2,
    );
  });

  it('seeds the first waypoint by dispatching an opening tap at the projected pixel', async () => {
    // "Start a route here" replays a real opening tap; stub PointerEvent (absent in the node test
    // env) and a minimal map exposing only the canvas and projection placeFirstPoint uses.
    class StubPointerEvent {
      type: string;
      clientX: number;
      clientY: number;
      constructor(type: string, init: { clientX: number; clientY: number }) {
        this.type = type;
        this.clientX = init.clientX;
        this.clientY = init.clientY;
      }
    }
    vi.stubGlobal('PointerEvent', StubPointerEvent);
    try {
      const dispatched: Array<{ type: string; x: number; y: number }> = [];
      const canvas = {
        getBoundingClientRect: () => ({ left: 100, top: 50 }),
        dispatchEvent: (e: { type: string; clientX: number; clientY: number }) => {
          dispatched.push({ type: e.type, x: e.clientX, y: e.clientY });
          return true;
        },
      };
      const map = {
        getCanvas: () => canvas,
        project: () => ({ x: 12, y: 8 }),
      } as unknown as MapLibreMap;
      const editor = createRouteEditor({ map, theme: 'day', onChange: () => {} });
      editor.start(undefined, { latitude: 1, longitude: 2 });
      await Promise.resolve(); // placeFirstPoint defers via queueMicrotask
      // rect.left + project.x, rect.top + project.y, as a down then up at the same pixel.
      expect(dispatched).toEqual([
        { type: 'pointerdown', x: 112, y: 58 },
        { type: 'pointerup', x: 112, y: 58 },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not dispatch a queued opening tap after the editor stops', async () => {
    vi.stubGlobal('PointerEvent', class {});
    try {
      const dispatchEvent = vi.fn();
      const map = {
        getCanvas: () => ({
          getBoundingClientRect: () => ({ left: 0, top: 0 }),
          dispatchEvent,
        }),
        project: () => ({ x: 0, y: 0 }),
      } as unknown as MapLibreMap;
      const editor = createRouteEditor({ map, theme: 'day', onChange: () => {} });
      editor.start(undefined, { latitude: 1, longitude: 2 });
      editor.stop();
      await Promise.resolve();
      expect(dispatchEvent).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
