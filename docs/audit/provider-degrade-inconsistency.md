# Audit: provider-absence and degrade-path inconsistency

Scope: every optional-provider and write-gated feature in the Binnacle chartplotter,
compared pair-wise against the canonical detect-and-degrade contract in CLAUDE.md
("Leverage mature plugins", "Plugin assumptions, caching, and coherence", "Server APIs
over local-only storage") and docs/design-system.md sections 8 and 9, as operationalized by
docs/building-menu-items.md.

The canonical degrade pattern is `navigation.closestApproach`: read the server value when a
provider populates it, compute client-side when absent, and tell the user which source is
live. The canonical menu-surface pattern is `MenuItem.available: false` plus
`unavailableHint` (grayed with tooltip and screen-reader text) for a capability whose
provider is absent, distinct from `disabled` plus `disabledLabel` for a transient block.

## Findings

### 1. Write-path teach-note divergence: companion panels teach, core write panels do not

**summary**: The ChartsManagement and Regions panels guard `auth.writeBlocked` with disabled
controls and a per-panel `<p class="muted-note">A write token is needed to ...</p>` teach
note, while their sibling write panels (Routes, Waypoints, Tracks, Anchor, Alarms, Profiles)
leave controls interactive, surface only a generic post-failure error, and never tell the
navigator that read-write approval is the fix.

**reference**:
- `src/features/charts-management/ChartsManagementPanel.svelte:95` (`{#if auth.writeBlocked}`
  with "A write token is needed to edit chart names and descriptions. Request a read/write
  token to continue.")
- `src/features/prewarm/RegionsPanel.svelte:530` (`{#if auth.writeBlocked}` with "A write
  token is needed to download charts. Request a read/write token to continue.")
- `src/features/marine-radar/RadarControls.svelte:211` (`{#if store.controlsForbidden}` with
  "Radar needs read-write access. Approve Binnacle for read and write in the Signal K
  server's access requests, then reconnect.")

**divergent**:
- `src/features/routing/RoutesPanel.svelte` (no `auth` prop; the panel receives only
  `error: string | undefined` at line 42, surfaced as a generic alert-note at line 147).
  The controller flags generic errors like "Could not save the route. It is kept under edit
  so you can retry." (`route-controller.svelte.ts:129`) without ever mentioning read-write
  access.
- `src/features/waypoints/WaypointsPanel.svelte` (no `auth` prop; `error` at line 32,
  generic alert-note only).
- `src/features/tracks/TracksPanel.svelte` (no `auth` prop; `error` at line 56).
- `src/features/anchor-watch/AnchorPanel.svelte` (no `auth` prop; `error` at line 85 as
  `anchorController.anchorError`). The controller surfaces "Could not drop the anchor on the
  server. Check the connection." (`anchor-controller.svelte.ts:107`) when the standard API
  refuses, without mentioning read-write access.
- `src/features/lookout/AlarmsPanel.svelte` (no `auth` prop; `error` at line 38). The
  silence and acknowledge handlers surface "Could not silence the alert. Check the connection
  and access." (`App.svelte:258`), which hints at "access" but does not follow the
  "A write token is needed to ..." teach-note pattern.
- `src/features/profiles/ProfilesPanel.svelte` (no `auth` prop). When the read-only token
  can load `applicationData` but not write it, `syncWithServer` attaches the adapter
  (`profiles-store.svelte.ts:142`), subsequent `save` calls 401 via `postResource`, and the
  failure is swallowed silently (`signalk-adapter.ts:52` returns `false`). The navigator is
  never told that read-write approval is needed.

**shared fix**: Thread the `auth` controller (or at least a `writeBlocked: () => boolean`
getter) into each core write panel, and render the standard `<p class="muted-note">A write
token is needed to ...</p>` teach note when `auth.writeBlocked` is true, matching the
ChartsManagement and Regions panels. The building guide
(`docs/building-menu-items.md` section 2, step 2) documents this as the panel-level pattern:
"a write-gate teach note as `<p class="muted-note">A write token is needed to ...</p>` when
`auth.writeBlocked`." The global `AuthBanner` (`src/features/auth-banner/AuthBanner.svelte:37`)
already shows the banner app-wide, but the per-panel teach note is the documented contract
and is what the companion panels already follow.

**severity**: user-visible on a stock server. A first-run user who approves read-only access
(a common default) can save routes, waypoints, tracks, and alarms from the core panels, watch
them fail with a generic "Check the connection" error, and never learn that the fix is a
read-write token. The companion panels teach this in one line; the core panels do not.

### 2. Track history layer `available` check tests the wrong condition

**summary**: The track-history overlay layer row reports itself as available on a stock
server (where `fetchHistoryProviders` returns `{ ids: [] }`) because its `available` getter
tests `providers() !== undefined` rather than `providers()?.ids.length > 0`, so the row
appears interactive with no gray-out and no `unavailableHint`, while its sibling features
that share the same history-provider dependency (time-travel, trends) correctly check
`ids.length` and degrade to an honest empty state.

**reference**:
- `src/features/time-travel/time-travel-store.svelte.ts:69` (`if (!providers ||
  providers.ids.length === 0) { this.status = 'no-provider'; }`)
- `src/features/trends/TrendsPanel.svelte:24` (`const hasProvider = $derived((providers?.ids.length
  ?? 0) > 0)`)
- `src/features/ais-layer/ais-trails-overlay.ts:111` (`unavailableHint: 'AIS trails need the
  signalk-tracks history plugin running on the server.'` with `available: isAvailable` wired
  from `serverFeatures?.plugins.has('tracks') ?? false` at `PlotterView.svelte:304`)

**divergent**: `src/features/track-layer/history-track-overlay.ts:114`
(`available: () => providers() !== undefined`). On a stock server,
`fetchHistoryProviders` (`src/shared/signalk/history-client.ts:56`) returns `{ ids: [] }`
(truthy, not `undefined`), so the layer row is not grayed. But the overlay's own `refresh`
method guards on `!known || known.ids.length === 0` (line 96) and returns early, so the layer
renders nothing and gives no hint. The `unavailableHint` ("Track history needs a Signal K
history provider plugin on the server.") is defined but never shown because `available`
returns `true`.

**shared fix**: Change the `available` getter to `() => (providers()?.ids.length ?? 0) > 0`,
matching the time-travel and trends checks. When the providers object resolves but has no
ids, the layer row will gray with the existing `unavailableHint`, consistent with the AIS
trails overlay's treatment of its absent `tracks` plugin.

**severity**: user-visible on a stock server. A first-run user sees "Track history (24 h)"
in the Layers panel as an available, toggleable layer. Toggling it on produces no line and
no explanation, reading as broken.

### 3. Replay menu item is always available where Radar grays with hint

**summary**: The Radar menu item sets `available: false` with `unavailableHint` when no radar
is detected, graying it with a tooltip per the design-system contract, while the Replay
(time-travel) menu item, which depends on an equally optional history-provider plugin with no
client-side fallback, is always available and shows its no-provider state only after the
navigator enters the mode.

**reference**:
- `src/app/App.svelte:945` (`available: marineRadar.store.hasRadar`,
  `unavailableHint: RADAR_UNAVAILABLE_HINT`)
- `docs/design-system.md` section 8: "A capability whose provider is absent sets `available:
  false` with an `unavailableHint` on its MenuItem (the launcher and bottom bar gray it with
  the hint as tooltip and screen-reader text) rather than dropping it."

**divergent**: `src/app/App.svelte:931` (the `time-travel` menu item has no `available` field;
it is always interactive). When entered with no history provider, the strip shows "A history
provider on the server (for example signalk-questdb) unlocks time travel."
(`src/features/time-travel/HistoryStrip.svelte:84`), which is honest but only visible after
the navigator enters the mode and the bottom strip replaces the status strip.

**shared fix**: Add `available: (historyProviders?.ids.length ?? 0) > 0` and an
`unavailableHint` (for example "Replay needs a history provider plugin on the server, such
as signalk-questdb.") to the `time-travel` menu item, matching the radar item's pattern. The
inline no-provider state in `HistoryStrip` can stay as a secondary defense (a provider that
disappears mid-session), but the menu entry should gray when the provider is known absent at
detection time.

**severity**: latent. The feature does not break or mislead (it shows an honest empty state
on entry), but it drifts from the design-system contract for absent-provider menu items and
is inconsistent with its closest sibling (Radar). On a stock server the navigator sees an
interactive Replay tile that leads to an empty mode rather than a grayed tile that explains
why up front.

## Verified not a finding

The following degrade obligations were checked and cleared as consistent:

- **Course calcValues (XTE, VMG, DTW, BTW, ETA)**: `CourseGuidance`
  (`src/entities/course/course.svelte.ts`) reads server calcValues when present and computes
  client-side when absent, with `source: 'server' | 'computed'` exposed. `NavStrip`
  (`src/features/navigation/NavStrip.svelte:98`) shows "computing locally" when the source is
  computed. This is the canonical degrade pattern, consistently applied.

- **CPA and TCPA (navigation.closestApproach)**: `CollisionAssessment`
  (`src/entities/collision/collision.svelte.ts`) reads the server's `closestApproach` values
  when the AIS target carries them and computes client-side via `computeCpa`
  (`src/shared/nav/cpa.ts`) when absent, tracking `source: 'provider' | 'computed'`. The
  danger strip, collision overlay, and AIS list all consume the same assessment. Consistent.

- **Tides (signalk-tides plugin)**: The tides loader
  (`src/features/tides/tides-loader.ts`) detects the plugin via
  `serverFeatures?.plugins.has(SIGNALK_TIDES_PLUGIN_ID)` and falls back to NOAA CO-OPS. The
  menu item is always available because the fallback always works. Consistent.

- **Weather (Signal K weather provider)**: The weather client detects the provider via
  `fetchWeatherProviders` and falls back to Open-Meteo. The menu item is always available
  because the free grid is always reachable. Consistent.

- **Anchor API and anchoralarm plugin**: `resolveAnchorTransport`
  (`src/features/anchor-watch/anchor-transport.ts`) detects the standard Anchor API via
  `serverFeatures?.apis.has('anchor')`, falls back to the anchoralarm plugin probe, and
  degrades to the client-side watch. The controller surfaces a server error only for the
  standard API path (not the plugin-probe path, which cannot distinguish absent from
  refused). Consistent, matching the CLAUDE.md note about proposal APIs.

- **Notifications v2 vs v1**: The collision notifier (`App.svelte:202`) and the MOB
  controller (`src/features/mob/mob-controller.svelte.ts:65`) both check `notificationsApi`
  (from `serverFeatures?.apis.has('notifications')`) and fall back to the v1 delta publish.
  The AlarmsPanel conditionally renders silence and acknowledge buttons only when the v2 API
  is present and the notification has a server id. Consistent.

- **Symbols (signalk-symbol-manager)**: `SymbolsStore`
  (`src/entities/symbols/symbols-store.ts`) is constructed empty, filled when
  `fetchSymbols` resolves, and falls back to built-in icons on a stock server. No menu item
  is gated because symbols are always rendered (built-in fallback). Consistent with the
  CLAUDE.md note about pre-1.0 APIs.

- **KIP webapp**: Dropped from the menu when absent (conditionally spread). Documented as the
  "plugin-gated" convention in `docs/building-menu-items.md` section 1 and CLAUDE.md's menu
  groups. Not a divergence: KIP is a third-party webapp launcher, not a Binnacle capability
  with a degrade path.

- **Companion / Chart Locker (Offline charts group)**: Conditionally spread (dropped) when
  `detectCompanion` returns null. Documented as the "plugin-gated Offline charts group"
  convention. The ChartLockerStatus chip in the topbar shows the absent state. Consistent.

- **Base map (OpenFreeMap)**: Online source cached via service worker, not probed. Documented
  intentional exception in CLAUDE.md. Not a degrade case.

- **Local storage vs server API**: Profiles sync via `applicationData` with local fallback
  (`profiles-store.svelte.ts:121`). Routes, waypoints, and tracks use the resources API
  (`routes-client.ts`, `waypoints-client.ts`, `tracks-client.ts`) with local stores as cache.
  Notes use the v2 resources API with a session cache (`notes-client.ts`, `notes-cache.ts`).
  Track recording is client-side only by design (IndexedDB), which is correct: there is no
  Signal K track-recording API. No local-storage-first divergence found.

- **AIS trails overlay**: Uses `available: isAvailable` with `unavailableHint`, wired from
  `serverFeatures?.plugins.has('tracks')`. The layer row grays correctly when the tracks
  plugin is absent. Consistent with the radar layer-row pattern.

- **Reactive getter threading**: All controllers receive reactive dependencies (token,
  feature-detection flags) as getters `() => value`, not captured values. The
  `serverFeatures` and `historyProviders` state in App.svelte re-probes on reconnect
  (`App.svelte:1326`), and the layers-availability refresh effect (`App.svelte:1284`)
  re-lists layers when a provider appears or disappears. No stale-getter freeze found.

- **`available` vs `disabled` distinction**: The regions menu item uses `disabled` +
  `disabledLabel` for the transient "map still loading" block (`App.svelte:988`), and
  `available: false` + `unavailableHint` is reserved for the steady-state absent-provider
  case (radar). The two are used correctly for their respective conditions.
