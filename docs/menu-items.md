# Menu items

The Binnacle Chartplotter menu groups every chart action by intent. Optional features stay visible
when unavailable and explain what provider, access, connection, or sensor is missing. Server-backed
panels distinguish loading, retained-data refresh, empty results, and failure.

Navigation output is advisory. Confirm the destination, route, chart coverage, weather age, tide
source, and surrounding traffic before relying on it.

## Chart

- **Center on boat** moves the chart to the latest vessel position. It is disabled while the chart is
  loading, before GPS is available, and when the last fix is stale.
- **Follow boat** keeps the vessel centered until the chart is panned. A stale GPS fix only pauses
  recentering: Follow stays armed through the outage and resumes on the next fresh fix. While the
  chart is rotated (course-up or heading-up) and the boat is making way, Follow adds a bounded
  look-ahead that sits the boat low on screen so the water ahead gets the pixels.
- **Orientation** cycles north-up, course-up, and heading-up. The launcher tile reads Orientation
  with the current mode on a quiet second line, and the bar pill shows the bare mode name, which
  flips on tap. North-up is the default; the rotating
  modes are explicit, profile-owned choices. Heading-up needs fresh true heading and course-up
  needs fresh COG with way on; a stale or missing reference falls back to north immediately.
  While a rotating mode is chosen, a status-strip chip keeps the live orientation and its
  reference (including the fallback) visible, and its N up action returns to north with one tap.
  Rotation gestures stay disabled; the mode is the only author of chart bearing, and the chart
  stays flat (never pitched). Zoom controls provide gloved-hand alternatives to pinch, and
  the compact labeled scale reports nautical distance.
- Long press, right-click, the Context Menu key, and Shift+F10 open chart actions. Keyboard actions
  use the chart center.

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
  no-anchor ground. The ambient chart badge on the map corner grades the current view from these
  layers: server and user charts count through their own bounds, and the NOAA ENC counts as a
  nautical chart through its actual regional coverage list rather than its near-worldwide service
  envelope, so mid-ocean still reads Outside chart coverage. Bathymetry references (GEBCO,
  EMODnet, BlueTopo, Seascape) never flip the badge: they carry no aids to navigation and are not
  reduced to chart datum. Tapping the badge opens this panel. When no nautical chart is on, the
  Charts tab says so at the top and states that depth shading does not count as a chart, and a
  line beside Add a chart sets expectations outside US waters. In US waters with no chart on, a
  dismissible chart-corner banner offers to turn NOAA ENC on, graded against the boat's own fix
  and NOAA's published regional coverage, and it stays quiet while a panel is open.
