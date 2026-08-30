import * as maplibregl from 'maplibre-gl';
import type { MapView } from '$shared/geo';
import type { Theme } from '$shared/ui';
import { baseStyleUrl, fallbackBaseStyle } from './base-style';
import {
  applyBaseIconVisibility,
  applyBaseRasterVisibility,
  applyBaseTheme,
  captureBaseTheme,
  restoreBaseTheme,
  themableBaseLayers,
} from './base-theme';
import { LayerManager, type LayerManagerOptions } from './layer-manager';
import { installContextMenu } from './long-press';
import { createMapTapRecognizer } from './map-tap';
import { type MapPaintVariant, mapThemePaint } from './map-theme';
import { createOverlayTick, type OverlaySyncStatus, type Syncable } from './overlay-tick';
import { beforeIdFor, installSentinels } from './sentinels';
import type { OverlayContext } from './types';
import './maplibre-worker';

// Handed to the widget once the style has loaded, the sentinels are installed, and the LayerManager
// is built. The widget registers its overlays (guarding async steps with isDestroyed), wires any
// widget-specific commands, and starts the tick.
export interface ThemedMapApi {
  map: maplibregl.Map;
  ctx: OverlayContext;
  manager: LayerManager;
  // Recolor the base map and every overlay for a theme: standard day restores the source style's
  // real colors, dusk, night-red, and the day-sun variant recolor the base, and the manager
  // recolors each overlay's own layers. The optional variant defaults to standard, so existing
  // callers are unchanged; a bright-sun toggle passes 'sun' alongside 'day'.
  recolor: (theme: Theme, variant?: MapPaintVariant) => void;
  // Whether the widget has been destroyed, for bailing out of async overlay registration.
  isDestroyed: () => boolean;
  // Start syncing the overlays: on every MapLibre 'render' (so pan and zoom repaints update them)
  // and on a low-frequency interval (so store-driven overlays that change without a camera move,
  // like AIS prune, tides, radar advance, and collision, still tick). Both stop while the document
  // is hidden. The per-overlay dirty-checks still gate real work, so this only changes WHEN sync is
  // invoked, not what it does.
  runTick: (overlays: ReadonlyArray<Syncable>, onStatus?: OverlaySyncStatus) => void;
}

export interface ThemedMapOptions {
  container: HTMLElement;
  // Distinguishes this interactive canvas from any other map surface in the same view.
  accessibleName?: string;
  // The Chart Locker plugin base when installed, so the basemap style is proxied and cached, or
  // null or undefined for the direct openfreemap style.
  companionBase?: string | null;
  // A getter for the current Signal K auth token, called on every map fetch. When provided, any
  // same-origin request whose path starts with /plugins/signalk-chart-locker/ or /signalk/
  // receives an Authorization: Bearer header so the Chart Locker proxied basemap style, glyphs,
  // sprite, and tile routes work on a security-enabled server.
  getToken?: () => string | undefined;
  // Overrides the notice shown in place of the map when construction fails (usually a browser
  // without WebGL2), so a surface the default chart copy misdescribes can say its own thing.
  cannotStartNotice?: string;
  // The view to open at; capped to maxZoom. Falls back to the default center and zoom.
  view?: MapView;
  defaultCenter?: [number, number];
  defaultZoom?: number;
  minZoom?: number;
  maxZoom?: number;
  // Override the canvas pixel ratio for secondary or resource-constrained map surfaces. Omitted
  // maps take the device pixel ratio capped at 2 (see defaultPixelRatio).
  pixelRatio?: number;
  managerOptions?: LayerManagerOptions;
  // Coalesced to one emit per animation frame, for the live position readout and view persistence.
  onView?: (view: MapView) => void;
  // A hand drag (not a programmatic move or a scroll-zoom), for releasing a follow lock.
  onUserPan?: () => void;
  onClick?: (lngLat: { lng: number; lat: number }) => void;
  // A right-click (desktop) or long-press (touch) at a chart point, for the "go to here" menu. Carries
  // the geographic point and the pixel point within the container, so a menu can anchor at the press.
  onContextMenu?: (point: { lng: number; lat: number; x: number; y: number }) => void;
  // Every base-style attempt failed and the one-layer offline fallback is standing in, so the
  // chart-trust surface can say the base map is unavailable rather than showing a silent void.
  onBaseStyleFallback?: () => void;
  onLoad: (api: ThemedMapApi) => void | Promise<void>;
}

