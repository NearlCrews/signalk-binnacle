# Binnacle codebase review, 2026-08-01

A full-repo engineering audit of the Binnacle chartplotter: app shell, views, widgets, all feature
slices, entity stores, shared modules, styles, service worker packaging, build configuration, and
test infrastructure. Every finding below has been read against the cited code twice: once when it
was raised, and once on the correction pass recorded in the next section. Claims that did not
survive either pass are listed in the "Checked and dismissed" appendix so they are not
re-litigated.

## How to use this document

- Work high severity first, then medium, then low. Items inside a severity are ordered by user
  impact.
- Finding ids are stable. A finding that later failed verification keeps its id and moves to
  "Checked and dismissed"; a finding whose grade changed keeps its id and moves to its new
  section. Nothing is renumbered.
- Each finding cites exact locations, explains why it matters, gives a fix direction, and names
  the verification that proves the fix (a focused test, a project gate, or a scenario).
- Project gates: `npm test` (unit and component), `npm run check` (svelte-check plus tsgo),
  `npm run lint`, `npm run cruise` (boundaries), `npm run build`, `npm run size`, and the full
  `npm run verify`. Run the focused test first, then the full gate before committing.
- Several findings share root causes. Read "Cross-cutting themes" before planning batches.

Severity definitions:

- **high**: correctness or data bug, or a broken user-facing behavior under realistic conditions.
- **med**: real maintainability, performance, consistency, or contract drift with plausible cost.
- **low**: style, polish, hardening, or theoretical exposure with no known user impact today.

## Corrections applied 2026-08-01

A second pass re-verified every finding against the code. The results:

- **Refuted and moved to "Checked and dismissed"**: H1, L11, and L17. Each rested on a premise the
  code contradicts.
- **Regraded**: H4 drops from high to low. Its user-facing claim did not survive; what remains is
  persisted-state hygiene.
- **Fix direction corrected** (the finding is real, the prescribed fix was wrong or incomplete):
  H2, H3, H5, and L14.
- **Scope or impact corrected** (the finding is real, the described mechanism or blast radius was
  off): M4, M5, M11, and M15.
- **Citations corrected**: L1, L2, L3, L7, L16, and one appendix entry.

Findings verified as written, with no change: M1, M2, M3, M6, M7, M8, M9, M10, M12, M13, M14, L4,
L5, L6, L8, L9, L10, L12, L13, L15, L18, and L19.

---

## High

### H2. Wave direction arrows interpolate linearly across the 0/360 wrap

- **Location**: `src/features/weather/wave-arrows.ts:25`. The correct circular blend already
  exists at `src/features/weather/weather-readout.ts:207-211` (sin/cos components blended, then
  `atan2`).
- **What**: `waveArrowFeatures` blends bracketing wave directions with `lerp(d0[i], d1[i], frac)`.
  A transition from 350 degrees to 10 degrees blends through 180, so mid-transition arrows point
  backwards. Wind arrows avoid this by blending u/v components (`wind-arrows.ts:22-23`).
- **Why**: Whenever the two bracketing forecast steps straddle the seam, every intermediate arrow
  is wrong, worst at the midpoint where it points a full 180 degrees off. Wave direction near
  north is common, so this is not an exotic case. Advisory data, but visibly wrong on a
  safety-adjacent surface.
- **Fix**: Extract the sin/cos circular blend from `weather-readout.ts` into a small shared helper
  in the weather slice (or `$shared/lib`), and use it for the wave direction blend. **Do not reuse
  `circularOr` verbatim**: it returns `a ?? b` when one side is missing, which would return
  `undefined` for a cell where both steps lack direction. `wave-arrows.ts:27` skips a cell by
  testing `Number.isNaN(direction)`, and `Number.isNaN(undefined)` is false, so the borrowed
  helper would emit arrows built from `Math.sin(undefined)`. The wave helper must let NaN
  propagate (`atan2(NaN, NaN)` is NaN, and `(NaN + 2 * Math.PI) % (2 * Math.PI)` stays NaN, so the
  existing guard holds).
- **Verify**: Unit test in radians, the store unit, not degrees: blending 6.1087 rad (350 degrees)
  to 0.1745 rad (10 degrees) at fraction 0.5 yields approximately 0 or 2 pi, not pi. Add a case
  where both bracketing directions are absent and assert the cell is skipped. Run the existing
  wave-arrows and weather-readout tests, then `npm test`.

### H3. `padBbox` truncates MapLibre's unwrapped antimeridian bounds

- **Location**: `src/shared/geo/bounds.ts:104-108` (`padBbox` returns
  `clampToWorld([west - dx, south - dy, east + dx, north + dy])`), with `clampToWorld` at
  `src/shared/geo/bounds.ts:84-89`.
- **What**: MapLibre reports unwrapped viewport longitudes when panned across the antimeridian
  (for example west 170, east 190). `padBbox` pads to about (160, ..., 200), then `clampToWorld`
  clamps the east edge back to 180. `bboxContains(padded, viewport)` then always fails at the
  seam, so viewport-keyed fetch overlays (the notes cache and AIS trails, per the
  `VIEWPORT_FETCH_PAD_FRACTION` comment) miss their coverage cache on every move and refetch
  continuously while the chart sits across the antimeridian.
- **Why**: Guaranteed cache misses and repeated fetch churn in exactly the region boats cross
  oceans. The `bboxContains` comment documents a non-crossing assumption, but "non-crossing" is
  not the same as "within [-180, 180]": MapLibre violates the second at the seam.
- **Confirmed against MapLibre 6**: the mercator transform's `getBounds` extends a `LngLatBounds`
  from four unprojected screen corners, and `LngLatBounds.extend` takes a plain min/max of `lng`
  with no wrapping. The center itself is wrapped into range after a pan
  (`if (this._helper._renderWorldCopies) this.setCenter(this.center.wrap())`), so the overshoot is
  bounded by half the viewport width, but an edge past 180 (or below -180) is exactly what the
  seam produces. The globe transform's `getBounds` returns `center.lng + mostEast` and has the
  same property. The `lngLatBoundsToBbox4` comment claiming "MapLibre reports a non-crossing
  viewport" is true (west stays below east) and beside the point: the box is non-crossing **and**
  out of range.
- **Fix**: Two spaces must be separated, and the original fix direction conflated them.
  1. *Coverage comparison space*: keep longitude unwrapped through `padBbox` so `bboxContains`
     compares the cached area against the viewport in the same space MapLibre reports (clamp
     latitude only). This is what fixes the cache miss.
  2. *Wire bbox*: the padded box is serialized straight into the Signal K query
     (`notes-client.ts:110`, `bbox: JSON.stringify(bbox)`), so an east of 200 would go on the wire
     as an out-of-range longitude and match nothing. Keeping the unwrapped value in the request
     would trade a cache miss for an empty result, which is worse. Normalize at the request edge:
     either express a seam-crossing area in the west greater than east convention the rest of
     `$shared/geo` already uses (`unwrapEast`, `boundsOfPoints`) if the provider accepts it, or
     split the fetch into two in-range boxes and merge the responses. Confirm which the merged
     notes provider actually honors before choosing.
  Cache the fetched coverage in the unwrapped space regardless, so step 1 stays coherent.
