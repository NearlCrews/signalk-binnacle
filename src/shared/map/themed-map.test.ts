import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createThemedMap, type ThemedMapApi } from './themed-map';

// A minimal MapLibre Map mock covering the surface createThemedMap touches: event wiring, the
// canvas (for the touch long-press listeners), and the style and image calls the load handler
// makes. Instances are collected on the constructor so a test can reach the map it created.
vi.mock('maplibre-gl', () => {
  class FakeCanvas {
    listeners = new Map<string, Set<(e: unknown) => void>>();
    addEventListener(type: string, fn: (e: unknown) => void): void {
      const set = this.listeners.get(type) ?? new Set();
      set.add(fn);
      this.listeners.set(type, set);
    }
    dispatch(type: string, e: unknown): void {
      for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e);
    }
    getBoundingClientRect(): { left: number; top: number } {
      return { left: 0, top: 0 };
    }
  }
  class FakeMap {
    static instances: FakeMap[] = [];
    handlers = new Map<string, Set<(e?: unknown) => void>>();
    canvas = new FakeCanvas();
    options: Record<string, unknown>;
    // A stand-in for the real maplibregl-ctrl-attrib <details> element, so a test can assert
    // createThemedMap's collapse call actually reaches it, not just that the no-op path
    // (selector finds nothing) is safe.
    attribElement = { classList: { remove: vi.fn() } };
    constructor(opts: Record<string, unknown> = {}) {
      FakeMap.instances.push(this);
      this.options = opts;
    }
    on(event: string, fn: (e?: unknown) => void): void {
      const set = this.handlers.get(event) ?? new Set();
      set.add(fn);
      this.handlers.set(event, set);
    }
    once(event: string, fn: (e?: unknown) => void): void {
      const wrapped = (e?: unknown) => {
        this.off(event, wrapped);
        fn(e);
      };
      this.on(event, wrapped);
    }
    off(event: string, fn: (e?: unknown) => void): void {
      this.handlers.get(event)?.delete(fn);
    }
    setStyle(style: unknown): void {
      this.styles.push(style);
    }
    styles: unknown[] = [];
    fire(event: string, e?: unknown): void {
      for (const fn of [...(this.handlers.get(event) ?? [])]) fn(e);
    }
    getCanvas(): FakeCanvas {
      return this.canvas;
    }
    getContainer(): {
      querySelector: (selector: string) => { classList: { remove: (name: string) => void } } | null;
    } {
      return {
        querySelector: (selector: string) =>
          selector === '.maplibregl-ctrl-attrib' ? this.attribElement : null,
      };
    }
    getCenter(): { lng: number; lat: number } {
      return { lng: 0, lat: 0 };
    }
    getZoom(): number {
      return 2;
    }
    hasImage(): boolean {
      return false;
    }
    addImage(): void {}
    getLayer(): undefined {
      return undefined;
    }
    addLayer(): void {}
    getStyle(): { layers: never[] } {
      return { layers: [] };
    }
    getPaintProperty(): undefined {
      return undefined;
    }
    setPaintProperty(): void {}
    resize(): void {}
    remove(): void {}
    unproject([x, y]: [number, number]): { lng: number; lat: number } {
      return { lng: x, lat: y };
    }
  }
  return { default: { Map: FakeMap } };
});

interface FakeMapInstance {
  handlers: Map<string, Set<(e?: unknown) => void>>;
  canvas: {
    dispatch(type: string, e: unknown): void;
  };
  fire(event: string, e?: unknown): void;
  options: Record<string, unknown>;
  attribElement: { classList: { remove: ReturnType<typeof vi.fn> } };
}

async function lastMap(): Promise<FakeMapInstance> {
  const maplibregl = (await import('maplibre-gl')).default;
  const instances = (maplibregl.Map as unknown as { instances: FakeMapInstance[] }).instances;
  return instances[instances.length - 1];
}

const container = {} as HTMLElement;

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', vi.fn());
  vi.stubGlobal('document', {
    hidden: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('window', {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
  });
});

afterEach(async () => {
  const maplibregl = (await import('maplibre-gl')).default;
  (maplibregl.Map as unknown as { instances: unknown[] }).instances.length = 0;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createThemedMap attribution', () => {
  it('collapses the compact attribution control on init', async () => {
    createThemedMap({ container, onLoad: () => {} });
    const map = await lastMap();
    expect(map.attribElement.classList.remove).toHaveBeenCalledWith('maplibregl-compact-show');
  });

  it.each([
    'styledata',
    'sourcedata',
    'terrain',
  ])('collapses it again on %s, since MapLibre can auto-expand it whenever attribution content changes', async (event) => {
    createThemedMap({ container, onLoad: () => {} });
    const map = await lastMap();
    map.attribElement.classList.remove.mockClear();
    map.fire(event);
    expect(map.attribElement.classList.remove).toHaveBeenCalledWith('maplibregl-compact-show');
  });
});

