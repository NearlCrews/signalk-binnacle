import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createThemedMap, type ThemedMapApi } from './themed-map';

vi.mock('./maplibre-worker', () => ({}));

// A minimal MapLibre Map mock covering the surface createThemedMap touches: event wiring, the
// canvas (for the touch long-press listeners), and the style and image calls the load handler
// makes. Instances are collected on the constructor so a test can reach the map it created.
vi.mock('maplibre-gl', () => {
  class FakeNavigationControl {
    constructor(readonly options: Record<string, unknown>) {}
  }
  class FakeScaleControl {
    constructor(readonly options: Record<string, unknown>) {}
  }
  class FakeCanvas {
    clientWidth = 800;
    clientHeight = 600;
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
    controls: { control: unknown; position?: string }[] = [];
    painter: Record<string, never> | undefined = {};
    keyboard: { disableRotation: ReturnType<typeof vi.fn> } | undefined = {
      disableRotation: vi.fn(),
    };
    touchZoomRotate: { disableRotation: ReturnType<typeof vi.fn> } | undefined = {
      disableRotation: vi.fn(),
    };
    // A stand-in for the real maplibregl-ctrl-attrib <details> element, so a test can assert
    // createThemedMap's collapse call actually reaches it, not just that the no-op path
    // (selector finds nothing) is safe.
    attribElement = { classList: { remove: vi.fn() } };
    // Lets a test exercise an ordinary constructor exception independently of the partial-map path.
    static throwOnConstruct = false;
    // MapLibre 6 reports GPU initialization through its error event, then returns a partial Map
    // before assigning the renderer or public interaction handlers.
    static returnWithoutRenderer = false;
    constructor(opts: Record<string, unknown> = {}) {
      if (FakeMap.throwOnConstruct) throw new Error('WebGL2 unavailable');
      FakeMap.instances.push(this);
      this.options = opts;
      if (FakeMap.returnWithoutRenderer) {
        this.painter = undefined;
        this.keyboard = undefined;
        this.touchZoomRotate = undefined;
      }
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
    addedImages: string[] = [];
    addImage(id: string): void {
      this.addedImages.push(id);
    }
    missingImageResolver: ((id: string) => void | Promise<void>) | null = null;
    setMissingStyleImageResolver(resolver: ((id: string) => void | Promise<void>) | null): void {
      this.missingImageResolver = resolver;
    }
    getLayer(): undefined {
      return undefined;
    }
    addLayer(): void {}
    addControl(control: unknown, position?: string): void {
      this.controls.push({ control, position });
    }
    getStyle(): { layers: never[] } {
      return { layers: [] };
    }
    getPaintProperty(): undefined {
      return undefined;
    }
    setPaintProperty(): void {}
    resize(): void {}
    remove = vi.fn();
    unproject([x, y]: [number, number]): { lng: number; lat: number } {
      return { lng: x, lat: y };
    }
  }
  return {
    Map: FakeMap,
    NavigationControl: FakeNavigationControl,
    ScaleControl: FakeScaleControl,
  };
});

interface FakeMapInstance {
  handlers: Map<string, Set<(e?: unknown) => void>>;
  canvas: {
    dispatch(type: string, e: unknown): void;
  };
  fire(event: string, e?: unknown): void;
  options: Record<string, unknown>;
  controls: { control: { options: Record<string, unknown> }; position?: string }[];
  painter?: Record<string, never>;
  keyboard?: { disableRotation: ReturnType<typeof vi.fn> };
  touchZoomRotate?: { disableRotation: ReturnType<typeof vi.fn> };
  attribElement: { classList: { remove: ReturnType<typeof vi.fn> } };
  remove: ReturnType<typeof vi.fn>;
  addedImages: string[];
  missingImageResolver: ((id: string) => void | Promise<void>) | null;
  styles: unknown[];
}

async function lastMap(): Promise<FakeMapInstance> {
  const maplibregl = await import('maplibre-gl');
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
  const maplibregl = await import('maplibre-gl');
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

  it.each(['styledata', 'sourcedata', 'terrain'])(
    'collapses it again on %s, since MapLibre can auto-expand it whenever attribution content changes',
    async (event) => {
      createThemedMap({ container, onLoad: () => {} });
      const map = await lastMap();
      map.attribElement.classList.remove.mockClear();
      map.fire(event);
      expect(map.attribElement.classList.remove).toHaveBeenCalledWith('maplibregl-compact-show');
    },
  );
});