- **Verify**: New `padBbox` and `bboxContains` cases in the bounds tests covering a viewport
  spanning 170 to 190 and one spanning -190 to -170, plus a notes-client test asserting the
  serialized `bbox` parameter stays within [-180, 180]. Then `npm test` and `npm run check`.
- **Not assessed**: the weather map has its own coverage check
  (`entities/weather/weather-grid.ts:128`, an object-shaped `bboxContains` used by
  `weather-loader.ts:258`) reached through a different request builder. It was not traced for the
  same seam behavior; check it before closing this out.

### H5. `planningSpeedKn` persists configuration in non-SI units

- **Location**: `src/app/App.svelte:302-308` (the `PersistedValue<number>` in knots),
  `src/entities/profile/profile-types.ts:15` (profile field), and
  `src/shared/persistence/storage-keys.ts:24`. Display conversion happens at
  `src/features/routing/RouteEditPlan.svelte:29-34`.
- **What**: The route planning speed is stored in knots in both device persistence and portable
  profiles. Every sibling persisted value (`anchorRadiusMeters`, `trackSettings.minMeters`, all
  thresholds) is SI.
- **Why**: The project contract is "keep data and persisted config in SI; convert at the display
  edge." A knots field is the one exception, it propagates into profiles that merge across
  devices, and it forces every consumer to know the stored unit.
- **Fix**: Migrate to `planningSpeedMps`. Cover, in this order:
  1. A new `planningSpeedMps` entry in the storage-key registry
     (`shared/persistence/storage-keys.ts`). The key literal cannot be hardcoded at the call site:
     a source-inventory test rejects that, so the legacy read must also go through the registry
     (keep `planningSpeedKn` there until the migration window closes).
  2. A `PersistedValue` codec that reads the legacy `binnacle:planning-speed-kn` key and converts
     knots to m/s once.
  3. The profile field rename, which is three edits, not one: the `ProfileSettings` field
     (`profile-types.ts:15`), the `PORTABLE_PROFILE_SETTING_KEYS` tuple (`profile-types.ts:38-51`),
     and legacy acceptance in the profile validator (accept `planningSpeedKn`, convert, and
     re-emit as `planningSpeedMps`).
  4. The per-field merge clocks. `profiles-store.svelte.ts` keys `timestamps` and `pendingSettings`
     by field name (lines 242, 429, 449-451, 478-490), so a renamed field starts with no clock
     entry and the old one lingers. Carry the old field's timestamp forward on migration, or the
     first sync can resurrect a stale value from another device.
  5. Updated validation bounds (0 to about 51.4 m/s, from the existing 100 kn ceiling), and
     conversion to knots only at the `UnitField` in `RouteEditPlan.svelte`.
- **Verify**: Codec migration test (legacy knots value loads as m/s), profile IO round-trip with
  a legacy `planningSpeedKn` field, a merge test asserting the migrated field keeps the legacy
  field's clock, the RouteEditPlan display test, then `npm test` and `npm run check`.

---

## Medium

### M1. Radar worker flush loop has no backpressure

- **Location**: `src/features/marine-radar/radar-worker.ts:105-113` (the `setInterval` flush calls
  the Comlink `onFrame` proxy without awaiting), with buffer recycling at
  `src/features/marine-radar/radar-worker-client.ts:57-63`.
- **What**: Each tick transfers a frame to the main thread regardless of whether the previous
  frame was consumed. Under sustained main-thread lag the message channel grows unbounded, the
  recycle pool empties, and the worker allocates a fresh `ArrayBuffer` per flush. The pool is
  capped at two buffers (`radar-frame-core.ts:36` and `:89`) and the main thread only recycles the
  previous frame as it consumes the next (`marine-radar-controller.svelte.ts:239-242`), so the
  backlog is the queued transfers themselves, at the full frame size each.
- **Why**: Memory growth plus a paint backlog that shows stale sweeps late, worst on the
  low-power hardware a chartplotter typically runs on. No wrong data, so medium rather than
  high.
- **Fix**: Gate the flush on an in-flight credit: skip the flush (or coalesce into the next)
  while a previously transferred frame has not been consumed or recycled. The existing `recycle`
  channel is the natural credit signal.
- **Verify**: Radar worker and worker-client tests with a slow consumer: assert flushes are
  skipped while a frame is outstanding and buffers are reused. Then `npm test`.

### M2. Radar area conflict state latches permanently

- **Location**: `src/features/marine-radar/RadarAreaControl.svelte:228-231`.
- **What**: The conflict effect only ever sets `conflict = true` on a signature mismatch. If the
  accepted value later returns to the baseline (another client reverted the change, or a provider
  bounced), the conflict UI stays latched and the draft stays blocked.
- **Why**: A transient server-side change permanently forces the navigator to discard a draft.
- **Fix**: Assign the comparison so the state recovers:
  `conflict = structuredSignature(accepted) !== baselineSignature`, keeping the existing
  `activeDraft`/`baselineSignature` guards.
- **Verify**: Component test: introduce a mismatch, assert conflict; restore the accepted value
  to baseline, assert conflict clears. Then `npm test`.

### M3. POI and Waypoints lists recompute metrics on every GPS fix

- **Location**: `src/features/poi-search/PoiSearchPanel.svelte:55-59` and
  `src/features/waypoints/WaypointsPanel.svelte:81-87`. The AIS list already solved this exact
  problem with a quantized own-position key at
  `src/features/ais-list/AisListPanel.svelte:63-67`.
- **What**: Both panels derive `vesselPosition` un-quantized, so the metric stage (rhumb distance
  and bearing for every mark, per the comment at `WaypointsPanel.svelte:83-85`) recomputes at 1
  Hz, and the full filter, sort, and slice follow.
- **Why**: Thousands of marks times rhumb math every second is real work on a Pi-class device,
  and the three sortable lists now behave inconsistently for no reason.
- **Fix**: Quantize the own position with `quantizeLatLonKey`/`parseLatLonKey` from `$shared/geo`
  in both panels, mirroring the AisListPanel pattern.
- **Verify**: Existing panel tests stay green; add a derived-stability assertion if the harness
  supports counting recomputations. Then `npm test`.

### M4. AIS list rebuilds rows and target views on every AIS-bearing frame

- **Location**: `src/features/ais-list/AisListPanel.svelte:72` (rows derive from
  `aisTargets.list()`), and `src/entities/ais/ais-targets.svelte.ts:132` (`list()` allocates a
  fresh view object per vessel per version; line 110 is inside the `current` closure, not the
  allocation).