describe('createThemedMap onLoad', () => {
  it('logs an onLoad rejection instead of dropping it silently', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    createThemedMap({
      container,
      onLoad: async () => {
        throw new Error('duplicate overlay id: chart');
      },
    });
    (await lastMap()).fire('load');
    // Let the rejection propagate through the catch microtasks.
    await Promise.resolve();
    await Promise.resolve();
    expect(errorSpy).toHaveBeenCalledWith('map onLoad failed', expect.any(Error));
  });
});

describe('createThemedMap style fallback', () => {
  it('swaps to the fallback style when the style JSON never arrives', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    createThemedMap({ container, onLoad: () => {} });
    const map = (await lastMap()) as FakeMapInstance & { styles: unknown[] };
    map.fire('error', { error: new Error('Failed to fetch') });
    expect(map.styles).toHaveLength(1);
    expect(map.styles[0]).toMatchObject({ name: 'binnacle-offline-fallback' });
    expect(infoSpy).toHaveBeenCalledOnce();
    // Later errors (tiles, glyphs) must not re-trigger the swap.
    map.fire('error', { error: new Error('tile failed') });
    expect(map.styles).toHaveLength(1);
  });

  it('never swaps once styledata has arrived', async () => {
    createThemedMap({ container, onLoad: () => {} });
    const map = (await lastMap()) as FakeMapInstance & { styles: unknown[] };
    map.fire('styledata');
    map.fire('error', { error: new Error('sprite failed') });
    expect(map.styles).toHaveLength(0);
  });
});

describe('createThemedMap runTick', () => {
  it('a second runTick replaces the first wiring instead of orphaning it', async () => {
    vi.useFakeTimers();
    let api: ThemedMapApi | undefined;
    createThemedMap({
      container,
      onLoad: (a) => {
        api = a;
      },
    });
    const map = await lastMap();
    map.fire('load');
    expect(api).toBeDefined();
    const overlay = { sync: vi.fn() };
    api?.runTick([overlay]);
    api?.runTick([overlay]);
    // Exactly one live 'render' listener; the first runTick's was torn down.
    expect(map.handlers.get('render')?.size ?? 0).toBe(1);
    expect(document.removeEventListener).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    );
    // One live interval: a single sync per period, not one per runTick call.
    const afterSetup = overlay.sync.mock.calls.length;
    vi.advanceTimersByTime(250);
    expect(overlay.sync.mock.calls.length).toBe(afterSetup + 1);
  });
});

describe('createThemedMap long-press', () => {
  it('synthesizes a contextmenu emit for a still touch past the timeout', async () => {
    vi.useFakeTimers();
    const onContextMenu = vi.fn();
    createThemedMap({ container, onContextMenu, onLoad: () => {} });
    const map = await lastMap();
    map.canvas.dispatch('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 20 });
    vi.advanceTimersByTime(500);
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu).toHaveBeenCalledWith({ lng: 10, lat: 20, x: 10, y: 20 });
  });

  it('a native contextmenu during the press cancels the timer so one press emits once', async () => {
    vi.useFakeTimers();
    const onContextMenu = vi.fn();
    createThemedMap({ container, onContextMenu, onLoad: () => {} });
    const map = await lastMap();
    map.canvas.dispatch('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 20 });
    // Android Chrome fires the native contextmenu mid-press; the synthesized timer must die.
    map.fire('contextmenu', { lngLat: { lng: 1, lat: 2 }, point: { x: 3, y: 4 } });
    vi.advanceTimersByTime(600);
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu).toHaveBeenCalledWith({ lng: 1, lat: 2, x: 3, y: 4 });
  });
});

describe('createThemedMap transformRequest', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { href: 'http://localhost/', origin: 'http://localhost' });
  });

  it('adds Authorization header for a same-origin companion path', async () => {
    createThemedMap({ container, getToken: () => 'test-token', onLoad: () => {} });
    const map = await lastMap();
    const tr = map.options.transformRequest as (url: string) => unknown;
    expect(tr('http://localhost/plugins/signalk-chart-locker/style/basemap')).toEqual({
      url: 'http://localhost/plugins/signalk-chart-locker/style/basemap',
      headers: { Authorization: 'Bearer test-token' },
    });
  });

  it('does not add Authorization for a cross-origin URL', async () => {
    createThemedMap({ container, getToken: () => 'test-token', onLoad: () => {} });
    const map = await lastMap();
    const tr = map.options.transformRequest as (url: string) => unknown;
    expect(tr('https://tiles.openfreemap.org/fonts/figtree/0-255.pbf')).toBeUndefined();
  });
});
