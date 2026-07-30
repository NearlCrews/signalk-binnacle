import type { MapMouseEvent, MapTouchEvent } from 'maplibre-gl';

const TAP_MAX_DURATION_MS = 450;
const TAP_MOVE_TOLERANCE_PX = 10;

export type MapTapEvent = MapMouseEvent | MapTouchEvent;

export interface MapTapRecognizer {
  click(event: MapMouseEvent): void;
  touchstart(event: MapTouchEvent): void;
  touchmove(event: MapTouchEvent): void;
  touchend(event: MapTouchEvent): void;
  cancel(): void;
}

interface TouchCandidate {
  x: number;
  y: number;
  startedAt: number;
}

function movedBeyond(candidate: TouchCandidate, event: MapTouchEvent): boolean {
  return (
    Math.hypot(event.point.x - candidate.x, event.point.y - candidate.y) > TAP_MOVE_TOLERANCE_PX
  );
}

function preventCompatibilityClick(event: MapTouchEvent): void {
  const originalEvent = event.originalEvent as { preventDefault?: unknown } | undefined;
  if (typeof originalEvent?.preventDefault === 'function') originalEvent.preventDefault();
}

// MapLibre emits `click` for mouse input, but touch-only browsers report the same gesture through
// touch events. Recognize one short, still finger as a tap, reject pans and long presses, and suppress
// the compatibility click that some browsers synthesize after touchend by canceling the accepted
// native touch event. A real mouse remains usable immediately after touch input on hybrid
// chartplotters.
export function createMapTapRecognizer(
  onTap: (event: MapTapEvent) => void,
  interactionsAllowed: () => boolean = () => true,
  now: () => number = Date.now,
): MapTapRecognizer {
  let touchCandidate: TouchCandidate | undefined;

  const cancel = (): void => {
    touchCandidate = undefined;
  };

  return {
    click(event) {
      if (!interactionsAllowed()) return;
      onTap(event);
    },
    touchstart(event) {
      touchCandidate =
        interactionsAllowed() && event.points.length === 1
          ? { x: event.point.x, y: event.point.y, startedAt: now() }
          : undefined;
    },
    touchmove(event) {
      if (touchCandidate && (event.points.length !== 1 || movedBeyond(touchCandidate, event))) {
        cancel();
      }
    },
    touchend(event) {
      const candidate = touchCandidate;
      cancel();
      const endedAt = now();
      if (
        !candidate ||
        !interactionsAllowed() ||
        event.points.length !== 1 ||
        endedAt - candidate.startedAt > TAP_MAX_DURATION_MS ||
        movedBeyond(candidate, event)
      ) {
        return;
      }
      preventCompatibilityClick(event);
      onTap(event);
    },
    cancel,
  };
}