- **What**: The store bumps `aisVersion` once per worker frame flush that carried at least one AIS
  context (`store.svelte.ts:154`), not once per delta: the worker batches on a 16 ms timer
  (`batcher.ts:20-28`), and an all-quiet frame does not bump. In busy water that still means up to
  about 60 rebuilds a second, each re-creating, re-filtering, and re-sorting the full list and
  allocating a fresh view per vessel. `list()` already memoizes on the version, so the waste is
  real churn, not repeated reads. Own-position jitter is already mitigated by the quantized key;
  target-driven churn is not.
- **Why**: In busy waters with hundreds of targets this is the hottest list path in the app.
- **Fix**: Two steps. In `AisTargets`, memoize view objects per vessel so unchanged vessels keep
  their identity. The memo key cannot be the vessel's epoch alone: `list()` also reads
  `this.#store.generation` (a reconnect invalidates every path) and applies clock-based freshness
  windows through `expiresAt`, so a view can legitimately change with no new data. Key on
  (generation, per-path epochs) and keep the existing `#cacheExpiresAt` boundary. In the panel,
  coalesce the version dependency to a bounded cadence (about 1 Hz) since the list is glanceable,
  not per-frame.
- **Verify**: `ais-targets` unit tests plus the AisListPanel tests; identity stability assertion
  for an unchanged vessel across a version bump. Then `npm test`.

### M5. Notifications mirror is unbounded upstream

- **Location**: `src/entities/notifications/notifications.svelte.ts:113-137` (`list()` sorts the
  full mirror per version and only slices the output), with the mirror in
  `src/shared/signalk/store.svelte.ts`.
- **What**: `MAX_ACTIVE_NOTIFICATIONS` caps the rendered list, but the underlying mirror accepts
  every distinct notification path the server raises in an alarm state, and `list()` sorts the
  whole set on every version bump.
- **Why**: A buggy or hostile server can grow memory and sort cost without bound. A normal server
  keeps this small, so medium.
- **Already handled, do not redo**: eviction of resolved notifications is implemented.
  `#mirrorNotification` (`store.svelte.ts:167-175`) deletes the entry for a cleared, normal, or
  nominal state rather than accumulating it, and an identical republish returns early without
  touching the map or bumping the version (`:176-208`). So the version bumps on real change only,
  and the "per-delta sort cost" framing overstates it: the cost is per real change.
- **Fix**: One thing remains. Cap the number of distinct raised paths (drop the lowest-severity or
  oldest beyond a documented cap) so a pathological producer cannot grow the mirror without bound.
  Keep the existing memoized `list()` and the existing eviction.
- **Verify**: Notifications store tests covering the cap and its eviction order; then `npm test`.

### M6. Track save closes the name dialog before the write resolves

- **Location**: `src/features/tracks/TracksPanel.svelte:114-119` (`confirmName` fires `onSave` or
  `onSaveAsRoute`, then clears `naming` synchronously). The correct pattern exists at
  `src/features/notes/personal-notes-controller.svelte.ts:97-103` (editor stays open on
  failure).
- **What**: The naming form closes immediately; a failed save loses the entered name.
- **Why**: The contract requires a failed modal write to preserve the dialog and its values.
- **Fix**: Clear `naming` only on success. Keep the form open with a busy state while the save is
  in flight and surface the failure in place, matching the personal notes flow.
- **Verify**: TracksPanel test: a rejected save keeps the naming form open with the entered value
  intact. Then `npm test`.

### M7. Route, waypoint, and track writes collapse 401/403 into a generic failure

- **Location**: `src/features/routing/routes-client.ts:46-56` (`saveRoute` returns a boolean),
  `src/features/waypoints/waypoints-client.ts:48`, and
  `src/features/tracks/tracks-client.ts:190`. The richer pattern exists at
  `src/features/notes/personal-notes-client.ts:20-27` (a `'ok' | 'access-denied' | ...` outcome)
  with the controller requesting write access while preserving the draft.
- **What**: A mid-session authorization loss (token revoked, session expired) surfaces as a
  generic failure toast. The notes flow instead detects `access-denied`, keeps the editor open,
  and starts the write-access request.
- **Why**: Inconsistent recovery UX across save flows, and the denied write is unrecoverable
  without retyping. Pre-gates on `auth.writeBlocked` cover only the known-state case.
- **Fix**: Return a mutation outcome from the three clients (mirroring `mutationResult`), and in
  each controller treat `access-denied` as the notes controller does: keep the draft, show the
  teach note, and call `requestWriteAccess`.
- **Verify**: Controller tests mirroring
  `personal-notes-controller.svelte.test.ts`'s "requests read/write access after a refused write
  without closing the editor". Then `npm test`.

### M8. Trends catalog derived re-evaluates on every stream delta

- **Location**: `src/features/trends/trends-controller.svelte.ts:101-115` (`itemFor` reads
  `deps.store.cell(candidate.path).epoch` inside the `catalog` and `selected` deriveds).
- **What**: `epoch` increments on every sample, so the whole catalog mapping re-runs several
  times a second while the panel is open, and every `TrendItem` gets a new identity each pass.
- **Why**: The `hasLiveReport` signal only needs the false-to-true transition; keying on the raw
  epoch pays full-catalog recomputation per delta for a boolean.
- **Fix**: Derive a per-path boolean (`epoch > 0`) so primitive equality stops downstream
  propagation, or track first-seen availability separately and read it in `itemFor`.
- **Verify**: `trends-controller.client.svelte.test.ts` stays green; add an assertion that an
  unchanged availability does not re-emit a new catalog identity. Then `npm test`.

### M9. `$effect` used to sync what is a pure derived

- **Location**: `src/app/notifications-controller.svelte.ts:146-163` (the
  `genericNotificationAlert` block with manual `lastGenericNotificationKey` tracking).
- **What**: The effect re-implements derived semantics by hand: it recomputes a string from
  `genericNotifications[0]` and guards propagation with a key comparison.
- **Why**: This is the project's own documented anti-pattern (write to `$state` in an `$effect`
  for a value that is a pure function of state). It is also fragile: any future early-return path
  can desynchronize the key.
- **Fix**: Replace with a `$derived.by` that returns the alert string (or `''`). The companion
  announcement block at `notifications-controller.svelte.ts:167-176` has genuine edge semantics;
  leave it.
- **Verify**: `notifications-controller.client.svelte.test.ts` stays green, then `npm test` and
  `npm run check`.

### M10. Weather field rendering resamples grids on the main thread with fresh buffers per call

- **Location**: `src/features/weather/field-rgba.ts:16-40`, `src/features/weather/wind-field-texture.ts:41-47`,
  and `src/features/weather/pressure-isobars.ts:66-68`.
