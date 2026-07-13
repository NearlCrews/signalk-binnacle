# Measure

Measure is a temporary chart tool for checking the range and true bearing between tapped positions.
It reports the latest leg and the running total. Measurements are advisory. They do not account for
hazards, depth, traffic, leeway, current, restricted areas, or the vessel's maneuvering limits.

## Quick use

1. Open **Menu**, then **Measure**. The pointer becomes a crosshair, and the strip asks for a start
   point.
2. Tap the chart once to set the start, then tap again to make a leg.
3. Continue tapping to add legs. The strip shows the latest leg, its bearing in degrees true, and the
   total when more than one leg exists. The last chart point carries the total label.
4. Use **Undo** to remove the latest point, **Clear** to keep the tool active with a clean slate, or
   **Done** to end the tool and remove all points.

Press and hold or right-click a chart position before Measure is active, then choose **Measure from
here** to start a fresh measurement at that exact position. Keyboard users can focus the chart and use
the Context Menu key or Shift+F10 to open the same actions at the chart center. Selecting the
already-active Measure menu item closes the menu without erasing current work.

Escape ends Measure when it is the topmost dismissible surface. Route editing owns chart taps if both
states ever overlap.

## Geometry and units

Each leg uses rhumb-line distance and rhumb bearing. The two values therefore describe the same
constant-bearing geometry. Bearings are clockwise from true north and display as three digits with a
`T` suffix. Values remain meters and radians in state. Range converts only at display time according to
the Signal K server unit preference, using meters or feet at short range and nautical miles above the
shared threshold.

Longitude deltas use the short direction across the antimeridian. Overlay coordinates are unwrapped
from one point to the next, so a two-degree leg across the date line does not draw a near-global line.

## State and safety boundaries

Measure is session-only. Starting fresh, selecting **Done**, or reloading clears every point. It does
not write to Signal K, IndexedDB, or local storage.

Only finite coordinates in the valid latitude and longitude ranges are accepted. Consecutive duplicate
points are ignored, avoiding a zero-length leg with a meaningless bearing. Each accepted point is
copied, and the point array is replaced rather than mutated so the overlay's identity-based dirty check
sees every tap. A measurement is capped at 1,000 points. At the limit, the strip asks the navigator to
undo or clear before continuing.

The strip always explains the next action, including before the first point, after the start point,
while adding legs, and at the limit. Metric changes are announced politely, controls keep the shared
44 px targets, and the layout wraps on narrow screens.

## Implementation and verification

- `src/entities/measure/measure.svelte.ts` owns active state, validation, the point limit, derived
  legs, and the running total.
- `src/features/measure/measure-overlay.ts` builds vertices, the dashed line, and the total label.
- `src/features/measure/MeasureStrip.svelte` owns guidance, metrics, Undo, Clear, Done, and Escape.
- `src/widgets/chart-canvas/ChartCanvas.svelte` routes chart taps and owns the crosshair affordance.
- `src/app/App.svelte` reveals the overlay and distinguishes menu activation from Measure from here.

Unit coverage verifies state transitions, invalid and duplicate points, point limits, incremental
redraw, unit changes, opacity, cleanup, and antimeridian geometry. The Playwright flow covers keyboard
chart actions, a real two-point chart gesture, active-menu retention, Undo, Done, cursor restoration,
and narrow-screen layout.