describe('createThemedMap onLoad', () => {
  it('exposes the initialized map before the style loads', async () => {
    const onLoad = vi.fn();
    const handle = createThemedMap({ container, onLoad });
    const map = await lastMap();

    expect(handle.map).toBe(map);
    expect(onLoad).not.toHaveBeenCalled();
  });

  it('logs a synchronous onLoad failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    createThemedMap({
      container,
      onLoad: () => {
        throw new Error('broken widget initialization');
      },
    });

    (await lastMap()).fire('load');

    expect(errorSpy).toHaveBeenCalledWith('map onLoad failed', expect.any(Error));
  });

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

  it('does not report an initialization rejection caused by teardown', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let rejectLoad = (_error: Error) => {};
    const handle = createThemedMap({
      container,
      onLoad: () =>
        new Promise<void>((_resolve, reject) => {
          rejectLoad = reject;
        }),
    });
    const map = await lastMap();
    map.fire('load');

    handle.destroy();
    rejectLoad(new Error('layer manager is disposed'));
    await Promise.resolve();
    await Promise.resolve();

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('does not initialize a map whose owner was destroyed before load', async () => {
    const onLoad = vi.fn();
    const handle = createThemedMap({ container, onLoad });
    const map = await lastMap();

    handle.destroy();
    handle.destroy();
    map.fire('load');

    expect(onLoad).not.toHaveBeenCalled();
    expect(map.remove).toHaveBeenCalledOnce();
  });

  it('passes an explicit pixel ratio to MapLibre', async () => {
    createThemedMap({ container, pixelRatio: 1.5, onLoad: () => {} });

    expect((await lastMap()).options.pixelRatio).toBe(1.5);
  });

  it('preserves MapLibre 5 vector overscaling behavior', async () => {
    createThemedMap({ container, onLoad: () => {} });

    expect((await lastMap()).options).toHaveProperty('zoomLevelsToOverscale', undefined);
  });
});

