# Menu items

The Binnacle Chartplotter menu groups every chart action by intent. Optional features stay visible
when unavailable and explain what provider, access, connection, or sensor is missing. Server-backed
panels distinguish loading, retained-data refresh, empty results, and failure.

Navigation output is advisory. Confirm the destination, route, chart coverage, weather age, tide
source, and surrounding traffic before relying on it.

## Map

- **Center on boat** moves the chart to the latest vessel position. It is disabled while the chart is
  loading, before GPS is available, and when the last fix is stale.
- **Follow boat** keeps the vessel centered until the chart is panned. Follow turns off automatically
  when the GPS fix becomes stale.
- The chart stays north-up and flat, zoom controls provide gloved-hand alternatives to pinch, and
  the compact labeled scale reports nautical distance.
- Long press, right-click, the Context Menu key, and Shift+F10 open chart actions. Keyboard actions
  use the chart center.

## Navigate

- **Routes** loads Signal K route resources independently of the live WebSocket. Creating, editing,
  importing, reversing, deleting, activating, stopping, skipping, and chart-side route actions
  require write access. Route activation, stopping navigation (in the panel and on the navigation
  strip), and chart-position navigation require confirmation. Failed
  refreshes keep the last accepted list and offer Retry. Secondary card actions live in a labeled
  overflow menu. Route ids, names, geometry, and collection size are bounded before use. GPX imports
  accept at most 5 MB, 100 encountered routes, and 10,000 encountered route points. Malformed
  coordinates are skipped, but their records still count toward the limits.
- **Waypoints** loads standard Signal K waypoint resources, supports chart drops, edits, deletes,
  location, and confirmed navigation. Navigation sends the waypoint's resource reference so the
  destination name reaches the navigation strip and other stations. The panel searches name and
  description ignoring case and accents, sorts by name, distance, or bearing with fresh-fix-only
  metrics, and states its render and ingestion caps. Locate collapses the phone panel so the chart
  stays visible, and failed loads offer Retry. See [Waypoints](waypoints.md).
- **Tracks** records a continuous local track and manages saved Signal K track resources. GPS gaps
  remain gaps, server mutations update the UI immediately, and route conversion uses only the latest
  continuous segment. Retrace requires confirmation, and failed resource loads offer Retry without a
  startup toast. A server with no tracks resource provider is detected, Save is disabled, and the
  panel names the one-time Resources Provider step with a Check again action. See
  [Tracks](tracks.md).
- **Find places** searches chart notes and points of interest, including cached offline results.
  Loading, zoom limits, hidden layers, empty results, offline cache, and provider failure remain
  distinct. Its direct Show places on chart control uses the same visibility state as Overlays. See
  [Find places](find-places.md).
- **Measure** arms chart taps for rhumb-line distance and true bearing. Points can be selected through
  a 44 px chart target or the strip, moved deliberately by drag, chart tap, or chart-center keyboard
  workflow, deleted, and restored through operation-based Undo. The strip shows both legs adjacent to
  a selected point, while collision-managed chart labels show distance only above a bounded zoom.
  Clear confirms, nested Escape cancels movement before ending Measure, route editing is excluded in
  both directions, and selecting Measure again preserves current work. See [Measure](measure.md).
- **Layers and charts** opens to chart sources first. Signal K chart discovery can be retried without
  removing the last loaded sources. A broken source cannot stop the chart from opening. URL-backed
  PMTiles imports accept bounded HTTP or HTTPS URLs, validate metadata, and persist locally. Plain
  URLs may sync when Signal K writes are available. Every query-bearing URL defaults to device-only,
  and explicitly enabling sharing sends the complete URL to Signal K. Closing or superseding an
  import cancels its metadata request. User chart detail can stage a replacement URL, refresh the
  current URL's metadata, and change server sharing while retaining the chart id, visibility,
  opacity, and stack position. A failed replacement restores the accepted chart. Overlays remain in
  their own tab with visibility, opacity, management, and stacking controls. Signal K style-document
  sources remain listed with details available for inspection, but they are disabled, forced off,
  and identified as unsupported instead of appearing as blank charts. Chart overlays under
  **Chart overlays and marks** include seabed infrastructure (power cables, telecom cables,
  pipelines, and wind farms), maritime jurisdiction lines, and protected areas. All default hidden;
  the infrastructure layers exist for anchoring decisions, since a submarine cable or pipeline is
  no-anchor ground.

## Safety