- **What**: Each bracket change (time scrub, playback tick) iterates every grid cell into a newly
  allocated `Uint8ClampedArray`/`Float64Array` on the UI thread.
- **Why (as originally written)**: Thousands of cells of interpolation plus allocation per scrub
  frame is a frame-drop source during time playback on low-power devices.
- **Refuted on magnitude, no fix applied**: the grid is capped. The only production caller requests
  `{ maxCells: 200 }` (`widgets/weather-map/WeatherMap.svelte:285`), and `sampleGrid`
  (`entities/weather/weather-grid.ts:96-109`) holds `cols * rows` at or under that. So a scrub frame
  is about 200 iterations, and the allocations are roughly 800 bytes for the RGBA bitmap, 800 bytes
  for the wind texture, and 1.6 kB for the isobar field. Not thousands of cells, and not a
  frame-drop source. Buffer reuse here would trade real complexity (threading a caller-owned buffer
  through four modules, or a module-level cache that two overlays would race on) for a saving too
  small to measure. Revisit only if `maxCells` is ever raised by an order of magnitude, which is the
  condition that would make the original reasoning true.

### M11. Dynamic map overlays rebuild full FeatureCollections on every accepted refresh

- **Location**: `src/features/ais-layer/ais-vectors-overlay.ts:145-149`,
  `src/features/ais-layer/ais-overlay.ts:51-65`, and
  `src/features/lookout/collision-overlay.ts:109-113`.
- **What**: When a refresh is accepted, these overlays rebuild the entire
  `GeoJSON.FeatureCollection` and push it through `setSourceData`, which structured-clones the tree
  to the MapLibre worker.
- **Already handled, do not redo**: the "every tick" framing does not hold for the two AIS
  overlays. Both go through `createAisRefreshGate` (`ais-layer/ais-refresh.ts`), which holds
  version-only churn to a 1 Hz floor and paints immediately only on a rendered-count change, a
  clock-driven freshness expiry, or a forced severity flip. The overlay tick itself fires on every
  MapLibre `render` plus a 250 ms interval (`shared/map/overlay-tick.ts`), so the gate is what
  keeps that from being a per-frame rebuild.
- **What actually remains**:
  1. Even at the 1 Hz floor, each refresh clones the full traffic set. That is the real cost, and
     it is what the "steady per-second clone" note was describing.
  2. The collision overlay is the ungated one. Its guard is `contacts === lastContacts`
     (`collision-overlay.ts:111`), and `collision.assessment` is a `$derived` over
     `targets.version` plus the un-quantized own position (`entities/collision/collision.svelte.ts:201-218`),
     so it yields a fresh array per AIS frame and per own fix whenever any contact exists. The
     saving grace is size: only risk contacts are in it, not the full traffic set. Empty water is
     already identity-stable via the frozen `EMPTY_ASSESSMENT`.
- **Fix**: The deep-equality skip is worth doing, and the case it pays for is a night at anchor,
  where neighboring targets republish identical values. But note where that redundancy is born:
  `applyFrame` writes every AIS path unconditionally and bumps the version
  (`store.svelte.ts:143-154`), unlike `#mirrorNotification`, which returns early on a structurally
  identical republish. Fixing it at the store, so an identical AIS value does not bump the
  version, removes the churn for every AIS consumer at once instead of per overlay. Prefer that;
  fall back to the per-overlay deep-equality skip if the store-level compare proves too costly.
  Feature-id diff updates through `ensureGeoJsonSources`'s `updateData` path are a later option.
- **Verify**: Overlay unit tests; identity check that an unchanged traffic set does not call
  `setData`; a store test that an identical AIS republish leaves `aisVersion` unchanged. Then
  `npm test`.
- **Outcome**: the store-level fix was applied and the per-overlay deep-equality fallback was not
  needed. `applyFrame` now compares each incoming AIS value against the mirrored one and bumps
  `aisVersion` only on a real change, so a fleet at anchor republishing identical fixes no longer
  wakes the list, the collision assessment, or the traffic overlays at all. Freshness still advances
  on an identical republish, so nothing ages out early. The residual case (a name change re-pushing
  identical vector geometry) is bounded by the existing 1 Hz gate and is not worth a second layer of
  comparison.

### M12. Cross-feature coupling where an entities-level registry belongs

- **Location**: `src/features/prewarm/source-summary.ts:8-12` (imports source definitions from
  five sibling features), `src/features/routing/route-controller.svelte.ts:6` (`trackToRoute`
  from `$features/track-layer`), and `src/features/tracks/track-controller.svelte.ts:2`
  (`SavedTracksSource` from `$features/track-layer`).
- **What**: All imports go through public barrels, so `npm run cruise` passes, but the documented
  design rule is that cross-feature data flows through an entities store. Prewarm's five-feature
  fan-out is the strongest signal the abstraction is missing.
- **Why**: The chart-source catalog (and the track-to-route conversion) now changes in five
  places for one conceptual edit, and every new overlay feature must remember to register itself
  with prewarm.
- **Fix**: Introduce an entities-level chart-source registry (candidate: `$entities/charts`) that
  owns `BOUNDARY_SOURCES`, `STREAMING_CHART_SOURCES`, `MPA_SOURCES`, `SEAMARK_SOURCES`, and the
  category metadata, and have both the features and prewarm consume it. Move `trackToRoute` and
  `SavedTracksSource` to `$entities/track`, or explicitly sanction barrel-shared pure functions in
  `AGENTS.md`.
- **Verify**: `npm run cruise`, `npm run deadcode`, then `npm run verify`.
- **Outcome, partial and deliberately so**:
  - The two track imports are gone. `trackToRoute`, its `douglasPeucker` helper, and the
    `SavedTracksSource` contract now live in `$entities/track`, beside the track geometry that was
    already there (`latestTrackSegment`, `splitAtGaps`). The routing and tracks controllers reach
    them downward through the entity, not sideways through another feature.
  - **The prewarm fan-out was left in place.** It is still four feature barrels plus the
    layers-panel category metadata, but the drift this finding was really about is already gone:
    `catalogSource` (`shared/map/raster-overlay.ts`) made the shared catalog the single home for
    every upstream fact, so what each feature still declares is its own plain-language description,
    region tag, and panel category. That copy belongs with the feature that renders it, not in an
    entities registry, and moving it there to satisfy an import-shape rule would trade a real
    ownership boundary for a cosmetic one. What remains worth doing, if prewarm grows again, is
    injecting the assembled source list from the composition root rather than having prewarm import
    it; that is a wiring change, not a registry.

### M13. PMTiles archive unregistration is not reference counted

- **Location**: `src/shared/map/pmtiles.ts:358-368` (`unregisterPmtilesArchive` deletes by URL
  unconditionally and purges the block cache), while registration dedupes by URL at
  `src/shared/map/pmtiles.ts:344-350`. Called from `remove` at
  `src/shared/map/chart-overlay.ts:208-212`.