export interface ThemedMapHandle {
  // Available as soon as MapLibre has created a usable canvas, before the base style finishes
  // loading. Consumers can provide immediate interaction feedback without treating the map as
  // fully loaded or registering overlays early.
  map?: maplibregl.Map;
  destroy: () => void;
}

const DEFAULT_CENTER: [number, number] = [0, 30];
const DEFAULT_ZOOM = 2;
const STYLE_ARRIVAL_TIMEOUT_MS = 8_000;
const MAP_CONTEXT_ATTRIBUTES = {
  alpha: true,
  antialias: false,
  depth: true,
  desynchronized: false,
  failIfMajorPerformanceCaveat: false,
  powerPreference: 'high-performance',
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  stencil: true,
} satisfies WebGLContextAttributes;
const mapContextSupport = new WeakMap<Document, boolean>();

// The default canvas ratio is the device pixel ratio capped at 2: past 2x a high-DPI helm display
// roughly quadruples the fragment work over 1x for no chart detail the eye can use, and holding
// frame rate on Pi-class helms matters more. An explicit pixelRatio option still wins, and an
// environment without a window keeps MapLibre's own default.
function defaultPixelRatio(): number | undefined {
  if (typeof window === 'undefined') return undefined;
  return Math.min(window.devicePixelRatio || 1, 2);
}

function canCreateMapContext(): boolean {
  // MapLibre 6 registers global request-throttling state and DOM listeners before it discovers
  // that WebGL2 initialization failed. Its public remove() assumes a renderer exists, so that
  // partial Map cannot be cleaned up safely. Probe with the same effective default attributes
  // first, then release the throwaway context when the optional cleanup extension is available.
  const cached = mapContextSupport.get(document);
  if (cached !== undefined) return cached;
  if (typeof document.createElement !== 'function') return true;
  const canvas = document.createElement('canvas');
  if (typeof canvas.getContext !== 'function') return true;

  let context: WebGL2RenderingContext | null = null;
  const finishProbe = (supported: boolean) => {
    canvas.width = 0;
    canvas.height = 0;
    mapContextSupport.set(document, supported);
    return supported;
  };
  try {
    context = canvas.getContext('webgl2', MAP_CONTEXT_ATTRIBUTES) as WebGL2RenderingContext | null;
  } catch {
    return finishProbe(false);
  }
  if (!context) return finishProbe(false);

  try {
    context.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    // Cleanup is best effort. Extension support and loss timing are not WebGL2 capabilities.
  }
  return finishProbe(true);
}

function cannotStartHandle(opts: ThemedMapOptions, error?: unknown): ThemedMapHandle {
  if (error !== undefined) console.error('Map failed to initialize', error);

  // A dead handle alone would leave a silent blank map surface. Say so where the map would be:
  // the usual cause is a browser without the WebGL2 support MapLibre requires. A surface with
  // different framing (the weather mini-map) overrides the copy through cannotStartNotice.
  const notice = document.createElement('p');
  notice.className = 'alert-note chart-start-error';
  notice.textContent =
    opts.cannotStartNotice ??
    'The chart cannot start on this device. The usual cause is a browser without WebGL2 support. Instruments, alarms, and panels keep working.';
  opts.container.classList.remove('maplibregl-map');
  opts.container.replaceChildren(notice);

  let destroyed = false;
  return {
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      notice.remove();
    },
  };
}