- **Nearby vessels (AIS)** searches reported names and Maritime Mobile Service Identity numbers,
  filters collision risks and getting-close targets, then renders up to 500 matches by distance,
  closest point of approach (CPA), or name. A list row or generous chart hit target opens the same
  live in-panel detail, and the selected chart target gains a ring below the collision styling.
  Stale or absent own GPS removes derived distance and bearing instead of showing frozen values. An
  expired selected target returns to the live list instead of freezing its values. The panel labels
  a disconnected Signal K stream, shows collision severity, and exposes target identity, position,
  course, heading, speed, CPA, time to closest point of approach (TCPA), navigation state, and a
  plain-language ship type with the reported numeric id.
- **Radar** stays discoverable without a provider and explains what is missing. Controls report radar
  identity, control-write state, spoke-stream health, renderer health, and stale pictures. Transmit
  requires confirmation, Standby stays immediate, complete native zones, no-transmit sectors, and
  rectangles have atomic form and chart editors, and Open overlay settings moves directly to the
  Overlays view. See
  [Marine radar](marine-radar.md).
- **Anchor watch** prefers the Signal K Anchor API and falls back to a browser-only watch. A fresh GPS
  fix is required to drop. Lost GPS makes browser drag detection visibly degraded, while a server
  watch remains active independently. Server-mode changes require write access; client-mode changes
  stay available. Conflicting actions are locked until completion.
- **Alarms** lists bounded, validated Signal K notifications by severity, and its menu entry carries
  the live count of raised generic alarms. Any inbound alarm or emergency grade notification outside the
  dedicated hazards sounds a shared tone and raises a safety strip offering Silence, Acknowledge,
  Mute here, and Open Alarms; within those two grades the notification method field is honored with
  an audible-safe default, warn and alert grades stay visual by design, and a device-local mute
  never swallows a newly raised alarm. Silence and acknowledge are locked
  while pending and require server write access. A disconnected stream is labeled because displayed
  alarm state may be stale. Collision warnings publish as visual-only Signal K deltas, while danger
  alarms use the Notifications API with visual and sound methods. Collision and shallow-water
  settings stay in safe numeric bounds, in SI internally, with conversion only at display inputs.
  The shallow threshold merges the server's depth zones with the locally configured limit
  conservatively: whichever bound is deeper governs, so the server can tighten the alarm but never
  quietly loosen it. The panel names which one is in force and says when no depth source is
  publishing.

## Weather

- **Forecast** opens a weather mini-map at the navigation chart view. Wind and waves start visible on
  a fresh install. Cached data is labeled with source and fetch time, stale data remains visible, and
  a manual Retry bypasses automatic backoff after a failed fetch. Conditions at the boat require a
  fresh GPS fix. Provider point requests are time-bounded, warning intervals are validated, and
  missing optional warning labels receive bounded fallbacks. Open-Meteo marine fields are omitted
  when the provider's sea-snapped coordinate is too far from the requested grid cell. Provider
  warnings state when warning data is unavailable or cached.
- **Tides** independently selects tide-height and tidal-current stations. Automatic mode is the
  session default, prefers signalk-tides for tide height, and uses NOAA CO-OPS as the US-waters
  fallback and current source. Up to eight NOAA stations of each kind are listed within the supported
  radius. A manual choice fetches that exact NOAA station, survives chart pans for the session, and
  can be reset independently or together with **Use nearest stations**. Straight-line distance from
  the chart center is guidance only and does not guarantee that a station represents local water
  movement. Filled tide markers, hollow current markers, and their loaded prediction labels are
  tappable by mouse or touchscreen; a station selection reveals the layer, opens the panel when
  needed, and expands a minimized panel. When chart markers overlap, the highest visible overlay
  owns the gesture. Cached readings, accepted station choices, provider attribution, and nearby
  catalogs survive a failed replacement, and **Retry** bypasses the automatic cooldown. A valid
  empty response reports that no predictions are in the current window. Provider station and event
  payloads are validated and bounded, and CO-OPS station identifiers are constrained before URL
  construction. Choices are not persisted across reloads.

## Instruments

- **Instrument dock** opens the live instrument tiles. Customize can show, hide, and reorder tiles,
  including bounded discovered batteries, engines, tanks, solar controllers, and cabin sensors. A
  Rescan checks the live Signal K model first. When a registered history provider is available, it
  also checks the preceding year for concrete paths that populated under `vessels.self`, so seasonal
  equipment can be configured while stopped. Previously recorded readings stay selectable and
  visibly marked until live data arrives. Binnacle never presents a stored sample as a current
  reading. Dynamic labels identify both the reading and its source, such as RPM · Port engine, and
  the Customize list automatically disambiguates any future repeated label. An absent or failed
  provider leaves live discovery working and reports the reduced scan. An intentionally empty
  selection explains how to add a tile. Duplicate, invalid, and oversized saved selections are
  normalized.
