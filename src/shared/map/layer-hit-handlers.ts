import type { MapLayerMouseEvent, MapLayerTouchEvent, MapTouchEvent } from 'maplibre-gl';
import { createMapTapRecognizer } from './map-tap';
import { type OverlayContext, Z_ORDER, type ZBand } from './types';

export type LayerHitEvent = MapLayerMouseEvent | MapLayerTouchEvent;

export interface LayerHitHandlers {
  attach(ctx: OverlayContext): void;
  detach(ctx: OverlayContext): void;
  refreshInteractionState(): void;
}

export interface LayerHitOptions {
  interactionsAllowed?: () => boolean;
  band?: ZBand;
  // Higher values win when two interactive surfaces in the same band overlap.
  withinBandOrder?: number;
}

interface PendingLayerHit {
  bandOrder: number;
  withinBandOrder: number;
  run(): boolean;
}

interface PointerOwner {
  interactionsAllowed: () => boolean;
}

const pendingHits = new WeakMap<object, PendingLayerHit[]>();
const scheduledHits = new WeakSet<object>();
const pointerOwners = new WeakMap<HTMLElement, Set<PointerOwner>>();

export function activeLayerHitCursor(canvas: HTMLElement): 'pointer' | undefined {
  const owners = pointerOwners.get(canvas);
  if (!owners) return undefined;
  for (const owner of owners) {
    if (owner.interactionsAllowed()) return 'pointer';
  }
  return undefined;
}

function acquirePointer(canvas: HTMLElement, owner: PointerOwner): void {
  const owners = pointerOwners.get(canvas) ?? new Set<PointerOwner>();
  owners.add(owner);
  pointerOwners.set(canvas, owners);
  if (activeLayerHitCursor(canvas) && (!canvas.style.cursor || canvas.style.cursor === 'pointer')) {
    canvas.style.cursor = 'pointer';
  }
}

function releasePointer(canvas: HTMLElement, owner: PointerOwner): void {
  const owners = pointerOwners.get(canvas);
  if (!owners) return;
  owners.delete(owner);
  if (owners.size === 0) pointerOwners.delete(canvas);
  if (canvas.style.cursor === 'pointer') {
    canvas.style.cursor = activeLayerHitCursor(canvas) ?? '';
  }
}

type LayerHitFeature = NonNullable<LayerHitEvent['features']>[number];

function snapshotEvent(
  event: LayerHitEvent | MapTouchEvent,
  features: readonly LayerHitFeature[] = 'features' in event ? (event.features ?? []) : [],
): LayerHitEvent {
  return Object.assign(Object.create(Object.getPrototypeOf(event)) as LayerHitEvent, event, {
    features: [...features],
  });
}

// MapLibre invokes every matching delegated listener for one DOM event. Arbitrate those callbacks
// in a microtask so overlapping markers do not open several panels. The fixed overlay bands also
// define their visual order, so the visually highest matching band receives the gesture.
function queueLayerHit(
  event: LayerHitEvent,
  order: { band: number; withinBand: number },
  run: (event: LayerHitEvent) => boolean,
): void {
  const originalEvent =
    typeof event.originalEvent === 'object' && event.originalEvent !== null
      ? event.originalEvent
      : undefined;
  if (!originalEvent) {
    run(event);
    return;
  }

  const snapshot = snapshotEvent(event);
  const candidate = {
    bandOrder: order.band,
    withinBandOrder: order.withinBand,
    run: () => run(snapshot),
  };
  const pending = pendingHits.get(originalEvent) ?? [];
  pending.push(candidate);
  pendingHits.set(originalEvent, pending);
  if (scheduledHits.has(originalEvent)) return;
  scheduledHits.add(originalEvent);
  queueMicrotask(() => {
    const candidates = pendingHits.get(originalEvent) ?? [];
    pendingHits.delete(originalEvent);
    scheduledHits.delete(originalEvent);
    candidates.sort(
      (left, right) =>
        right.bandOrder - left.bandOrder || right.withinBandOrder - left.withinBandOrder,
    );
    for (const selected of candidates) {
      if (selected.run()) return;
    }
  });
}