// The shared MapLibre bootstrap for both map widgets (the navigation chart and the weather mini-map):
// map creation, a ResizeObserver, the per-frame view-emit coalescer, sentinels, the LayerManager, the
// theme recolor closure, the render-driven plus low-frequency overlay sync, and a single destroy.
// Each widget supplies only its overlay set and its own wiring via onLoad. One source of truth so the
// two never drift.
export function createThemedMap(opts: ThemedMapOptions): ThemedMapHandle {
  if (!canCreateMapContext()) return cannotStartHandle(opts);

  let map: maplibregl.Map;
  try {
    const center: [number, number] = opts.view
      ? [opts.view.lon, opts.view.lat]
      : (opts.defaultCenter ?? DEFAULT_CENTER);
    const wanted = opts.view ? opts.view.zoom : (opts.defaultZoom ?? DEFAULT_ZOOM);
    map = new maplibregl.Map({
      container: opts.container,
      style: baseStyleUrl(opts.companionBase),
      center,
      zoom: Math.min(wanted, opts.maxZoom ?? Number.POSITIVE_INFINITY),
      minZoom: opts.minZoom,
      maxZoom: opts.maxZoom,
      pixelRatio: opts.pixelRatio ?? defaultPixelRatio(),
      canvasContextAttributes: MAP_CONTEXT_ATTRIBUTES,
      // MapLibre 6 defaults to 4. Undefined preserves v5 vector rendering and query behavior.
      zoomLevelsToOverscale: undefined,
      dragRotate: false,
      touchPitch: false,
      pitchWithRotate: false,
      maxPitch: 0,
      attributionControl: { compact: true },
      transformRequest: (url: string) => {
        let parsed: URL;
        try {
          parsed = new URL(url, location.href);
        } catch {
          return undefined;
        }
        // Only touch same-origin companion and Signal K requests; leave the CDN sprite untouched.
        if (
          parsed.origin !== location.origin ||
          (!parsed.pathname.startsWith('/plugins/signalk-chart-locker/') &&
            !parsed.pathname.startsWith('/signalk/'))
        ) {
          return undefined;
        }
        // Always hand MapLibre the absolute URL. Vector tiles and glyphs are fetched in a web
        // worker that has no document base, so a path-absolute "/plugins/..." URL fails to parse
        // there ("Failed to construct 'Request': Failed to parse URL") and the whole vector source
        // stays blank. Raster tiles load on the main thread and tolerate the relative form, which
        // is why the relief layer rendered while the vector basemap did not. Attach the bearer
        // token when present; a read-only server still needs the absolute URL.
        const token = opts.getToken?.();
        return token
          ? { url: parsed.href, headers: { Authorization: `Bearer ${token}` } }
          : { url: parsed.href };
      },
    });
  } catch (error) {
    return cannotStartHandle(opts, error);
  }

  // A context can still disappear between the probe and construction. MapLibre 6 then emits
  // GPUInitializationError and returns before assigning its renderer and interaction handlers.
  // Its static Map type cannot represent that early return, so validate the exported surface before
  // using it. MapLibre's remove() assumes these fields exist too, so only recover the visible surface.
  const initializedSurface = map as Partial<
    Pick<maplibregl.Map, 'painter' | 'touchZoomRotate' | 'keyboard'>
  >;
  if (
    !initializedSurface.painter ||
    !initializedSurface.touchZoomRotate ||
    !initializedSurface.keyboard
  ) {
    // Do not repeat a probe-success and real-context-failure race in another map surface.
    mapContextSupport.set(document, false);
    return cannotStartHandle(opts);
  }

  // Keep pinch zoom, arrow-key pan, and keyboard zoom available while disabling only rotation.
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.getCanvas().setAttribute('aria-label', opts.accessibleName ?? 'Map');

  // MapLibre's compact attribution control auto-expands itself: AttributionControl's
  // _updateAttributions calls _updateCompact on every 'styledata' | 'sourcedata' | 'terrain'
  // event, and the first time that runs with a non-empty attribution string it adds the
  // 'maplibregl-compact-show' class, which is what the control's stylesheet actually keys the
  // expanded box on (the native <details> open attribute is never selected on). Binnacle's own
  // overlays supply nearly all of that attribution text (Seascape, NOAA ENC, and the rest
  // register well after the map's own 'load' event), so that first non-empty pass can land at
  // any time, including long after load. Listening for the same three events the control itself
  // listens for, registered after the control's own listener (so ours always runs second on a
  // given tick), strips the class back off the instant it reappears, however late that is; the
  // control's own icon still opens it on click either way.
  const collapseAttribution = () => {
    map
      .getContainer()
      .querySelector('.maplibregl-ctrl-attrib')
      ?.classList.remove('maplibregl-compact-show');
  };
  collapseAttribution();
  map.on('styledata', collapseAttribution);
  map.on('sourcedata', collapseAttribution);
  map.on('terrain', collapseAttribution);

  const mapInstance = map;
  mapInstance.addControl(
    new maplibregl.NavigationControl({ showCompass: false, showZoom: true, visualizePitch: false }),
    'top-right',
  );
  mapInstance.addControl(
    new maplibregl.ScaleControl({ maxWidth: 120, unit: 'nautical' }),
    'bottom-right',
  );
  let destroyed = false;
  // Teardown for the sync wiring runTick installs (the 'render' listener, the interval, and the
  // visibilitychange listener). A no-op until the overlay tick is built on 'load', then it delegates
  // to the controller's live teardown; invoked once on destroy.
  let stopTick = () => {};
  // Set after map load. Destroy disposes registered overlays before map.remove(), so module-owned
  // animation frames, workers, WebGL resources, and listeners never run against a removed map.
  let manager: LayerManager | undefined;

  // If the base style JSON itself never arrives (plain http at sea: no service worker, no
  // internet), the map can never fire 'load' and nothing mounts, including the charts already
  // sitting in the IndexedDB block cache. If a companion base was attempted, give the direct base
  // its own bounded attempt, then swap in the one-layer fallback style so 'load' fires and every
  // overlay mounts. The gate is precise: 'styledata' fires once the style JSON parses, so sprite,
  // glyph, and tile failures (which all come after it) can never trip this. The real style returns
  // on the next load with connectivity.
  let styleArrived = false;
  let triedDirectBase = false;
  let styleWatchdog: ReturnType<typeof setTimeout> | undefined;
  function stopStyleWatchdog(): void {
    if (styleWatchdog === undefined) return;
    clearTimeout(styleWatchdog);
    styleWatchdog = undefined;
  }
  function armStyleWatchdog(): void {
    stopStyleWatchdog();
    styleWatchdog = setTimeout(() => {
      styleWatchdog = undefined;
      handleStyleFailure('timeout');
    }, STYLE_ARRIVAL_TIMEOUT_MS);
  }
  function handleStyleFailure(reason: 'error' | 'timeout'): void {
    if (styleArrived || destroyed) return;
    if (opts.companionBase && !triedDirectBase) {
      triedDirectBase = true;
      console.info(
        reason === 'timeout'
          ? '[map] the companion base style did not arrive; trying the direct base style.'
          : '[map] the companion base style is unreachable; trying the direct base style.',
      );
      armStyleWatchdog();
      mapInstance.setStyle(baseStyleUrl());
      return;
    }
    styleArrived = true;
    stopStyleWatchdog();
    console.info(
      reason === 'timeout'
        ? '[map] the base map style did not arrive; starting on the offline fallback base. Cached charts and overlays still load.'
        : '[map] the base map style is unreachable; starting on the offline fallback base. Cached charts and overlays still load.',
    );
    opts.onBaseStyleFallback?.();
    mapInstance.setStyle(fallbackBaseStyle());
  }
  mapInstance.once('styledata', () => {
    styleArrived = true;
    stopStyleWatchdog();
  });
  // A style request that neither completes nor errors (a stalled connection can hang far past any
  // usefulness at sea) would otherwise leave a permanently blank map with nothing logged: the
  // error path below reacts only to an 'error' event. Each attempted style gets the full bounded
  // wait: a late companion failure re-arms this before starting the direct base request.
  armStyleWatchdog();
  mapInstance.on('error', () => {
    // A companion-proxied base style that fails while the device is online should not drop straight
    // to the blank fallback. Try the direct OpenFreeMap style first, then reserve the one-layer
    // offline fallback for the direct attempt's error or timeout.
    handleStyleFailure('error');
  });

  // The OpenFreeMap "liberty" base style references a handful of sprite icons and landuse
  // fill-patterns (for example "office", "gate", "brownfield", "reservoir") that its published
  // sprite does not actually contain, so MapLibre logs a "styleimagemissing" warning for each on
  // load. Supply a 1x1 transparent placeholder so the console stays clean and the affected icon or
  // pattern renders nothing, which matches how the theme already flattens those landuse fills.
  const transparentPixel = { width: 1, height: 1, data: new Uint8Array(4) };
  // MapLibre 6 made 'styleimagemissing' notify-only: on-demand images go through the resolver,
  // which MapLibre awaits before treating the image as missing.
  mapInstance.setMissingStyleImageResolver((id: string) => {
    if (mapInstance.hasImage(id)) return;
    mapInstance.addImage(id, transparentPixel);
  });

  // The container resizes when side panels open or the viewport changes without a window resize, so
  // observe it and let MapLibre re-fit rather than sit at a stale size.
  const resizeObserver = new ResizeObserver(() => mapInstance.resize());
  resizeObserver.observe(opts.container);

  // The 'move' event fires many times per drag frame; coalesce to one emit per animation frame.
  let viewPending = false;
  const emitView = () => {
    if (viewPending) return;
    viewPending = true;
    requestAnimationFrame(() => {
      viewPending = false;
      if (destroyed) return;
      const center = mapInstance.getCenter();
      opts.onView?.({ lat: center.lat, lon: center.lng, zoom: mapInstance.getZoom() });
    });
  };
  mapInstance.on('move', emitView);
  // dragstart fires only for hand panning (not for programmatic setCenter or scroll-zoom), so a
  // follow lock survives a zoom but ends the moment the user drags the chart away.
  if (opts.onUserPan) mapInstance.on('dragstart', () => opts.onUserPan?.());
  if (opts.onClick) {
    const tap = createMapTapRecognizer((event) =>
      opts.onClick?.({ lng: event.lngLat.lng, lat: event.lngLat.lat }),
    );
    mapInstance.on('click', tap.click);
    mapInstance.on('touchstart', tap.touchstart);
    mapInstance.on('touchmove', tap.touchmove);
    mapInstance.on('touchend', tap.touchend);
    mapInstance.on('touchcancel', tap.cancel);
  }

  // A right-click or long-press at a point, surfaced for the "go to here" menu. The contextMenu
  // controller owns the contextmenu event, the touch long-press synthesis, and the canvas-listener
  // teardown; both closures stay no-ops when no onContextMenu is supplied.
  let cancelLongPress = () => {};
  let removeCanvasListeners = () => {};
  if (opts.onContextMenu) {
    const contextMenu = installContextMenu(mapInstance, opts.onContextMenu);
    cancelLongPress = contextMenu.cancel;
    removeCanvasListeners = contextMenu.remove;
  }

  mapInstance.once('load', () => {
    // MapLibre normally removes pending listeners with the map, but the load event can already be
    // queued when a component closes. Do not create sentinels, a manager, or widget wiring then.
    if (destroyed) return;
    emitView();
    const ctx: OverlayContext = { map: mapInstance, beforeIdFor };
    installSentinels(mapInstance);
    const loadedManager = new LayerManager(ctx, opts.managerOptions);
    manager = loadedManager;

    // Snapshot the source style's own colors before any recolor, so the day theme can restore the
    // real map rather than approximate it.
    const baseColors = captureBaseTheme(mapInstance, mapThemePaint('day'));
    const recolor = (theme: Theme, variant: MapPaintVariant = 'standard') => {
      const paint = mapThemePaint(theme, variant);
      // Both base passes filter the style to the same themable layers; compute that list once and
      // pass it to both rather than refiltering twice per recolor.
      const layers = themableBaseLayers(mapInstance);
      // Standard day restores the source style's real colors. The sun variant recolors the base
      // like the dark themes instead: the source style's own paint is the washed-out look the
      // variant exists to replace.
      if (theme === 'day' && variant !== 'sun') restoreBaseTheme(mapInstance, baseColors);
      else applyBaseTheme(mapInstance, paint, layers);
      applyBaseIconVisibility(mapInstance, paint, layers);
      applyBaseRasterVisibility(mapInstance, paint, layers);
      loadedManager.applyTheme(paint);
    };

    const tick = createOverlayTick(mapInstance, ctx, () => destroyed);
    // Route destroy's teardown through the controller's stopTick, which tears down the latest runTick
    // wiring (or no-ops if runTick was never called).
    stopTick = tick.stopTick;

    const api: ThemedMapApi = {
      map: mapInstance,
      ctx,
      manager: loadedManager,
      recolor,
      isDestroyed: () => destroyed,
      runTick: tick.runTick,
    };
    const reportLoadError = (error: unknown): void => {
      // A manager disposal barrier can reject an in-flight widget initialization during normal
      // teardown. Only report failures while the map is still live.
      if (!destroyed) console.error('map onLoad failed', error);
    };
    try {
      void Promise.resolve(opts.onLoad(api)).catch(reportLoadError);
    } catch (error) {
      // Promise.resolve cannot catch a callback that throws before returning a promise.
      reportLoadError(error);
    }
  });

  return {
    map: mapInstance,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      stopStyleWatchdog();
      cancelLongPress();
      removeCanvasListeners();
      stopTick();
      resizeObserver.disconnect();
      manager?.dispose();
      mapInstance.remove();
    },
  };
}