- **Offline charts** stays visible without Chart Locker and explains installation, startup, access,
  and chart-loading requirements. It manages saved areas, automatic caching, installed charts, and
  storage. The installation probe distinguishes a missing plugin, refused access, and a service or
  network failure. The access-needed header status opens Signal K administrator sign-in directly.
  Return to Binnacle after signing in; Chart Locker retries automatically. If Signal K already reports
  an administrator session, a Chart Locker refusal is shown as an access error with retry instead.
  Accepted saved-area downloads recover by area identifier when the immediate job response is lost.
  Repeated status failures offer Retry status without starting another download. Removed chart
  sources are labeled, existing cached coverage is preserved, and re-download stays blocked until an
  adjusted copy uses available sources. Saved-area cards lead with an at-a-glance summary: plain
  detail level, chart count with any unavailable ones, and the approximate span in nautical miles.
  While navigating a route, an advisory route-coverage check samples a chosen 1, 5, or 10
  nautical-mile corridor (the route line and both edges) against the ready saved areas, the
  catalog coverage of their included charts, and a requested detail level; it reports Complete,
  Partial, or Unknown, highlights uncovered and insufficient-detail stretches read-only on the
  chart, clears with the route, and states that it does not certify navigation or passage safety.
  Provider readiness stays a separate readout.
  See the [Offline charts guide](offline-charts.md) and the Offline charts section in the
  [README](../README.md#offline-charts-chart-locker-and-ssl-optional).

## Navigate

- **Routes** loads Signal K route resources independently of the live WebSocket. Creating, editing,
  importing, reversing, deleting, activating, stopping, skipping, and chart-side route actions
  require write access. Route activation, stopping navigation (in the panel and on the navigation
  strip), and chart-position navigation require confirmation. Failed
  refreshes keep the last accepted list and offer Retry. Secondary card actions live in a labeled
  overflow menu, which also carries Rename route and a read-only passage plan: the same leg table,
  planned arrivals, plan speed, and departure the edit session shows, reviewable without entering
  chart edit mode, with a link to check the route's offline chart coverage. Saving from the panel
  offers to start navigation on the route just drawn, using the same confirmation. The strip's
  Save is a quick save under the working or dated name, which Rename can change afterward. On a
  server with no routes resource provider the panel names the one-time Resources Provider step
  with a Check again action. Route ids, names, geometry, and collection size are bounded before
  use. GPX imports
  accept at most 5 MB, 100 encountered routes, and 10,000 encountered route points. Malformed
  coordinates are skipped, but their records still count toward the limits.
- **Waypoints** loads standard Signal K waypoint resources, supports chart drops, edits, deletes,
  location, and confirmed navigation. Navigation sends the waypoint's resource reference so the
  destination name reaches the navigation strip and other stations. The panel searches name and
  description ignoring case and accents, sorts by name, distance, or bearing with fresh-fix-only
  metrics, and states its render and ingestion caps. Locate and a confirmed navigation start both
  collapse the phone panel so the chart and the guidance strip stay visible, and failed loads offer
  Retry. The chart drop dialog also offers Save and navigate, which saves the mark and arms the
  same destination-naming confirmation; plain Save stays primary and edit mode never offers it. On
  a server with no waypoints resource provider the panel names the one-time Resources Provider
  step with a Check again action instead of blaming the connection. See [Waypoints](waypoints.md).
- **Tracks** records a continuous local track and manages saved Signal K track resources. GPS gaps
  remain gaps, server mutations update the UI immediately, and route conversion uses only the latest
  continuous segment. Retrace requires confirmation, and failed resource loads offer Retry without a
  startup toast. A server with no tracks resource provider is detected, Save is disabled, and the
  panel names the one-time Resources Provider step with a Check again action. See
  [Tracks](tracks.md).
- **Logbook** reads and writes the ship's log through the signalk-logbook plugin. The panel shows
  the most recent logged days and a composer; taking a watch handoff, starting or stopping
  navigation, and dropping or raising the anchor each offer a prefilled factual entry, and nothing
  is ever logged without a tap. Absent-plugin, access, and failure states are distinct, and the
  landing state explains installing the plugin from the Signal K App Store.
- **Playback** reviews bounded 1-hour, 6-hour, 24-hour, and 7-day ranges from one available
  history provider. Each range has a fixed adaptive resolution and row cap. The range-owned track,
  scrubbed marker, and four-metric readout share the same accepted provider snapshot. Play and pause
  offer Slow, Normal, and Fast (0.5x, 1x, and 2x) speeds, pause when the document is hidden, and stay disabled for reduced
  motion. Loading, no-provider, empty, and failed states are distinct. A failed range retains and
  correctly labels the accepted range, Retry repeats the failed request, and Latest moves to its newest
  loaded sample without another network query. Tracks records the boat's own
  breadcrumb trail; Playback reviews the server's recorded history. They cross-link: a saved track
  carries per-point times when the recording had them, its card shows the recorded span, and a
  Play back this span action enters Playback at the track's start, widened to the smallest range
  that covers it. Tracks older than the seven-day history window say so instead of failing.
- **Find places** searches chart notes and places, including cached offline results. The layer
  row for the same data is named Places, so one noun covers the panel, the pill, the toolbar
  action, and the overlay.
  Loading, zoom limits, hidden layers, empty results, offline cache, and provider failure remain
  distinct. Its direct Show places on chart control uses the same visibility state as Overlays. See
  [Find places](find-places.md).
- **Measure** arms chart taps for rhumb-line distance and true bearing. Points can be selected through
  a 44 px chart target or the strip, moved deliberately by drag, chart tap, or chart-center keyboard
  workflow, deleted, and restored through operation-based Undo. The strip shows both legs adjacent to
  a selected point, while collision-managed chart labels show distance only above a bounded zoom.
  Clear confirms, nested Escape cancels movement before ending Measure, route editing is excluded in
  both directions, and selecting Measure again preserves current work. See [Measure](measure.md).

## Safety

- **Nearby vessels (AIS)** carries a live count of danger-grade collision contacts on its menu
  entry, and a named contact on the collision strip opens that vessel's detail here directly. It
  searches reported names and Maritime Mobile Service Identity numbers,
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
  watch remains active independently. A browser watch whose GPS fix stays lost for about 30 seconds
  sounds the anchor tone and shows an "Anchor watch: no GPS" strip with per-episode Acknowledge
  (which re-arms when the fix returns) and Raise. A stream reconnect's stale server state is
  reported as "Anchor watch state is stale: reconnecting to the server." only after about 5 seconds
  and is never worded as a GPS loss. Server-mode changes require write access; client-mode changes
  stay available. Conflicting actions are locked until completion.
- **Man overboard** raises the boat-wide alarm through the Notifications API with a v1 delta
  fallback. A raise or clear lost to a closed socket is replayed on reconnect, the MOB strip warns
  when the boat-wide alarm may not have reached the server, and the confirm dialog qualifies its
  every-station promise while writes are blocked.
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
  publishing. Alarm audio is reported where an alarm lives, not in the status strip: the Alarms and
  Anchor watch panels state the grade (blocked until this display is tapped, failed to start, or
  unavailable on this display), and the Help setup checklist carries it as a row. Any tap or key
  anywhere primes the audio, so the blocked grade clears itself in ordinary use. The strip stays a
  readout row: a browser-permission condition is not a helm reading, and on a boat with nothing
  audible armed a standing chip claimed a silence that could not happen while costing the readouts
  a wrapped row. One alarm sounds at
  a time through a single audio authority: man overboard and an escalating collision danger
  interleave at the top, lower alarms rotate with bounded reminders, and courtesy tones yield.
- **Watch handoff** takes a timestamped review-status snapshot for the change of watch: fix and
  source age, course with cross-track error and a basis-qualified time to go, raised alarms and
  the collision mute expiry, the top CPA and TCPA contact with assessment health, depth watch
  state, radar health, weather and tide ages, whether the active route's offline coverage was
  checked, and a short operator note. Snapshots share between stations through Signal K
  applicationData (global scope); when that store is unreachable they queue on the device and sync
  on reconnect, and every record states whether it is shared, waiting to sync, or on this device
  only. Facts are rendered at snapshot time so stale inputs read as stale, taking a snapshot
  mutates nothing (no acknowledgments, no navigation changes), and the surface reviews status; it
  never declares it safe to take watch.

- **Lock screen** shields a wet helm from rain and spray taps. The man-overboard key and the
  safety alert rail stay genuinely tappable through openings in the shield, alarm dialogs work
  above it, and slide-to-unlock (or holding Enter on the handle) releases it. The lock is
  session-only: a reload always comes up unlocked.

## Weather

- **Forecast** opens a weather mini-map at the navigation chart view. Wind and waves start visible on
  a fresh install. Cached data is labeled with source and fetch time, stale data remains visible, and
  a manual Retry bypasses automatic backoff after a failed fetch. Conditions at the boat require a
  fresh GPS fix. Provider point requests are time-bounded, warning intervals are validated, and
  missing optional warning labels receive bounded fallbacks. Open-Meteo marine fields are omitted
  when the provider's sea-snapped coordinate is too far from the requested grid cell. Provider
  warnings state when warning data is unavailable or cached. The routes shown on the chart draw
  read-only over the forecast with their named waypoints; they are not offered as a weather layer,
  cannot be edited there, and never imply the forecast was routed along the path.
- **Tides and currents** independently selects tide-height and tidal-current stations. Automatic mode is the
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
  empty response reports that no predictions are in the current window. The station lists only report
  that none is nearby once a search has actually finished; before one starts, while one runs, or
  after one fails, the panel explains the real reason instead of making a claim about the water.
  Provider station and event payloads are validated and bounded, and CO-OPS station identifiers are
  constrained before URL construction. Choices are not persisted across reloads.

## Instruments

- **Instrument dock** opens the live instrument tiles. Each tile leads with its loud abbreviation
  (SOG, HDG, AWS) over the quiet long name, states render as tinted chips (Alarm outranks Stale,
  and Stale outranks a zone Warning computed from the untrusted value), a stale tile keeps its
  retained number at muted contrast with its age on the secondary line, and the wind tile's angle
  freshness folds into the same chip line. Customize can show, hide, and reorder tiles,
  including bounded discovered batteries, engines, tanks, solar controllers, and cabin sensors. A
  Rescan checks the live Signal K model first. When a registered history provider is available, it
  also checks the preceding year for concrete paths that populated under `vessels.self`, so seasonal
  equipment can be configured while stopped. Previously recorded readings stay selectable and
  visibly marked until live data arrives. Binnacle never presents a stored sample as a current
  reading. Dynamic labels identify both the reading and its source, such as RPM · Port engine, and
  the Customize list automatically disambiguates any future repeated label. An absent or failed
  provider leaves live discovery working and reports the reduced scan. An intentionally empty
  selection explains how to add a tile. Duplicate, invalid, and oversized saved selections are
  normalized. Each tile's detail names the live Signal K source of the shown value, and on
  watch-critical paths a bounded recent-source trace adds a cue: Source changed with the prior
  label, or Multiple recent sources when they alternate, within a ten-minute window. Each path
  traces alone, so unlike references (magnetic versus true heading) are never compared, and a
  reconnect starts the trace fresh. When two or more sources fed the shown path within that
  window, a Recent sources list names each source with its own formatted value and age, neutrally
  and without judging disagreement. Staleness honors the server first: a path the server declares
  timed out under its meta.timeout reads Stale (server declared) with the last good value retained
  and aged from its own receipt, and the detail names the source that went quiet. Because the
  server declares staleness per source, a declaration for a source other than the one feeding the
  shown value never marks the path. A path's explicitly declared meta.timeout also replaces the
  ten-second client staleness window on its tile, so a legitimately slow sensor is not flashed
  stale, and a declared timeout of zero means never stale.
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
  plus a textual latest, minimum, maximum, start, and end summary, and a data-coverage line
  (percent of samples present, longest gap, newest sample's age, marked Partial or Stale when
  warranted) that is visible and read by screen readers. Eligible instrument details can
  open one focused trend without changing the saved overview. Back restores the same detail and
  focus, while Close returns to the chart.
- **Instrument dashboard** opens the installed KIP webapp in a new tab; the tile's quiet second
  line names both the acronym and the new tab. Transport or access failures keep its
  availability in the checking state instead of claiming KIP is absent. A blocked pop-up produces a
  visible message.
- **AI advisor** shows the signalk-openrouter-companion plugin's analyzer reports: advisory prose,
  timestamped, refreshed while the panel is open, with a Run now action per analyzer that fires
  the plugin's own trigger and shows its acknowledgment verbatim, budget refusals included. The
  reports never enter an alarm path, and the absent-plugin landing explains what the companion is.

## Settings

- **Display** groups the helm display environment: a true-black screen dim that stays pointer
  transparent and never exceeds the alarm-distinguishable floor, the opt-in automatic day and
  night theme (from the boat's day and night signal with a solar fallback, paused by a manual
  choice until the next boundary), the bright-sun chart contrast for direct sunlight, and the
  interface text size from 100 to 130 percent with touch targets that only grow. All four travel
  with the active profile. With auto theme off, sunset raises a one-time offer to switch to the
  night theme.
- **Profiles** (tile subtitle: units, sync, and privacy) saves portable chart, weather, threshold,
  toolbar, instrument, Data trends, track,
  unit-fallback, planning, chart-orientation, and preferred anchor-radius settings. The active profile saves
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
- **Help** opens the permanent help panel: the safe-use framing (an advisory chartplotter, not a
  navigation chart), a live Get set up checklist (nautical chart on, GPS position seen, read and
  write access, alarm sound, and server saved-data storage, each with one action, retiring itself
  once the durable rows pass), the reference-map-versus-charts distinction, Signal K access and
  alarm-sound setup with direct actions, what each connection state means, a When something looks
  wrong section covering staleness and unassessed AIS targets, a marine glossary including the
  Keel, Surface, and Xducer depth datums and Signal K itself, operating-context checklists for a
  coastal day, a night passage, and lying at anchor, and a reset for the chart hints. The
  first-run orientation banner reopens from here; dismissing it persists per device, and its
  Set up charts action opens the Charts tab.

## Toolbar and status strip

- The bottom toolbar carries pinned actions, chosen by tapping tiles while customizing. The
  default set is Menu, Center, Follow, and AIS: the Menu opener sits in the bar because on a phone
  the top-bar hamburger is a cross-screen reach, and AIS keeps one Safety action thumb-reachable
  with its live collision-risk count. Pinning Menu hides the top-bar hamburger, so exactly one
  control named Menu exists at a time. Menu renders as a launcher tile only while customizing,
  since tapping a tile is the pin control.
- Degraded status-strip chips explain themselves on touch: tapping the connection dot, the AIS
  chip, the depth chip, a radar-trouble chip, or either alarm-audio chip shows its explanation as a
  transient note above the strip. Waiting for GPS carries a Help action, and the anchor chip opens
  Anchor watch. A chip that carries an action keeps it on the same row as its label, never stacked
  beneath it, so one degraded state costs the chart one row and not two.
- While the Signal K link itself is down or silent, the readouts that pause with it (GPS, speed,
  course, heading, and the depth watch) are subordinated so the strip presents one failure with
  one action. Radar health is excluded: it rides the radar provider's own stream, not this link.