- **What**: Two chart entries can reference the same PMTiles URL (a user-added chart duplicating
  a server-discovered one; only duplicate ids are rejected, not duplicate URLs). Removing one
  entry unregisters the shared archive and purges its cached blocks, breaking tile fetches for
  the survivor until it re-registers.
- **Why**: An edge case, but a real data bug when it happens: the surviving chart silently loses
  tiles.
- **Fix**: Reference count registrations per URL; unregister and purge only when the count
  reaches zero.
- **Verify**: pmtiles tests: register two charts on one URL, remove one, assert the archive and
  its blocks remain. Then `npm test`.

### M14. Unglossed acronyms on the navigation and collision strips

- **Location**: `src/features/navigation/NavStrip.svelte:148-169` (DTW, BTW, XTE, VMG, TTG, RTE,
  and ETA render with no `title` gloss), and `src/features/lookout/DangerStrip.svelte:72-73` (CPA
  and TCPA bare). The status strip shows the intended pattern (`StatusStrip.svelte:125-155`:
  `title="Speed over ground"`, `title="Course over ground"`, `title="Heading, true"`).
- **What**: Two safety-adjacent strips show bare jargon acronyms while the sibling strip glosses
  the same class of terms.
- **Why**: The copy standard requires every acronym to be glossed for navigators with minimal
  chartplotting knowledge, and the strip family should read as one hand.
- **Fix**: Add `title` glosses in the established voice: "Distance to waypoint", "Bearing to
  waypoint, degrees true", "Cross-track error", "Velocity made good toward the waypoint", "Time
  to go", "Route", "Estimated time of arrival", "Closest pass", and "Time to closest pass".
  Adjust to match any existing glossary first.
- **Verify**: Strip component tests assert the titles; a repo grep for the bare acronyms in
  markup returns no new unglossed sites. Then `npm test`.

### M15. `.alert-note` and live-region role pairings drift

- **Location**: `src/features/ais-list/AisTargetDetail.svelte:36` and
  `src/features/ais-list/AisTargetDetail.svelte:40` (`.alert-note` with `role="status"`),
  `src/features/layers-panel/SourceDetail.svelte:395-398` (`.alert-note` with `role="status"` on
  a blocking-prerequisite note), and `src/views/plotter/PlotterView.svelte:770` (the general toast
  banner carries `.alert-note alert-note--filled` with `role="status"`).
- **What**: The pairing rule is `.alert-note` with `role="alert"`, `.muted-note` with
  `role="status"` when a polite announcement is wanted. These four sites mix the visual alarm
  voice with the polite live region. `ChartSourceReview.svelte:64` is a borderline case (the
  `alert-note` class is conditional on an active sharing choice); judge it during the fix.
- **Why**: Assistive technology users hear a collision-risk banner as background status while
  sighted users see an alarm.
- **Correction to the toast claim**: the top banner stack holds two banners, not one. The
  critical-overlay-error banner at `PlotterView.svelte:762` already pairs `.alert-note--filled`
  with `role="alert"` correctly. Only the general toast at `:770` is styled as an alert and
  announced politely. So the problem is narrower than "announces none as one": the severity split
  already exists in the markup and simply does not reach the shared toast channel, which carries
  everything from "Could not save the track" to informational confirmations under one role.
- **Fix**: Pair each case correctly. Safety state (the AIS detail banners) gets `role="alert"`.
  The SourceDetail prerequisite reads as teaching: demote to `.muted-note` keeping
  `role="status"`. For the toast, type the toast helper by severity so error toasts render
  `.alert-note` with `role="alert"` and informational toasts use a neutral style with
  `role="status"`.
- **Verify**: Component tests for the panels; the axe E2E (`npm run test:e2e` includes
  accessibility scans) stays green. Then `npm test`.
- **Outcome, with two judgment calls**:
  - The AIS detail banners became `role="alert"` and the SourceDetail prerequisite became
    `.muted-note`, as prescribed.
  - **The toast was not typed by severity.** Every message the channel currently carries is a
    failure: a refused write, an action that could not start, or a limit that was hit (22 call
    sites, all of that shape). So the banner is simply announced as the alert it already looks
    like, and `Toast` now documents that it is a failure channel, with the note that an
    informational message would need a severity and a matching role before it could be added.
    Adding an unused severity axis first would have been speculative.
  - **`ChartSourceReview.svelte:64` was deliberately left as is.** It is a consequence note for a
    checkbox the navigator is holding, in a form they are focused on, not server-raised state.
    `role="alert"` there would interrupt on every toggle of that checkbox, which is worse for
    exactly the users the pairing rule protects. The visual emphasis is right and the polite
    announcement is right; the rule is about system-raised state.

---

## Low

### H4. LayerManager persists unlisted overlay ids into profile settings

*Originally graded high. Regraded to low: the user-facing half of the claim did not survive
verification, and what remains is persisted-state hygiene.*

- **Location**: `src/shared/map/layer-manager.ts:467-474` (`#persist` snapshots every entry in
  `#state`; `#addModule` registers every module into `#state` at `:264`). Three registered ids
  carry `listed: false`: `time-travel-marker` and `time-travel-track`
  (`features/time-travel/time-travel-overlay.ts:48` and `:123`), plus `measure`
  (`features/measure/measure-overlay-proxy.ts:23`, whose lazily loaded delegate repeats the flag at
  `features/measure/measure-overlay.ts:156` but is never registered separately). The original write
  named only the time-travel pair, so the measure id would have been left behind by its fix.
- **What**: These are not registered on demand. `build-overlays.ts:116-141` builds every overlay
  once at map construction, so they live in `#state` for the map's whole lifetime and every
  `#persist` call includes them, whether or not a review or a measurement is in progress. That
  makes the persisted `LayerSettings` snapshot, and the profile document that carries it, always
  hold three junk keys. `#persist` fires from `setVisible` (`:406`), `setOpacity` (`:415`),
  `remove` (`:350`), and `applySnapshot` (`:463`), and `applySnapshot` runs at startup, so the
  keys are written on a first run with no user action at all.