- **Data trends** shows zero to eight profile-owned instrument trends in saved order.
  Customize groups the available readings by category, supports touch and keyboard reordering, keeps
  unavailable saved selections removable, and disables a ninth addition without hiding it. Opening
  the panel discovers live dynamic instruments even when the Instrument dock has never opened. Rescan also
  checks registered history providers for previously seen readings and marks those without live data.
  Each chart resolves an ordered Signal K path fallback and one history provider without merging
  sources. A nonempty 24-hour history series wins per chart; otherwise the bounded, in-memory
  session recorder is used. That session window does not survive reload, and an unselected focused
  instrument starts recording only when its focused chart opens. Provider checking, partial failure,
  total failure, true empty history, session fallback, and no samples remain distinct. Every chart
  identifies its provider, path, and reference and includes a touch and keyboard timeline scrubber
  plus a textual latest, minimum, maximum, start, and end summary. Eligible instrument details can
  open one focused trend without changing the saved overview. Back restores the same detail and
  focus, while Close returns to the chart.
- **Open KIP** opens the installed KIP webapp in a new tab. Transport or access failures keep its
  availability in the checking state instead of claiming KIP is absent. A blocked pop-up produces a
  visible message.
- **Time travel** reviews bounded 1-hour, 6-hour, 24-hour, and 7-day ranges from one available
  history provider. Each range has a fixed adaptive resolution and row cap. The range-owned track,
  scrubbed marker, and four-metric readout share the same accepted provider snapshot. Play and pause
  offer Slow, Normal, and Fast (0.5x, 1x, and 2x) speeds, pause when the document is hidden, and stay disabled for reduced
  motion. Loading, no-provider, empty, and failed states are distinct. A failed range retains and
  correctly labels the accepted range, Retry repeats the failed request, and Latest moves to its newest
  loaded sample without another network query.

## Offline

- **Offline charts** stays visible without Chart Locker and explains installation, startup, access,
  and chart-loading requirements. It manages saved areas, automatic caching, installed charts, and
  storage. The installation probe distinguishes a missing plugin, refused access, and a service or
  network failure. The access-needed header status opens Signal K administrator sign-in directly.
  Return to Binnacle after signing in; Chart Locker retries automatically. If Signal K already reports
  an administrator session, a Chart Locker refusal is shown as an access error with retry instead.
  Accepted saved-area downloads recover by area identifier when the immediate job response is lost.
  Repeated status failures offer Retry status without starting another download. Removed chart
  sources are labeled, existing cached coverage is preserved, and re-download stays blocked until an
  adjusted copy uses available sources.
  See the [Offline charts guide](offline-charts.md) and the Offline charts section in the
  [README](../README.md#offline-charts-chart-locker-and-ssl-optional).

## Settings

- **Profiles** saves portable chart, weather, threshold, toolbar, instrument, Data trends, track,
  unit-fallback, planning, and preferred anchor-radius settings. The active profile saves
  automatically after a short debounce. Each device keeps its own active choice, while profiles and
  the default sync
  through the authenticated Signal K account. A remote change to the active profile is offered for
  explicit application or rejection so the chart does not change underneath the navigator; the
  prompt names the setting categories that differ, and the profile switcher in the top bar carries
  an update indicator so the offer is discoverable without opening the panel. The
  browser persists the last-applied setup separately, so an unresolved update survives reload.
  Imports are
  size-limited, deeply validated, bounded, and report the number saved. Profile names, ids, settings,
  timestamps, list sizes, journals, and server documents are validated before merge. Without server
  write access, edits remain queued locally, and delete confirmation warns that a server copy may
  remain. The panel reports Local, Waiting, Syncing, Synced, Conflict, and Error states, offers Retry,
  and keeps secondary card actions in a labeled overflow menu that flips and clamps within a narrow
  viewport or scrolled panel. Device privacy actions can forget only the local Signal K token or erase
  Binnacle-owned local settings, caches, IndexedDB data, profiles, and credentials. Full erasure is
  blocked while safety or unsaved navigation work is active and never deletes or revokes server data.
  Synced profiles return after sign-in and sync, while unsynced profiles and edits are permanently
  lost. Profile writes are suspended during erasure so queued work cannot recreate local data. See
  [Profiles and settings](profiles.md).