export function createLayerHitHandlers(
  layerIds: string | readonly string[],
  onTap: (event: LayerHitEvent) => boolean,
  options: LayerHitOptions = {},
): LayerHitHandlers {
  let attachedContext: OverlayContext | undefined;
  let ownsPointerCursor = false;
  let touchStartEvent: LayerHitEvent | undefined;
  const interactionsAllowed = options.interactionsAllowed ?? (() => true);
  const pointerOwner = { interactionsAllowed };
  const order = {
    band: options.band ? Z_ORDER.indexOf(options.band) : 0,
    withinBand: options.withinBandOrder ?? 0,
  };
  const delegatedLayers = typeof layerIds === 'string' ? [layerIds] : [...layerIds];
  const tap = createMapTapRecognizer((event) => {
    const layerEvent = event as LayerHitEvent;
    queueLayerHit(layerEvent, order, (snapshot) => {
      if (!attachedContext || !interactionsAllowed()) return false;
      return onTap(snapshot);
    });
  }, interactionsAllowed);
  // Reset a candidate when a new touch starts outside the delegated layers. Register this general
  // listener before the delegated touchstart listener so a touch on a hit layer resets, then arms.
  const resetTouch = (): void => {
    touchStartEvent = undefined;
    tap.cancel();
  };
  const onAnyTouchStart = (): void => resetTouch();
  const onDelegatedTouchStart = (event: MapLayerTouchEvent): void => {
    touchStartEvent = snapshotEvent(event);
    tap.touchstart(event);
  };
  const onTouchMove = (event: MapTouchEvent): void => tap.touchmove(event);
  const onTouchEnd = (event: MapTouchEvent): void => {
    const started = touchStartEvent;
    tap.touchend((started ? snapshotEvent(event, started.features) : event) as MapTouchEvent);
    touchStartEvent = undefined;
  };
  const onEnter = (): void => {
    if (!attachedContext) return;
    acquirePointer(attachedContext.map.getCanvas(), pointerOwner);
    ownsPointerCursor = true;
  };
  const onLeave = (): void => {
    if (attachedContext && ownsPointerCursor) {
      releasePointer(attachedContext.map.getCanvas(), pointerOwner);
    }
    ownsPointerCursor = false;
  };

  return {
    attach(ctx) {
      if (attachedContext) return;
      attachedContext = ctx;
      ctx.map.on('click', delegatedLayers, tap.click);
      ctx.map.on('touchstart', onAnyTouchStart);
      ctx.map.on('touchstart', delegatedLayers, onDelegatedTouchStart);
      ctx.map.on('touchmove', onTouchMove);
      ctx.map.on('touchend', delegatedLayers, onTouchEnd);
      // Runs after the delegated end listener. It completes a valid tap whose lift drifted just
      // outside the hit layer, using the feature snapshot captured where the finger went down.
      ctx.map.on('touchend', onTouchEnd);
      ctx.map.on('touchcancel', resetTouch);
      ctx.map.on('mouseenter', delegatedLayers, onEnter);
      ctx.map.on('mouseleave', delegatedLayers, onLeave);
    },
    detach() {
      if (!attachedContext) return;
      attachedContext.map.off('click', delegatedLayers, tap.click);
      attachedContext.map.off('touchstart', onAnyTouchStart);
      attachedContext.map.off('touchstart', delegatedLayers, onDelegatedTouchStart);
      attachedContext.map.off('touchmove', onTouchMove);
      attachedContext.map.off('touchend', delegatedLayers, onTouchEnd);
      attachedContext.map.off('touchend', onTouchEnd);
      attachedContext.map.off('touchcancel', resetTouch);
      attachedContext.map.off('mouseenter', delegatedLayers, onEnter);
      attachedContext.map.off('mouseleave', delegatedLayers, onLeave);
      if (ownsPointerCursor) releasePointer(attachedContext.map.getCanvas(), pointerOwner);
      resetTouch();
      ownsPointerCursor = false;
      attachedContext = undefined;
    },
    refreshInteractionState() {
      if (!attachedContext) return;
      if (!interactionsAllowed()) resetTouch();
      const canvas = attachedContext.map.getCanvas();
      if (!canvas.style.cursor || canvas.style.cursor === 'pointer') {
        canvas.style.cursor = activeLayerHitCursor(canvas) ?? '';
      }
    },
  };
}