- **What the original claim got wrong**: "Toggling any layer while a time-travel review is active
  writes..." implied the pollution is conditional on the review. It is unconditional. The design
  contract it cited (`docs/design-system.md:388-389`, "Its temporary track and vessel dimming must
  not write to the profile-owned layer manager") is about the review dimming the vessel by
  mutating a persisted layer's opacity, and the implementation already honors that by using
  separate overlays instead. Round-tripping the junk keys is also harmless in practice: nothing
  can toggle an unlisted module from the UI, `time-travel-marker` declares
  `supportsOpacity: false`, and the restored values therefore equal the defaults.
- **Why**: Junk keys in a document that merges across devices through the profile, and a snapshot
  that misrepresents what is user-owned state.
- **Fix**: Skip modules with `listed === false` in `#persist` (or add an explicit `transient` flag
  on `OverlayModule` and skip those). Apply the same filter in `applySnapshot` so an existing
  polluted snapshot cannot reapply transient ids.
- **Verify**: Layer manager tests: register a `listed: false` module, toggle a listed layer, and
  assert the persisted snapshot excludes the transient id. Run `npm test`.

### L1. Working route overlay has no teardown method

- **Location**: `src/features/route-layer/working-route-overlay.ts:43-55` (the interface has
  `add`, `sync`, `setTheme`, `raise`, and `hitTestWaypoint`, but no `remove`; the file contains no
  `remove` at all).
- **Why**: Deliberate today (ChartCanvas owns the map lifecycle and `add` is idempotent), but any
  future detach-without-destroy path leaves zombie sources and layers.
- **Fix**: Add `remove(ctx)` calling `removeLayersAndSources(ctx.map, LAYERS, [WPT_SRC,
  HL_SEG_SRC, HL_DOT_SRC])`.
- **Verify**: Route-layer overlay tests, then `npm test`.

### L2. Local `isRecord` in reconcile omits the array exclusion

- **Location**: `src/shared/signalk/reconcile.ts:18-20` versus the shared
  `isRecord` in `$shared/lib/object`.
- **Why**: Arrays pass the local guard; the shared helper already encodes the stricter rule.
- **Fix**: Import and use the shared `isRecord`.
- **Verify**: Reconcile tests, then `npm test`.

### L3. `runTransaction` accepts an async callback its catch cannot see

- **Location**: `src/shared/storage/idb.ts:30-52`. All current callers are synchronous (verified
  across `src/shared/map/block-store.ts`, the only consumer: five call sites, all plain `(tx) =>`
  arrows).
- **Note on the failure mode**: the rejection does reach the caller, since the outer `async`
  function returns the inner promise. What it escapes is the `try/catch`, so `tx.abort()` never
  runs, and the transaction auto-commits before the async work finishes.
- **Why**: A future async callback would auto-commit the transaction and its rejection would
  escape the `try/catch`. Type-level hardening only.
- **Fix**: Constrain the signature (for example `Exclude<T, Promise<unknown>>` on the callback
  return), or add a runtime guard that throws on a thenable result.
- **Verify**: Storage tests plus `npm run check`.

### L4. Path metadata cache has no eviction bound

- **Location**: `src/shared/signalk/path-meta-cache.svelte.ts:18`.
- **Why**: Session-scoped and in practice bounded by the server's distinct path count, but there
  is no enforced cap if the cache is ever used with per-vessel (AIS context) paths.
- **Fix**: Swap the two `Map`s for the existing `MemoryCache` with a documented `maxEntries`.
- **Verify**: Cache tests, then `npm test`.

### L5. `AuthController.upgradeClientId` is a non-reactive getter

- **Location**: `src/shared/signalk/auth.svelte.ts:161` (plain private field) read through the
  getter at `src/shared/signalk/auth.svelte.ts:220-222`.
- **Why**: Today every write is paired with a reactive sibling (`upgrading`,
  `upgradeOutcome`), so the UI updates incidentally. A later code path that changes one without
  the other goes silently stale.
- **Fix**: Make the field `$state`.
- **Verify**: Auth tests plus the auth banner component test, then `npm test`.

### L6. Unsanctioned off-scale literal in `.menu-item`

- **Location**: `src/styles/overlays.css:76` (`padding: 0 0.7rem`).
- **Why**: `0.7rem` is outside the sanctioned off-scale literals; the spacing rhythm should come
  from tokens.
- **Fix**: Use the nearest spacing token.
- **Verify**: Visual check of the menu row; `npm run lint`.

### L7. Status strip position readout breaks the one-span idiom

- **Location**: `src/app/StatusStrip.svelte:160-162` (the "Vessel" label and the two coordinate
  values live in three separate `.readout` spans; siblings keep label and value in one span).
  Lines 163-165 are the Time readout, which already follows the idiom.
- **Why**: The strip's documented idiom is a bare-word label followed by the `.num` value in one
  readout span.
- **Fix**: Consolidate into the idiom, keeping the grid layout working at all breakpoints.
- **Verify**: `StatusStrip.svelte.test.ts`, then `npm test`.

### L8. Per-frame object spread in the stream callback

- **Location**: `src/app/App.svelte:1892-1897` (`store.applyFrame({ ...frame, generation })`).
- **Why**: Frame-rate, not delta-rate, so the cost is small; still an avoidable allocation on a
  documented hot path, and the frame is a fresh structured-clone the caller owns.
- **Fix**: Assign `frame.generation` directly before `applyFrame`.
- **Verify**: `stream-controller.client.svelte.test.ts`, then `npm test`.

### L9. Sparkline ring buffers use deep reactive proxies

- **Location**: `src/features/instruments/tile-history.svelte.ts:22`.
- **Why**: Sampling is throttled to one write per 5 seconds per tile with capacity 60, so the
  proxy overhead is negligible today; `$state.raw` plus a version counter is strictly cheaper if
  the cadence ever rises.
- **Fix**: Optional. Convert buffers to `$state.raw` with a bump counter, or leave with a comment
  noting the throttle assumption.
- **Verify**: Instruments tests, then `npm test`.

### L10. Trend chart redraws on array identity even when values are unchanged

- **Location**: `src/features/trends/TrendChart.svelte:81` (the `setData` effect) fed by
  `src/features/trends/TrendCharts.svelte:44-52` (`.map` allocates per recompute).
- **Why**: Bounded by the 30-second recorder cadence and user interaction, so the cost is low;
  a value-equality guard removes the redundant uPlot redraws.
- **Fix**: Skip `setData` when times and values are element-wise unchanged.
- **Verify**: Trends client tests, then `npm test`.

### L12. Great-circle cross-track reference uses a small-angle shortcut

- **Location**: `src/shared/nav/route-geometry.ts:54` (`(d13 / EARTH_RADIUS_M)` where the exact
  form is `Math.sin(d13 / EARTH_RADIUS_M)`).
- **Why**: The function is a test-only cross-check for the rhumb production path, and the error
  is negligible at marine distances, so this is mathematical hygiene, not a live bug.
- **Fix**: Wrap the distance term in `Math.sin`.
- **Verify**: `route-geometry` tests, then `npm test`.

### L13. Tests hardcode Signal K path strings

- **Location**: `src/app/StatusStrip.svelte.test.ts:61` and sibling test files using literals
  like `'environment.depth.belowTransducer'`.
- **Why (as originally written)**: Production code reads `SK_PATHS`; test literals drift silently
  when a path changes.
- **Refuted, no fix applied**: nothing drifts silently here, and the literal is doing real work.
  These literals are test *inputs*: the test feeds a frame keyed by the wire path and asserts what
  the component rendered, while the component reads through `SK_PATHS`. If `SK_PATHS` were changed,
  the component would read a path the frame never carried and the assertion would fail loudly. That
  is the opposite of silent drift, and it is what makes the test an end-to-end pin of the Signal K
  path rather than a tautology. Importing `SK_PATHS` into the test would remove that pin: both sides
  would move together and a wrong path would keep passing, which for a project holding itself to
  Signal K conformance is a real loss.

### L14. Local fetch stubs duplicate the shared testing helper

- **Correction**: the shared helper already exists. `src/shared/testing/fetch-stub.ts` exports
  `stubFetch` (alongside `jsonResponse` and `expectBearerAuth`) and is re-exported from
  `src/shared/testing/index.ts:5`. The fix is adoption, not creation. The duplication count was
  also wrong: three files, not five, and the three are not near-identical.
- **Location and shape of each copy**:
  - `src/features/anchor-watch/anchor-api-client.test.ts:13` and
    `src/features/anchor-watch/anchor-client.test.ts:12`: local
    `stubFetch(response: { ok: boolean } | 'reject')`. These two are a direct subset of the shared
    helper and can adopt it as is.
  - `src/features/anchor-watch/anchor-transport.test.ts:8`: local
    `stubFetch(okFor: (url: string) => boolean)`. Different contract, since it routes the answer by
    URL. The shared helper ignores the URL entirely, so this one needs the shared helper extended
    with an optional URL predicate before it can adopt it.
  - `src/features/tides/coops-client.test.ts:10` and
    `src/features/tides/signalk-tides-client.test.ts:6`: a differently named and differently shaped
    `mockFetch(json, ok, status)`. Adoptable, but it is a rename plus a signature change at every
    call site, not a lift.
- **Why**: The hoist-at-second-copy rule applies to test harnesses, and the destination already
  exists, so these are copies that outlived their reason.
- **Fix**: Adopt the shared `stubFetch` in the two anchor client tests first (free). Then either
  extend the shared helper with a URL predicate and adopt it in `anchor-transport.test.ts`, or
  leave that one with a one-line comment naming why its contract differs. Convert the two tides
  tests last, since that is the only churn-heavy step.
- **Verify**: `npm test`.

### L15. Biome accessibility rules are disabled for all Svelte files with no documented rationale

- **Location**: `biome.json:36-56` (`useValidAriaValues`, `useSemanticElements`, and
  `noLabelWithoutControl` off for `**/*.svelte`).
- **Why**: Likely deliberate (Biome's Svelte support is partial and `@axe-core/playwright`
  covers runtime accessibility in E2E), but the reasoning is unrecorded, so a future editor
  cannot tell intentional from accidental.
- **Fix**: Record the rationale (a short note in `AGENTS.md` or the contributing docs), and
  narrow the override if specific rules are actually clean.
- **Verify**: `npm run lint` and the axe E2E gate.

### L16. POI `skIcon` classification cache is unbounded with externally supplied keys

- **Location**: `src/entities/poi-icons/poi-categories.ts:158-173` (module-level `SKICON_CACHE`,
  no cap), fed by provider-controlled strings at `src/features/notes/notes-client.ts:88`. Each key
  is bounded to 256 characters by `clean`, but the number of distinct keys is not bounded.
- **Why**: The comment claims the cache is bounded by the small set of provider icon names, but
  nothing enforces it; a buggy or hostile provider grows the map for the session.
- **Fix**: Cap with oldest-first eviction (the `MemoryCache` pattern).
- **Verify**: poi-icons tests including an eviction case, then `npm test`.

### L18. Route editor lacks a defensive working-route guard

- **Location**: `src/features/routing/route-controller.svelte.ts:184-201` (`beginNewRoute` calls
  `routeStore.setWorking` unconditionally). Both callers are gated today, each in a different
  place: `RoutesPanel.svelte:248` disables New route while `working` is set, and the chart
  context menu's "Start a route here" (`App.svelte:1731`) is unreachable during an edit because
  `ChartCanvas.svelte:352` suppresses the entire context menu while `routeStore.working` is set.
- **Why**: The invariant is currently enforced twice, in two widgets, by two different mechanisms,
  and not at all in the controller that owns it. A third caller, or a change to the context-menu
  suppression, silently discards an in-progress edit. Controller-level defense keeps the invariant
  in one place.
- **Fix**: Refuse or arm a discard confirm when `routeStore.working` is set.
- **Verify**: `route-controller.svelte.test.ts` with a working-route case, then `npm test`.

### L19. Panel wiring prop-drills dozens of controller members

- **Location**: `src/views/plotter/PlotterView.svelte:905-1000` (long per-panel prop blocks).
- **Why**: Every new panel capability touches three files (controller, view wiring, panel). A
  data-driven registry or passing controller facades would centralize it; the explicit-props
  style is more testable, so this is a judgment call, not a defect.
- **Fix**: Optional. If the wiring keeps growing, introduce a typed panel-registry entry per
  panel (component plus props factory) so the view iterates a table.
- **Verify**: `npm run check` and existing panel tests after any refactor.
- **Outcome: left as is, deliberately.** The finding calls this a judgment call rather than a
  defect, and the judgment did not change on a second look: explicit props are what make each panel
  independently testable, and a registry would trade that for a table whose entries are harder to
  type and to read. Revisit if the wiring grows another panel or two, not before.

---

## Cross-cutting themes

1. **Rebuild churn on hot reactive paths** (M3, M4, M8, M10, M11, and the L8-L10 minors). The
   codebase already owns the mitigation idioms: quantize the input (`AisListPanel`'s own-cell key),
   memoize per key, gate propagation on primitive equality, skip identical values at the store
   (`#mirrorNotification`), and throttle a rendered refresh (`createAisRefreshGate`). The findings
   are the places those idioms were not applied. Fix them as one themed batch so the pattern stays
   recognizable. Note the ordering dependency: the store-level identical-value skip proposed in M11
   would also reduce the input rate M4 is coalescing, so do M11's store change first and re-measure
   before tuning M4's cadence.
2. **Keep accepted data visible** (M2, M6, M7). Three panels touch the same recovery contract from
   different sides. The personal-notes flow is the reference implementation; align the others to
   it. (H1 was the fourth member of this group and was refuted.)
3. **Persisted-state discipline** (H4, H5, L4, L16). Unlisted overlay ids, non-SI units, and
   unbounded caches all leak into places with a documented owner. Each fix is small; together they
   restore the storage-key registry as the single source of truth. (L17 was the fourth member and
   was refuted: there are no stray build artifacts in version control.)
4. **Copy and accessibility polish** (M14, M15, L6, L7). One family: acronym glosses, note-class
   and role pairing, one token literal, and one strip idiom. A single sweep commit can take all
   of them with the design-system document open. For M14, note that `title` on a `<span>` is the
   established sibling pattern (`StatusStrip.svelte:124-156`) but is hover-only and unreliably
   announced; match the siblings for consistency now, and treat a gloss mechanism that works under
   touch and assistive technology as its own follow-up rather than diverging one strip.

## Checked and dismissed

These claims were raised during the audit and verified false, so they are recorded here to
prevent re-litigation. No action needed.

### Refuted on the second pass

These three shipped in the first draft as actionable findings and did not survive re-verification.
They keep their ids so any notes taken against the first draft still resolve.

- **H1 (was high): "Weather conditions retry wipes accepted data."** The retry path does call
  `clearForRequest`, but there is never accepted data to wipe when it runs. The Retry button is
  rendered only inside `{#if loadError}` (`WeatherConditions.svelte:331-334`), `loadError` is
  assigned in exactly one place (the `catch` in `loadProvider`, `:191`), and every call to
  `loadProvider` is preceded by a `clearForRequest` that already emptied `obsData`, `seriesData`,
  and `warnings`. A thrown load is therefore always a load whose start had already blanked the
  panel, so by the time Retry exists the state it "wipes" is the cleared state. `refreshWarnings`
  never sets `loadError`, and a partial result (`observationStatus === 'failure'` with a good
  forecast series) does not throw, so it shows no Retry button. The clear on a position or
  provider change is correct on its own terms: that data belongs to a different position.
  Re-calling `clearForRequest` from Retry is a no-op plus the sequence-guard bumps it genuinely
  needs.
- **L11 (was low): "Overlays empty sources before removing them."** Both halves are wrong. No
  route-layer overlay empties a source before removing it: `course-overlay.ts:169-170` and
  `route-overlay.ts:121-122` call `removeLayersAndSources` directly. The two
  `emptyFeatureCollection` calls in that slice are inactive-state blanking inside `sync`
  (`course-overlay.ts:47-57`, reached at `:110` and `:116` when the course goes inactive or the fix
  goes stale, and `working-route-overlay.ts:140-144` when the working route is cleared), which is
  the rendering doing its job. And all three overlays already use the batch helper:
  `course-overlay.ts:74`, `route-overlay.ts:60`, and `working-route-overlay.ts:81` each call
  `ensureGeoJsonSources`.
- **L17 (was low): "Built service worker artifacts are committed into `public/`."** All three
  sub-claims are wrong. `public/` is git-ignored (`.gitignore:6`) and `git ls-files public/`
  returns zero tracked files, so nothing is committed. The build output directory *is* `public/`,
  not `dist/` (`vite.config.ts:84`), with `emptyOutDir: true`, so every build wipes the directory
  and no stale artifact can survive, let alone ship. Source maps are deliberate
  (`sourcemap: 'hidden'`, with the reasoning recorded in the config) and are explicitly excluded
  from the npm tarball by `"!public/**/*.map"` in `package.json:65`. The proposed verification
  (inspect `dist/` after a build) would have found an empty directory.

### Dismissed during the original audit

- `maplibregl.addProtocol('pmtiles', protocol.tile)` losing `this`: the pmtiles `Protocol`
  instance holds `tile` as a bound own property (runtime-checked).
- Missing S-52/OpenBridge symbol pipeline: deliberately deferred ("That pipeline is a later
  spec" in `docs/design-system.md`).
- Missing device-local alarm mute: implemented as "Mute here" in
  `src/features/lookout/AlarmStrip.svelte:100` with tests.
- Missing safety-feature tests: anchor-watch, lookout, mob, and the collision and anchor
  entities are all covered (22 test files across those directories).
- `tsgo` in the check script is a typo: it is the deliberate TypeScript native preview
  (`@typescript/native-preview`).
- The 240 kB MapLibre size-limit budget is unrealistic: it is in range for the gzipped main
  chunk, and `npm run size` is in the release gate.
- Radar buffer recycle errors are swallowed: `radar-worker-client.ts:57-63` logs a warning
  unconditionally by design.
- Note and waypoint dialogs can be silently erased by a chart tap: both are native top-layer
  `showModal()` dialogs that block chart interaction.
- The reconcile hot path over-allocates via `trim()`: the bounding contract is deliberate and
  the module documents the allocation discipline.
- The toolbar editor grip misses `touch-action: none`: covered by `.reorder-row .handle` in
  `src/styles/reorder.css:33-38`.
- Profile sanitization leaks unknown keys: extension keys are a deliberate, bounded
  forward-compat mechanism with per-field merge clocks (`profiles-store.svelte.ts:297-323`).
- `.card-stats` rows skew without an empty unit span: `.card-stats` is a flex-wrap inline
  family, not the three-column `.stat-grid`; no skew.
- `RadarControls.svelte` raw range and text inputs bypass the primitives: the label-on-top
  radar field pattern with `class="input"` and `class="range"` is the documented form for
  provider-defined controls.
- `ChartsManagementPanel.svelte` Bounds row misses its empty unit span: present at line 172.
- `LayerToggle` without `description` in TrendsCustomize and InstrumentsCustomize: both pass
  `description` (`TrendsCustomize.svelte:75`, `InstrumentsCustomize.svelte:97`).
- SOG, COG, HDG, CPA, and TCPA glosses missing in StatusStrip and AisListPanel: titles are
  present there; the genuinely bare sites are the NavStrip and DangerStrip (M14).
- `window.addEventListener('keydown', ...)` at `App.svelte:1975` bypasses the dismiss stack:
  it is the sanctioned alarm-audio priming listener.
- `.env` hygiene: the file is git-ignored and untracked.
- `download.ts`'s `URL.createObjectURL` guard is unreachable: it fires in jsdom, which lacks
  the function.
- `custom-layer.ts` fails to guard arrays before casting: arrays return at line 9.
- `docs/menu-items.md` drift: all current menu labels are documented.

## Suggested batch order

1. H2, H3, H5 (correctness, one focused commit each). H3 is two commits, not one: the coverage
   comparison space and the wire bbox are separate changes with separate tests, and the second
   needs the provider's seam behavior confirmed first.
2. M1, M2 (radar robustness), M13 (shared-archive correctness).
3. M11's store-level identical-value skip first, then M3, M4, M8, M10, and M11's overlay follow-up
   (the rebuild-churn theme, in that order so the cadence work is measured against the reduced
   input rate).
4. M6, M7 (save-flow recovery, notes pattern). M6 is not panel-local: `onSave` and `onSaveAsRoute`
   are typed `(name: string) => void` (`TracksPanel.svelte:47-49`) and the controller reports
   failure through a toast, so keeping the form open requires the callback contract to return an
   outcome. Sequence it with M7, which changes the same class of contract.
5. M14, M15, L6, L7 (copy and accessibility sweep).
6. M5, M9, M12, H4, and the remaining lows.
7. Final gate: `npm run verify`.
