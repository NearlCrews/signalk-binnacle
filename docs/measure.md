# Measure

Measure is a temporary chart tool for checking rhumb-line range and true bearing across one or more
legs. Measurements are advisory. They do not account for hazards, depth, traffic, leeway, current,
restricted areas, or the vessel's maneuvering limits.

## Quick use

1. Open **Menu**, then **Measure**. The pointer becomes a crosshair, and the strip asks for a start
   point.
2. Tap the chart once to set the start, then tap again to make a leg. Continue tapping to add legs.
3. Read the latest leg and true bearing in the strip. The running total appears after the second leg.
   Individual distance labels appear on the chart at zoom 8 and above when MapLibre can place them
   without a collision. The final point keeps the total label.
4. Select a point by tapping its generous chart target or choosing it from **Selected point**. The
   strip shows its incoming and outgoing leg distances and true bearings.
5. Choose **Move point**, then drag the selected chart point or tap its new chart position. Choose
   **Delete point** to remove it. **Undo** reverses the latest add, completed move, or deletion.
6. Choose **Clear**, then confirm, to keep Measure active with a clean slate. Choose **Done** to end
   Measure and remove every temporary point.

For a keyboard movement path, select the point in the strip, choose **Move point**, focus and pan the
chart with MapLibre's keyboard controls, then choose **Move to chart center**.

Press and hold or right-click a chart position before Measure is active, then choose **Measure from
here** to start a fresh measurement at that exact position. Keyboard users can focus the chart and use
the Context Menu key or Shift+F10 to open the same actions at the chart center. Selecting the
already-active Measure menu item closes the menu without erasing current work.

Escape cancels move mode first and preserves the measurement. A following Escape ends Measure when
it is the topmost dismissible surface.

Measure and route editing cannot own chart gestures at the same time. Route editing disables Measure
with an explanation. Starting or editing a route while Measure is active is refused without clearing
either tool.

## Geometry and units

Each leg uses rhumb-line distance and rhumb bearing. The two values therefore describe the same
constant-bearing geometry. Bearings are clockwise from true north and display as three digits with a
`T` suffix. Values remain meters and radians in state. Range converts only at display time according to
the Signal K server unit preference, using meters or feet at short range and nautical miles above the
shared threshold.

Longitude deltas use the short direction across the antimeridian. Overlay geometry splits at the date
line into canonical east-edge and west-edge segments, so a two-degree leg does not draw a near-global
line. Each distance label uses a Mercator-space rhumb midpoint with the longitude unwrapped in the
short direction. An antimeridian label therefore remains beside the date line instead of appearing
near Greenwich.

Leg labels are distance-only to limit chart clutter. They begin at zoom 8, participate in MapLibre
collision placement, avoid chart edges, and use theme paint for day, dusk, and night-red. Bearings
remain in the selected-leg strip, where they are always available without covering chart detail.

## Editing, Undo, and limits

Every point receives a stable, session-local id. Undo stores inverse operations:

- Undo after adding removes that point.
- Undo after moving restores the prior coordinate.
- Undo after deleting reinserts the same point at the same index.

One completed drag creates one Undo entry. A canceled or zero-distance drag creates none. Starting
fresh, stopping, and clearing reset the history and selection. Clear requires confirmation because it
cannot be undone.

Only finite coordinates in the valid latitude and longitude ranges are accepted. Consecutive
duplicate points are ignored. A move that would duplicate an adjacent point is rejected. Deleting a
middle point is rejected if joining its neighbors would create a duplicate leg endpoint.

A measurement is capped at 1,000 points. Add remains blocked at the limit, while selection, move,
delete, and Undo remain available. The history bound retains the ability to undo all 1,000 additions.

## Interaction and accessibility

The visible chart marker stays compact, but an invisible 44 px layer supplies the selection and drag
target. Selection is a separate action from movement, so tapping a point does not unexpectedly steal
map panning. Deliberate move mode changes the cursor, disables map drag-pan only during an active
point drag, suppresses the trailing click, and restores the prior cursor and pan state after commit,
cancel, interruption, or teardown.

The strip provides labeled Previous, Next, Move, Delete, and chart-center movement controls with the
shared 44 px action size. Its rows wrap at narrow widths. Instructions and changed readouts use polite
status announcements, and Delete names the selected point for assistive technology.

## State and safety boundaries

Measure is session-only. Starting fresh, selecting **Done**, or reloading clears every point. It does
not write to Signal K, IndexedDB, or local storage. Moving or deleting a point changes only this
temporary advisory measurement.

## Implementation and verification

- `src/entities/measure/measure.svelte.ts` owns validation, stable point identity, selection, move
  preview, inverse operation history, derived legs, and totals.
- `src/features/measure/measure-overlay.ts` builds antimeridian-safe per-leg geometry, collision-managed
  distance labels, the total label, selection styling, the 44 px hit layer, and drag cleanup.
- `src/features/measure/MeasureStrip.svelte` owns guidance, adjacent-leg readouts, keyboard-equivalent
  editing, Undo, confirmed Clear, Done, and nested Escape behavior.
- `src/widgets/chart-canvas/ChartCanvas.svelte` resolves vertex hits before chart additions and gives
  Measure one result per click.
- `src/features/routing/route-controller.svelte.ts` and `src/app/App.svelte` enforce route exclusion at
  both tool entry points.

Unit coverage verifies operation Undo, invalid and duplicate edits, point limits, selection, drag
commit and cancellation, pan restoration, antimeridian geometry and label midpoints, collision
settings, theming, unit changes, opacity, and cleanup. The Playwright flow covers a 44 px chart
selection target, pointer dragging, delete and Undo, keyboard chart-center movement, nested Escape,
menu retention, route exclusion in both directions, cursor restoration, and a 320 px layout.