describe('createThemedMap point taps', () => {
  it('forwards a short touch tap to the shared point callback', async () => {
    const onClick = vi.fn();
    createThemedMap({ container, onClick, onLoad: () => {} });
    const map = await lastMap();

    map.fire('touchstart', {
      lngLat: { lng: -82.7, lat: 27.7 },
      point: { x: 10, y: 20 },
      points: [{ x: 10, y: 20 }],
      type: 'touchstart',
    });
    map.fire('touchend', {
      lngLat: { lng: -82.7, lat: 27.7 },
      point: { x: 10, y: 20 },
      points: [{ x: 10, y: 20 }],
      type: 'touchend',
    });

    expect(onClick).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledWith({ lng: -82.7, lat: 27.7 });
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

  it('isolates a failing overlay so later navigation overlays still synchronize', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let api: ThemedMapApi | undefined;
    createThemedMap({
      container,
      onLoad: (value) => {
        api = value;
      },
    });
    const map = await lastMap();
    map.fire('load');
    const failing = {
      id: 'weather',
      sync: vi.fn(() => {
        // Overlay sync is intentionally a synchronous contract.
        throw new Error('bad source');
      }),
    };
    const navigation = { id: 'own-vessel', sync: vi.fn() };

    api?.runTick([failing, navigation]);
    map.fire('render');

    expect(navigation.sync).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Overlay "weather" failed to synchronize.',
      expect.any(Error),
    );
  });

  it('reports a failed overlay and its later recovery', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let api: ThemedMapApi | undefined;
    createThemedMap({
      container,
      onLoad: (value) => {
        api = value;
      },
    });
    const map = await lastMap();
    map.fire('load');
    let failing = true;
    const overlay = {
      id: 'own-vessel',
      sync: vi.fn(() => {
        if (failing) throw new Error('bad source');
      }),
    };
    const onStatus = vi.fn();

    api?.runTick([overlay], onStatus);
    expect(onStatus).toHaveBeenCalledWith('own-vessel', expect.any(Error));
    failing = false;
    map.fire('render');
    expect(onStatus).toHaveBeenLastCalledWith('own-vessel', undefined);
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

  it('opens chart actions at the center for the keyboard context-menu shortcut', async () => {
    const onContextMenu = vi.fn();
    createThemedMap({ container, onContextMenu, onLoad: () => {} });
    const map = await lastMap();
    const preventDefault = vi.fn();
    map.canvas.dispatch('keydown', { key: 'F10', shiftKey: true, preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onContextMenu).toHaveBeenCalledWith({ lng: 400, lat: 300, x: 400, y: 300 });
  });
});

describe('createThemedMap navigation controls', () => {
  it('locks rotation and installs zoom and nautical scale controls', async () => {
    createThemedMap({ container, onLoad: () => {} });
    const map = await lastMap();
    expect(map.options.dragRotate).toBe(false);
    expect(map.touchZoomRotate?.disableRotation).toHaveBeenCalledOnce();
    expect(map.keyboard?.disableRotation).toHaveBeenCalledOnce();
    expect(map.controls).toEqual([
      {
        control: { options: { showCompass: false, showZoom: true, visualizePitch: false } },
        position: 'top-right',
      },
      {
        control: { options: { maxWidth: 120, unit: 'nautical' } },
        position: 'bottom-right',
      },
    ]);
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

describe('createThemedMap when the map cannot construct', () => {
  it('shows the notice before constructing MapLibre when the WebGL2 probe fails', async () => {
    const maplibregl = await import('maplibre-gl');
    const instances = (maplibregl.Map as unknown as { instances: FakeMapInstance[] }).instances;
    const probe = { width: 300, height: 150, getContext: vi.fn(() => null) };
    const notice = { className: '', textContent: '', remove: vi.fn() };
    vi.stubGlobal('document', {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      createElement: vi.fn((tag: string) => (tag === 'canvas' ? probe : notice)),
    });
    const failingContainer = {
      classList: { remove: vi.fn() },
      replaceChildren: vi.fn(),
    } as unknown as HTMLElement;

    const handle = createThemedMap({ container: failingContainer, onLoad: () => {} });
    const secondHandle = createThemedMap({ container: failingContainer, onLoad: () => {} });

    expect(probe.getContext).toHaveBeenCalledWith('webgl2', {
      alpha: true,
      antialias: false,
      depth: true,
      desynchronized: false,
      failIfMajorPerformanceCaveat: false,
      powerPreference: 'high-performance',
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      stencil: true,
    });
    expect(probe.width).toBe(0);
    expect(probe.height).toBe(0);
    expect(instances).toHaveLength(0);
    expect(failingContainer.replaceChildren).toHaveBeenCalledWith(notice);
    expect(probe.getContext).toHaveBeenCalledOnce();

    handle.destroy();
    handle.destroy();
    secondHandle.destroy();
    expect(notice.remove).toHaveBeenCalledTimes(2);
  });

  it('releases and caches a successful WebGL2 probe before constructing MapLibre', async () => {
    const loseContext = vi.fn();
    const getExtension = vi.fn(() => ({ loseContext }));
    const isContextLost = vi.fn(() => false);
    const probe = {
      width: 300,
      height: 150,
      getContext: vi.fn(() => ({ getExtension, isContextLost })),
    };
    vi.stubGlobal('document', {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      createElement: vi.fn(() => probe),
    });

    const handle = createThemedMap({ container, onLoad: () => {} });
    const secondHandle = createThemedMap({ container, onLoad: () => {} });
    const map = await lastMap();

    expect(getExtension).toHaveBeenCalledWith('WEBGL_lose_context');
    expect(loseContext).toHaveBeenCalledOnce();
    expect(isContextLost).not.toHaveBeenCalled();
    expect(probe.getContext).toHaveBeenCalledOnce();
    expect(probe.width).toBe(0);
    expect(probe.height).toBe(0);
    expect(map.options.canvasContextAttributes).toEqual(
      expect.objectContaining({ powerPreference: 'high-performance', stencil: true }),
    );

    handle.destroy();
    secondHandle.destroy();
  });

  it('constructs MapLibre when the optional probe cleanup extension is unavailable', async () => {
    const maplibregl = await import('maplibre-gl');
    const instances = (maplibregl.Map as unknown as { instances: FakeMapInstance[] }).instances;
    const getExtension = vi.fn(() => null);
    const isContextLost = vi.fn(() => false);
    const probe = {
      width: 300,
      height: 150,
      getContext: vi.fn(() => ({
        getExtension,
        isContextLost,
      })),
    };
    vi.stubGlobal('document', {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      createElement: vi.fn(() => probe),
    });
    const usableContainer = {
      classList: { remove: vi.fn() },
      replaceChildren: vi.fn(),
    } as unknown as HTMLElement;

    const handle = createThemedMap({ container: usableContainer, onLoad: () => {} });

    expect(instances).toHaveLength(1);
    expect(getExtension).toHaveBeenCalledWith('WEBGL_lose_context');
    expect(isContextLost).not.toHaveBeenCalled();
    expect(probe.width).toBe(0);
    expect(probe.height).toBe(0);
    expect(usableContainer.replaceChildren).not.toHaveBeenCalled();
    handle.destroy();
  });

  it('constructs MapLibre when best-effort probe cleanup throws', async () => {
    const maplibregl = await import('maplibre-gl');
    const instances = (maplibregl.Map as unknown as { instances: FakeMapInstance[] }).instances;
    const loseContext = vi.fn(() => {
      throw new Error('cleanup unavailable');
    });
    const probe = {
      width: 300,
      height: 150,
      getContext: vi.fn(() => ({
        getExtension: vi.fn(() => ({ loseContext })),
      })),
    };
    vi.stubGlobal('document', {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      createElement: vi.fn(() => probe),
    });
    const usableContainer = {
      classList: { remove: vi.fn() },
      replaceChildren: vi.fn(),
    } as unknown as HTMLElement;

    const handle = createThemedMap({ container: usableContainer, onLoad: () => {} });

    expect(instances).toHaveLength(1);
    expect(loseContext).toHaveBeenCalledOnce();
    expect(probe.width).toBe(0);
    expect(probe.height).toBe(0);
    expect(usableContainer.replaceChildren).not.toHaveBeenCalled();
    handle.destroy();
  });

  it('shows the cannot-start notice and clears it on destroy', async () => {
    const maplibregl = await import('maplibre-gl');
    const MapClass = maplibregl.Map as unknown as { throwOnConstruct: boolean };
    MapClass.throwOnConstruct = true;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const notice = { className: '', textContent: '', remove: vi.fn() };
    vi.stubGlobal('document', {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      createElement: vi.fn(() => notice),
    });
    const failingContainer = {
      classList: { remove: vi.fn() },
      replaceChildren: vi.fn(),
    } as unknown as HTMLElement;
    try {
      const handle = createThemedMap({ container: failingContainer, onLoad: () => {} });
      expect(notice.className).toContain('chart-start-error');
      expect(notice.textContent).toContain('WebGL2');
      expect(failingContainer.replaceChildren).toHaveBeenCalledWith(notice);
      expect(consoleError).toHaveBeenCalled();
      handle.destroy();
      handle.destroy();
      expect(notice.remove).toHaveBeenCalled();
    } finally {
      MapClass.throwOnConstruct = false;
    }
  });

  it('shows the cannot-start notice when MapLibre returns without a renderer', async () => {
    const maplibregl = await import('maplibre-gl');
    const MapClass = maplibregl.Map as unknown as { returnWithoutRenderer: boolean };
    MapClass.returnWithoutRenderer = true;
    const loseContext = vi.fn();
    const isContextLost = vi.fn(() => true);
    const probe = {
      width: 300,
      height: 150,
      getContext: vi.fn(() => ({
        getExtension: vi.fn(() => ({ loseContext })),
        isContextLost,
      })),
    };
    const notice = { className: '', textContent: '', remove: vi.fn() };
    vi.stubGlobal('document', {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      createElement: vi.fn((tag: string) => (tag === 'canvas' ? probe : notice)),
    });
    const failingContainer = {
      classList: { remove: vi.fn() },
      replaceChildren: vi.fn(),
    } as unknown as HTMLElement;
    const onLoad = vi.fn();

    try {
      const handle = createThemedMap({
        container: failingContainer,
        cannotStartNotice: 'Weather cannot start without WebGL2.',
        onLoad,
      });
      const partialMap = await lastMap();
      const secondHandle = createThemedMap({
        container: failingContainer,
        cannotStartNotice: 'Weather cannot start without WebGL2.',
        onLoad,
      });

      expect(partialMap.painter).toBeUndefined();
      expect(partialMap.keyboard).toBeUndefined();
      expect(partialMap.touchZoomRotate).toBeUndefined();
      expect(loseContext).toHaveBeenCalledOnce();
      expect(notice.className).toContain('chart-start-error');
      expect(notice.textContent).toBe('Weather cannot start without WebGL2.');
      expect(failingContainer.classList.remove).toHaveBeenCalledWith('maplibregl-map');
      expect(failingContainer.replaceChildren).toHaveBeenCalledWith(notice);
      expect(onLoad).not.toHaveBeenCalled();
      expect(
        (maplibregl.Map as unknown as { instances: FakeMapInstance[] }).instances,
      ).toHaveLength(1);
      expect(probe.getContext).toHaveBeenCalledOnce();

      handle.destroy();
      handle.destroy();
      secondHandle.destroy();
      expect(notice.remove).toHaveBeenCalledTimes(2);
    } finally {
      MapClass.returnWithoutRenderer = false;
    }
  });
});

describe('createThemedMap missing style images', () => {
  it('supplies the transparent placeholder through the resolver', async () => {
    createThemedMap({ container, onLoad: () => {} });
    const map = await lastMap();
    expect(map.missingImageResolver).toBeTruthy();
    await map.missingImageResolver?.('office');
    expect(map.addedImages).toContain('office');
  });
});

describe('createThemedMap style watchdog', () => {
  it('falls back to the offline base when the style neither arrives nor errors', async () => {
    vi.useFakeTimers();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    createThemedMap({ container, onLoad: () => {} });
    const map = await lastMap();
    expect(map.styles).toHaveLength(0);
    vi.advanceTimersByTime(8_000);
    expect(map.styles).toHaveLength(1);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('did not arrive'));
  });

  it('gives the direct base a full timeout after a late companion failure', async () => {
    vi.useFakeTimers();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    createThemedMap({
      container,
      companionBase: 'http://localhost/plugins/signalk-chart-locker',
      onLoad: () => {},
    });
    const map = await lastMap();

    vi.advanceTimersByTime(7_900);
    map.fire('error', { error: new Error('companion style failed') });
    expect(map.styles).toHaveLength(1);
    expect(map.styles[0]).toEqual(expect.stringContaining('openfreemap'));

    // Cross the original request's deadline. The new direct request must still be live.
    vi.advanceTimersByTime(200);
    expect(map.styles).toHaveLength(1);
    expect(info).not.toHaveBeenCalledWith(expect.stringContaining('did not arrive'));

    map.fire('styledata');
    vi.advanceTimersByTime(8_000);
    expect(map.styles).toHaveLength(1);
  });

  it('tries the direct base after a silent companion stall before falling back offline', async () => {
    vi.useFakeTimers();
    createThemedMap({
      container,
      companionBase: 'http://localhost/plugins/signalk-chart-locker',
      onLoad: () => {},
    });
    const map = await lastMap();

    vi.advanceTimersByTime(8_000);
    expect(map.styles).toHaveLength(1);
    expect(map.styles[0]).toEqual(expect.stringContaining('openfreemap'));

    vi.advanceTimersByTime(7_999);
    expect(map.styles).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(map.styles).toHaveLength(2);
    expect(map.styles[1]).toMatchObject({ name: 'binnacle-offline-fallback' });
  });
});
