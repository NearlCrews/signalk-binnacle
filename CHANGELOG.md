# Changelog

All notable changes to Binnacle are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Profile sync to the server now recovers after an access upgrade: approving a read-write token
  mid-session resumes syncing instead of silently staying local until the next reload, and the
  applicationData adapter always sends the current token.
- Adopting a sign-in from another tab no longer flashes the auth state back to "requesting" when a
  pending access poll resolves at the same moment.
- The Chart Locker management calls (saved regions, cache settings, region delete and redownload)
  now surface a failed response as an error instead of parsing an error body as data or silently
  swallowing it.
- Honor a reduced-motion preference change for the wind layer the next time it is turned on,
  instead of only after a full reload.

### Changed

- Waypoint and profile deletes use the same one-at-a-time armed confirm as routes and tracks, so
  arming one row disarms the rest.
- The tides panel readouts use the shared stat-grid layout, and its close button is labeled "Close
  tides panel" (matching "Close tracks panel"), so the panels read consistently.
- The place-details panel lays its body out with the shared panel column, so the "Show on chart"
  action sizes to its content instead of stretching full width.
- Live track statistics are accumulated per fix instead of rescanned from the full point history on
  every update, so the tracks panel stays light on long passages.
- Faster nearby tide and current station lookup: stations far outside the search radius are skipped
  before any distance math runs.
- Repeated place-icon lookups and radar legend theming do less work per call, and the track
  simplifier allocates less on long recordings.
- The place-details cache keeps the most recently viewed places instead of evicting the
  oldest-loaded first.

<a id="v0130"></a>

## [0.13.0] - 2026-07-01

The first published release since 0.10.6. It brings the whole offline-charts and Chart Locker system
built across the intervening development versions, and adds a Chart Locker status pill to the header.

### Added

- **Offline charts you download before you lose coverage.** With the Chart Locker plugin installed,
  draw a box on the chart and download every chart source that covers it into the boat-wide tile
  cache. The area is saved and pinned, so it keeps rendering at anchor and at sea. A storage estimate,
  gated against the cache budget, shows the size before the download starts.
- **A saved-areas list you manage.** Every downloaded area is listed with its cached size and last
  download date, with re-download and delete on each, and a progress bar tracks an area while it fills.
- **The base map and marks saved by default.** A downloaded area saves the chart that covers it, the
  navigation marks, and the vector base map with no setup, so an offline area is never a blank canvas.
  "Customize what's included" opens the full layer list when you want the specialist overlays.
- **Detail as plain presets.** Pick Overview, Coastal, or Harbor instead of raw zoom numbers, and the
  area downloads to the right level of detail for how you will use it.
- **Auto-cache around the boat.** An optional background fill keeps a small area cached around the
  vessel as it moves. Pick the charts it caches, and set its radius and refresh interval, so you stay
  covered even away from a saved area.
- **Local chart management.** A panel lists every local PMTiles chart the Chart Locker plugin has
  found and registered, each with its name and description, so your full set of offline charts is
  visible in one place.
- **One shared, boat-wide offline cache.** The remote chart overlays and the vector base map with its
  labels are fetched and cached through the Signal K server, so the whole boat shares one cache, the
  same tile is not refetched per device, and they keep working offline at sea.
- **The Offline charts panel.** All of the above lives under one plain-language "Offline charts" menu
  group: a landing with a single "Download an area" action, the saved-areas list, and rows into
  Storage and Auto-cache, in place of the old scroll of source checkboxes, zoom numbers, and cache
  internals.
- **Chart Locker status in the header.** With the plugin installed, the header's right controls show a
  Chart Locker pill beside the profile pill whose glyph reads its state at a glance: a check when it is
  online, a pulled plug when it is offline, and a warning triangle on a server fault. It opens the
  Offline charts panel on tap. It reads online whether or not you have the access to read the cache
  size, and shows the size in its hover tooltip when you do. The tooltip and the screen-reader label
  always name the state in words, and the pill is absent on a standalone install without Chart
  Locker.

### Fixed

- **The vector base map and its labels render again.** The base map tiles and glyphs are fetched in a
  web worker, which could not resolve a path-absolute `/plugins/...` URL and failed every vector tile
  and glyph request, leaving only the shaded-relief raster visible. Binnacle now hands MapLibre
  absolute URLs, so the vector base map, its labels, and a read-only server all work again.
- **Writes use the read-write token the moment access is approved.** Routes, waypoints, tracks, course
  changes, and alarm writes switch to the read-write token as soon as access is granted, instead of
  failing on the original read-only token until the page reloads.
- **Auto-cache settings are kept.** Turning on auto-cache around the boat, and its chart picks, radius,
  and interval, now persist and reload. The settings were saved all along, but the panel read them back
  in the wrong shape and reopened on its defaults, so the toggle looked like it never saved.
- **The man-overboard confirm dialog times out exactly once.** The 15 second self-dismiss countdown
  could fire more than once if the dialog lingered, so the alarm handoff now runs a single time.
- **Theme switch during a chart load.** Switching the day, dusk, or night theme no longer errors when a
  chart overlay layer is still loading; the paint update skips a layer that is not on the map yet.
- **A downloading area survives a token change.** If the access token rotates while an area download is
  in progress, the status poll picks up the new token on its next tick instead of running on the stale
  one.
- **The offline-area storage check no longer hangs.** The storage check bounds its request with a
  timeout, so an unreachable tile cache fails and reports rather than leaving the panel on "Checking
  storage".

### Changed

- **Companion plugin renamed to Chart Locker.** Binnacle points its tile cache, base map, chart, and
  area requests at the renamed `signalk-chart-locker` plugin, previously the Binnacle Companion plugin.
- **The man-overboard alert range follows your distance units.** The MOB alert's announced range now
  matches the on-screen Range readout and honors your distance-unit preference, instead of always
  announcing meters.
- **Dependencies and internals.** Refreshed @lucide/svelte, declared the Biome dev dependency the lint
  scripts rely on, dropped an unused dev dependency, tightened the US and EU chart bounds so a layer
  only appears where it has data, and removed dead export surface across the app.

<a id="v0122"></a>

## [0.12.2] - 2026-07-01

### Changed

- **The man-overboard alert range follows your distance units.** The MOB alert's announced range now
  matches the on-screen Range readout and honors your distance-unit preference, instead of always
  announcing meters.
- **The offline-area storage check no longer hangs.** The check now bounds its request with a timeout,
  so an unreachable tile cache fails and reports rather than leaving the panel on "Checking storage".
- **Offline charts, redesigned for a plain-language flow.** The old "Tile cache" panel, a single long
  scroll of chart-source checkboxes, zoom numbers, and cache internals, is now "Offline charts" under
  its own menu group. A landing offers one "Download an area" action, the list of saved areas, and
  rows to Storage and Auto-cache. The builder hides the chart layers behind "Customize what's
  included" and shows a plain summary instead, the base map is saved by default so an offline area is
  never a blank canvas, detail is an Overview, Coastal, or Harbor preset rather than raw zoom levels,
  and storage and the around-the-boat auto-cache each move to their own sub-view. Smart defaults save
  the chart that covers the area, the navigation marks, and the base map, leaving specialist layers
  off. The US and EU chart bounds were tightened so a layer only appears where it has data.

### Fixed

- **The man-overboard confirm dialog timed out cleanly.** The 15 second self-dismiss countdown could
  fire its timeout more than once if the dialog lingered, so the alarm handoff now runs exactly once.
- **A downloading region kept polling on the current credentials.** If the access token rotated while
  an offline-area download was in progress, the status poll now picks up the new token on its next
  tick instead of running on the stale one until it gave up.
- **Vector basemap and labels rendered blank.** The OpenFreeMap base map tiles and glyphs are
  fetched in a web worker, which cannot resolve a path-absolute `/plugins/...` URL and failed every
  vector tile and glyph request, leaving only the shaded-relief raster (which loads on the main
  thread) visible. The map now hands MapLibre absolute URLs for companion and Signal K requests, so
  the vector base map, labels, and a read-only server all work again.

<a id="v0121"></a>

## [0.12.1] - 2026-06-29

### Added

- **Regions panel.** Draw a box on the chart and download every covering raster source into the
  boat-wide tile cache before leaving internet coverage. The panel enumerates the raster chart sources
  that cover the box, shows a regions-free byte estimate gated against the cache budget so a download
  cannot overrun the space reserved for saved regions, and lets you edit a geocoded name for the region
  before saving it. Saved regions are listed with their cached size and last download date, each with
  re-download and delete, and a progress bar tracks a region while it warms. Requires the Chart Locker
  plugin.

### Changed

- **Companion plugin renamed to Chart Locker.** Binnacle now points its tile cache, basemap, chart,
  and region requests at the renamed `signalk-chart-locker` plugin, previously the Binnacle Companion
  plugin, and the prewarm panel and its client were renamed to the regions naming throughout.

### Fixed

- **Route creation from the chart.** "Start a route here" in the chart context menu now reliably
  drops the first point. The synthetic pointer press was missing the held-button flag the draw tool
  checks, so on some setups the first tap did nothing.
- **Writes after an access upgrade.** Routes, waypoints, tracks, course changes, and alarm writes now
  use the read-write token the moment access is approved, instead of failing with the original
  read-only token until the page reloads.
- **Man-overboard re-trigger.** A mark dropped right after cancelling another is no longer silenced
  by the cancelled mark's clear.
- **Measure tool.** A long-press or right-click during an active measurement no longer opens the
  chart context menu.
- **Stalled links.** Chart-management requests now time out instead of hanging when the server
  accepts the connection but never answers.
- **Collision and chart robustness.** A zero warning threshold now warns that it disables the warning
  alarm, and malformed chart bounds are dropped before they can reach the map.
- **Accessibility.** The icon picker keeps Tab focus within the open list, and a profile import
  failure announces as an alert.

<a id="v0120"></a>

## [0.12.0] - 2026-06-29

### Removed

- **AI route-draft and optimize controls.** The "Draft a route with AI" button and the "Optimize
  route" button are removed from the Routes panel. All manual routing is retained: drawing a
  new route, editing an existing one, importing and exporting GPX files, reversing a route,
  activating via the Course API, and stopping navigation all work exactly as before.

<a id="v0110"></a>

## [0.11.0] - 2026-06-28

### Added

- **Tile cache prewarm panel.** Draw a cruising box on the chart and fill the shared boat-wide tile
  cache before leaving internet coverage. A live byte estimate, gated against the cache capacity,
  shows how much storage the selected area and zoom range will use before the fill begins. The
  prewarmed box is pinned and never evicted; writes are bounded for microSD longevity. Requires the
  Binnacle Companion plugin.
- **Off-plan position-warm.** An optional, throttled background fill keeps a small tile radius warm
  around the vessel when it travels outside the prewarmed box, using an LRU-bounded eviction policy
  so the fill is always storage-bounded and never displaces the pinned prewarm.
- **Chart-management panel.** Lists every local `.pmtiles` archive the Binnacle Companion has
  discovered and registered, with a per-chart name and description, so the full set of offline charts
  is visible in one panel. Requires the Binnacle Companion plugin.
- **Shared offline tile cache for the remote charts and the basemap.** When the Binnacle Companion
  plugin is installed, the depth, boundary, protected-area, and seamark raster overlays, and the
  vector basemap with its glyphs and tiles, are fetched and cached through the Signal K server, so
  the whole boat shares one cache, they work offline at sea, and the same tile is not refetched per
  device. When the companion is absent, every source keeps its direct upstream URL, so a standalone
  install is unchanged. The NASA GIBS ocean fields still fetch directly for now. Companion detection
  is bounded by a short timeout so a wedged server cannot stall the map, and if the proxied basemap
  style fails while the device is online the direct style is used before the blank offline fallback.

### Changed

- **PMTiles charts served by the companion use the browser cache correctly.** When the Binnacle
  Companion provides a `.pmtiles` archive, Binnacle issues conditional requests against the strong
  ETag the companion sets, retiring the `no-store` workaround that had been applied to
  companion-provided chart paths. The archive is served with HTTP Range support so partial fetches
  work and previously cached ranges are reused.

<a id="v0106"></a>

## [0.10.6] - 2026-06-27

### Fixed

- **Course readouts stay live during navigation.** Cross-track error, velocity made good, distance and
  bearing to the waypoint, and ETA had frozen at the value read when the page first loaded. The course
  calculations stream one field at a time, and Binnacle had been listening for them as a single bundle
  that never arrives, so the numbers never refreshed. Each field is now followed as it streams, so the
  active-leg readouts update continuously while you navigate.
- **Anchor controls report a read-only token.** Dropping the anchor, raising it, or changing the swing
  radius on a read-only grant now raises the read-and-write request banner, the same as routes,
  waypoints, tracks, course, and alarms, instead of appearing to do nothing.
- **A tide forecast survives a current-station error.** When the station serving tidal currents fails,
  Binnacle keeps the tide forecast it already fetched rather than discarding both.
- **Weather readouts no longer show NaN.** The weather grid is guarded against an empty or single-point
  data axis that previously produced not-a-number readings at the cursor.
- **A mid-session data drop shows as a disconnect.** If the background Signal K connection crashes while
  running, the status now reads as a closed connection instead of going silently stale.

<a id="v0105"></a>

## [0.10.5] - 2026-06-27

### Added

- **Transmit and standby control.** Key the radar between transmit and standby from the radar panel,
  with a live status that reads transmitting, standby, warming up, or off.
- **Show echo on chart toggle** in the radar panel, synced with the Layers eye so the two never
  disagree. The echo also turns on automatically the first time a radar is detected, so a radar boat
  sees its picture without hunting for a layer switch.
- **Read and write access prompt.** When the server grants a read-only token, a banner offers a
  one-click request for read and write, so saving routes, waypoints, tracks, course, alarms, and radar
  controls works. The chart keeps updating from the existing read access while the new grant is approved.

### Fixed

- **The radar echo renders.** With the stream live the picture had been blank for three reasons, all
  fixed: the echo layer shipped off and nothing turned it on, the fallback color ramp only colored the
  lowest sample values so strong returns were transparent, and the spoke image was drawn transposed and
  swept counter-clockwise. The echo now draws in the correct orientation and sweeps clockwise from dead
  ahead, matching the radar's rotation.
- **The radar spoke stream reconnects** automatically after a drop (a provider restart, a power cycle, or
  a network blip), and the panel reconciles control values and the operational status from the radar's
  live state.
- **The spoke stream carries the auth token**, so a token-secured stream connects rather than failing
  silently, and the device token is never sent to a cross-origin provider.

### Changed

- Radar controls parse both the array and object-keyed capability shapes, so the gain, sea clutter,
  rain, mode, and power controls render whichever shape a provider serves.

<a id="v0104"></a>

## [0.10.4] - 2026-06-26

### Fixed

- **Radar controls render again.** A provider's capabilities are read as the object-keyed map the
  Signal K radar API actually returns, so the gain, sea clutter, rain, and mode controls appear. The
  panel had shown nothing because the response shape was misread. When a provider serves no
  capabilities, the controls the radar reports at discovery are shown instead.
- **Vector charts served as `{z}/{x}/{y}` tile templates load.** Such a chart was requested with the
  placeholders unfilled and returned a 404; the template is now used as a tile source so the z, x, and
  y coordinates are filled in per tile.
- **Older recorded tracks draw correctly.** A track point saved by an earlier build without a speed
  value is normalized on load, so the speed-colored track line and the track statistics both read a
  number rather than breaking on a missing value.

<a id="v0103"></a>

## [0.10.3] - 2026-06-25

### Added

- Radar gain, sea clutter, and rain clutter can be switched to Auto, handing the level to the radar;
  moving the slider returns the control to manual. Each control that reports an auto capability shows
  an Auto toggle on its row.

### Changed

- The Radar menu tile now stays visible and grays out, with a hover tooltip, when no radar is
  detected, rather than disappearing from the menu. This matches the radar layer row and the other
  detect-and-degrade overlays (track history and AIS trails), so a capability never silently vanishes,
  and the tooltip points to installing a Signal K radar provider plugin.

### Fixed

- Binnacle now asks the Signal K server for read and write access, so the access-request approval
  defaults to read/write. A read-only grant silently blocked saving routes, waypoints, and tracks,
  starting and clearing a course, acknowledging alarms, and adjusting radar controls.
- Signal K stream subscriptions now send only the policies the server supports (instant and fixed)
  and no longer attach a fixed-rate period to an instant subscription, so the server stops logging
  policy warnings for Binnacle's stream.
- Chart, note, and symbol resources served by Signal K providers are validated before they render: a
  chart needs a name and type, a note needs finite coordinates, and a symbol needs a finite scale and
  anchor. A malformed entry or an error response is skipped instead of becoming a broken layer or a
  stray marker.

<a id="v0102"></a>

## [0.10.2] - 2026-06-25

### Added

- A Radar menu tile that opens the radar controls, shown only when a radar is detected, so the radar
  is reachable from the menu and not only from its layer row in Layers and charts.
- **The radar is easier to read.** A sweep wedge marks where the radar is currently scanning, with a
  short afterglow trail, so the picture reads as actively sweeping. Faint or small returns are now
  drawn at a minimum on-screen size, so a sparse echo stays visible whether you are zoomed in or out.
- The radar range rings are labeled with their range in nautical miles, so the rings read as a
  distance scale.
- Region tags on the regional chart sources in the Layers panel, so it is clear at a glance which
  area each survey-quality source covers.

### Changed

- AIS targets now uses a ship icon, and the marine radar shows the radar sweep icon on its controls
  panel, so each reads true. AIS previously borrowed the radar glyph while the radar had none.
- The Layers and charts panel is redesigned: flat rows, the opacity slider moved into a per-row
  popover, and the sources grouped into clearer categories.
- The radar controls panel is rebuilt to match the other side panels: one consistent field layout for
  its sliders and selects, with the range offered as a list of standard nautical-mile steps.
- The range rings are drawn bolder so they stand out over the chart, and the side-panel section
  spacing is unified so every panel shares the same rhythm.

### Fixed

- Several reactivity correctness issues found in a codebase sweep.
- The "Go to here" point no longer fires twice after a base-map style change: the long-press handler
  is now detached on teardown so a re-install cannot stack a second one.
- A disabled danger button (for example a delete control) no longer changes color on hover.
- Accessibility and consistency fixes across the menu system, the radar controls back arrow is scoped
  to its own entry, the radar range labels no longer read brighter than their ring, and the POI search
  close button has a descriptive label.

### Internal

- Added `docs/design-system.md`, the authoritative design and front-end build standard, and hoisted
  the shared row, card, panel-frame, note, and banner styles into global utility classes so panels
  stop re-implementing them.

<a id="v0101"></a>

## [0.10.1] - 2026-06-24

### Fixed

- **Marine radar now works against the Signal K v2 radar API.** The 0.10.0 radar read a
  provider-specific shape and never detected a radar on a real server. It is rewritten to consume the
  standard Signal K radar API at `/signalk/v2/api/vessels/self/radars`, with the controls and the
  protobuf spoke stream the spec defines, and the whole path (discovery, controls, and the live picture)
  is verified end to end against the mayara radar emulator. It still has not been tried on real radar
  hardware, so feedback through GitHub issues is welcome.

### Added

- **Read-write access note for radar controls.** The radar picture works with read-only access; adjusting
  the radar's controls needs read-write. The controls panel now says so when a change is refused, so you
  know to approve Binnacle for read and write on the Signal K server.

<a id="v0100"></a>

## [0.10.0] - 2026-06-23

### Added

- **Marine radar overlay.** Binnacle draws the live radar picture from a Signal K radar provider
  (mayara, with the older Radar SK as a fallback) on the chart: a polar sweep rendered with WebGL,
  range rings, and a heading line, in the "Traffic and live data" layers. It discovers the radar
  automatically and degrades cleanly on a server without one. Built to the Signal K radar spec and
  verified against a synthetic radar; it has not yet been tested on real radar hardware, so feedback
  through GitHub issues is welcome.
- **Radar controls.** A panel opened from the radar's row in the Layers panel exposes the radar's own
  controls (gain, sea clutter, rain clutter, range, transmit, and standby), built from whatever
  controls the radar reports.
- **Grayed-out unavailable layers.** A layer that needs a provider you do not have (the radar, AIS
  trails, or track history) now shows grayed out in the Layers panel with a hover note explaining what
  to install, instead of a switch that does nothing.

### Changed

- Updated Svelte, Vite, svelte-check, and Playwright to their latest releases.

<a id="v090"></a>

## [0.9.0] - 2026-06-22

### Added

- **Time travel.** Scrub the last 24 hours from a bottom strip: a marker walks the recorded track, a
  four-metric readout (depth, wind, barometer, and speed over ground) snaps to the scrubbed time, and
  the live vessel dims while you review. It reads the server history API and says plainly when no
  history provider is installed.
- **POI search.** A themed panel lists the points of interest in the current map view as a two-line
  list, sortable by name, type, distance, or bearing: each row leads with its category icon and name,
  then shows its distance and bearing below. Hovering or focusing a row rings that point on the chart
  without moving the map, and tapping a row rings it and opens its detail in the note popup, exactly as
  tapping the marker on the chart does, so you can click through results while the list stays open.
- **Configurable bottom bar.** Choose which actions ride the bottom bar. A "Customize bottom toolbar" mode
  in the menu pins or unpins any action (Center, Follow, Charts, Forecast, Tides, Anchor, and the rest);
  Center, Follow, and Charts are pinned by default. The choice is saved with your profile and follows
  you across devices. Pin more than fit and the extras collapse into a "More" button.

### Changed

- The AIS targets list and the POI search now share one row and sort style, so the two panels read
  and behave the same: a full-width sort control above a column of two-line rows.

### Removed

- The plotter-extensions integration is gone: Binnacle no longer surfaces third-party Signal K
  plugins' own buttons, panels, widgets, or iframes on the chart. Plugin data still renders through
  Binnacle's own overlays (points of interest and notes, routes, waypoints, charts, and the symbols
  from signalk-symbol-manager); this only drops the plugins' injected UI, which did not match the
  app's design and duplicated built-in features such as the POI search.

### Fixed

- On a secured Signal K server, the points-of-interest, AIS-trail, and history-track overlays now
  fetch with a live auth token. They captured the token at map load, before sign-in finished, so they
  stayed unauthenticated for the whole session and never loaded their data; the token is now read at
  fetch time, the way the rest of the app already reads it.
- Offline caching sweeps stale precache entries from earlier builds, so a returning visit no longer
  serves an outdated asset alongside the current one.
- The point-conditions valid-time line renders with its space restored before the middot ("Observed ·
  14:30" rather than "Observed· 14:30").
- A collision alarm now goes silent the instant the danger clears, instead of playing out the rest of
  the beep burst it was partway through. Scheduled beeps are stopped, not just the repeating interval.
- A failed file read while importing a route GPX or a profile JSON file now shows "Could not read that
  file." instead of doing nothing, so a flaky USB read is not mistaken for a cancel.
- A restored man-overboard mark is rebuilt from its known fields, so an unknown persisted field cannot
  carry into the live mark.
- The anchor controls use a freshly approved auth token at once: a token that arrives or changes
  mid-session is now read live, so an anchor action no longer needs a page reload to authenticate.
- A plugin enabled while the data stream was down (history, notifications, or anchor) is detected when
  the stream reconnects, instead of staying dark until the page is reloaded.
- The "Here" conditions panel keeps reading the latest sample as a live observation during a long open
  with no weather layer loaded, rather than drifting into treating it as a forecast step.
- A display token is corrected: the default waypoint marker and the disabled course-skip control hold
  their colors under the night-red theme.

### Changed

- Accessibility and packaging: the active saved item (the active profile or route) is now announced to
  assistive technology with aria-current, matching its visual accent, and the browser tab and the
  Signal K admin webapp view now show the Binnacle favicon.
- Internal: a reuse pass routed the remaining AIS, anchor, collision, MOB, notes, route, tides, track,
  and weather overlays through the shared map source helpers, with no behavior change.
- Internal: a large modularization pass broke the biggest files into cohesive modules, components, and
  controllers without changing behavior. The App.svelte composition root, the WeatherMap and ChartCanvas
  widgets, the routes, layers, and weather panels, the notes overlay, and the pmtiles, themed-map,
  wind-gl, and route-draft modules were split; the global stylesheet was split
  one concern per module; and a whole-codebase reuse pass consolidated shared helpers (object guards,
  GeoJSON source updates, the icon-offset expression, the JSON-or-default fetch helper, and the
  provided-symbol overlay resolver). No user-facing behavior change.
- Internal: a whole-codebase consistency pass unified the four modal dialogs behind one shared frame,
  the two collision surfaces behind one severity-color definition, and the safety-band overlays behind
  one helper; named the remaining magic values; removed dead exports; tightened a few reactive and
  hot-path operations; and held the design system to its tokens. No user-facing behavior change.

<a id="v080"></a>

## [0.8.0] - 2026-06-20

### Added

- Plotter extensions. Binnacle now hosts third-party plotter add-ons that other Signal K plugins ship,
  implementing the Plotter Extensions API. An extension can place action buttons in the footer toolbar
  (capped at three, with a More menu for the rest), slide-in side panels, on-chart instrument widgets,
  and live display filters that hide non-matching markers and show a clearable chip. Widgets are placed
  with a long press on the chart, which opens the context menu's Add widget item, and packed into the
  chart corners. Try it with signalk-instrument-widgets and signalk-poi-search. With no extension
  plugin installed nothing renders and the chart is untouched.
- Custom waypoint icons. When you drop a waypoint you can choose its icon from Binnacle's built-in
  markers plus any symbols the signalk-symbol-manager plugin provides for the waypoint role, and each
  waypoint renders with its chosen symbol. Icons resolve through namespaces: `binnacle:` is Binnacle's
  built-in library (the default for a plain icon id), `custom:` is your own symbols from
  signalk-symbol-manager, and an icon another app stored in its own namespace still renders so nothing
  placed elsewhere disappears. The symbol rendering here was contributed by
  [Joel Kozikowski](https://github.com/joelkoz) in
  [#6](https://github.com/NearlCrews/signalk-binnacle/pull/6).

### Fixed

- Saved tracks stay on screen when a periodic refresh hits a transient network failure, instead of
  briefly blanking the list. This matches how routes and waypoints already behave.
- The severe-weather banner no longer ranks a thunderstorm watch, a storm-surge advisory, or a
  tropical-storm watch above a gale warning.
- Chart map instances are fully released on teardown, closing a pointer-listener leak that kept a
  map alive after the chart was destroyed.

### Changed

- Internal consolidation and performance work across the app: shared modal, button, and numeric
  readout styling unified into the global utilities, and several render and per-tick paths made
  cheaper (the map layer ordering, the resources filter regex, and the overlay draws). No change to
  behavior beyond the fixes above.

<a id="v071"></a>

## [0.7.1] - 2026-06-17

### Fixed

- The App Store listing no longer shows broken image placeholders in its README view. The README
  carried a screenshots section whose image paths were not part of the published package, so they
  could not load there. The screenshots shown in the App Store carousel were always present and are
  unaffected.

<a id="v070"></a>

## [0.7.0] - 2026-06-17

### Added

- AI route drafting. Describe a passage in plain language, for example "from here to Avalon, stay 3 nm
  off the coast", and signalk-crows-nest drafts a route you review and save. The draft opens as an
  editable working route with a not-chart-verified banner, the read-as destination, the model's note,
  a fuel estimate in your units, any land, shallow, hazard, or fuel flags above the leg table, and a
  note when the model marks the draft low confidence.
  Charted point hazards are grouped per leg, so a hazard-dense river or harbor passage reads as one
  count plus a short breakdown rather than dozens of lines. Each leg is checked against charted and
  modeled marine data that varies by region, and every flag states its source and datum; the absence
  of a flag is not proof of clear water. It cannot be minimized while a draft is up, and it saves only
  behind an armed "I checked every leg" confirm. The control appears only when signalk-crows-nest is
  installed at a version that ships the route-draft endpoint; on a stock server it stays hidden, with
  no error.
- Optimize a drawn route. While editing a route, tap Optimize and signalk-crows-nest returns an
  improved route, with safer and more detailed turning points and a more efficient track, opened in
  the same review-before-save draft panel with its per-leg flags. It is one tap, with an optional
  one-line constraint such as "stay 3 nm off", and it is non-destructive: Cancel restores your
  drawing, an unchanged result says so, and hand-editing the result accepts it as a normal route you
  can save or optimize again. Like drafting, it appears only when signalk-crows-nest is installed at a
  version that ships the route-draft endpoint.
- AIS course vectors. Each moving AIS target draws a short predictor line projecting its position
  about ten minutes ahead along its course at its speed, red for a danger contact and amber for a
  warning, so a crowded screen shows at a glance which targets are moving and which way. A
  stationary target shows no vector. (#3)
- Start a route from the chart. The right-click and long-press menu adds "Start a route here" under
  "Go to here": it opens the routes panel, begins a new editable route, and drops the first waypoint
  at the spot you picked, so you start a route from the chart in one step and then tap the rest.
- Route editing shows the route's waypoints as dots, the way a saved route looks, the moment you
  draft, optimize, or edit one, rather than only after you tap the line. Tap a leg in the panel's leg
  list and its segment and both end dots light up on the chart, with the chart easing to the leg when
  it is off-screen; tap a dot on the chart and the legs it joins light up in the list. Drag a dot to
  move it, tap a midpoint to insert one, or delete a waypoint, with the dots visible throughout.

### Changed

- The main menu now opens as a dropdown anchored under the menu button in the top corner and grows
  from that corner, instead of appearing as a panel centered on the screen. It is a compact
  three-column grid of labeled tiles grouped by section, dismisses on an outside tap or Escape, and on
  a phone-width screen docks to the bottom edge as a sheet. The main menu and the weather layer menu
  now share one anchored-dropdown primitive, so they open, position, and close the same way.
- Adding a chart by URL now reads its header and metadata through the same cached, retrying source
  the map tiles use, so re-adding the same chart, and its first render once added, hit the
  IndexedDB block cache instead of refetching over the network.
- Internal consolidation with no behavior change: the map overlay lifecycle, the rhumb-line
  geometry, the weather and tides display helpers, the GPX coordinate guards, the bounding-box and
  number-format helpers, the symbol registry, the map layer ordering, and the panel, icon-button, and
  numeric-readout styles now route through the existing shared primitives, design tokens, and utility
  classes.
- Hardening across the data and caching layers: the coordinate and Signal K delta guards reject
  non-finite and malformed values, the tide client drops bad readings and a no-data error response,
  the recorded-track in-memory fallback is bounded, the PMTiles and IndexedDB stores survive a
  concurrent write and another tab's upgrade, and the Escape-dismiss stack and arrow-key focus are
  made robust. The course readout uses a server-supplied ETA for a single-mark destination, and a
  route saved from a draft with no name falls back to a dated name. The layer manager now owns
  invalidating each overlay's change-detection cache on a base-style swap, so a cached overlay does
  not stay blank after a style reload, rather than each overlay carrying that duty itself. The AIS
  list keeps a non-finite range or CPA from scrambling its sort order.
- Further internal consolidation and small efficiency wins, no behavior change: more overlays and
  panels route through the shared feature-collection, layer-visibility, coordinate, and numeric
  guards and through the shared confirm-actions style and a new warning-tint token, so a caution
  control tints amber rather than red; the all-vessels context and the notification-path prefix have
  one home; and the weather-overlay registration, the route name reconcile, the collision severity
  map, and the AIS duration parse drop per-event allocations. The tidal current set is stored in SI
  radians like every other angle, converted to degrees only in the readout.
- Further internal consolidation, no behavior change: the resource and notification clients share one
  JSON-request helper; the map layer-ordering rank, the chart overlay's layer-id list, and the
  base-map theme pass are each computed once and reused; the AIS trails client reuses the shared
  bounding-box type; the working-route overlay builds each source its own empty collection; the notes
  overlay registers its marker icons concurrently; and the entity stores publish the remaining
  cross-feature types (collision source, measure leg, track stats, tides status, and anchor default
  radius) through their public index.

### Fixed

- The weather mini-map's tap readout no longer writes to a torn-down component if a provider answer
  arrives after the panel is closed.
- Offline and runtime caching works again in a secure context. The service worker's chart-tile,
  overlay, weather, and radar cache rules referenced module constants that did not survive into the
  generated worker, so the first matched fetch threw "CHART_TILE_PATH is not defined" and broke
  caching wherever the worker is active (HTTPS). The cache matchers are now self-contained.
- The route panel's Waypoints and Time readouts line up in their columns again. Their rows lacked the
  empty unit cell the three-column stat grid needs, so every value below shifted out of its column.
  The Time readout also splits its value and unit, so a minutes reading lines its "min" up in the
  unit column under the distance's "nm".
- Charted notes sit on their charted point again, and a console error on every map hover is gone. A
  provided symbol's pixel offset was read from an array feature property, which MapLibre coerces to a
  string; the offset now rides on the layer as a per-icon match.
- Drawing a route on the chart no longer disappears on the second tap, and the waypoint count
  reflects the points you place rather than the cursor. The chart editor mistook the draw library's
  cursor point, which carries the same tag as the route line, for the route itself, so the second tap
  read zero waypoints and cleared the route; it now selects the route by geometry, drops the trailing
  cursor point from the count and a save, and defers its working-line cleanup so the draw completes. (#1)
- "Go to here" now draws the course line from the vessel to the destination, and a destination
  marker, on the chart, not just the destination readout in the nav strip. The same line shows the
  current leg of a route under way. (#2)
- AIS collision alerts no longer cry wolf in a busy marina or at anchor. A moored or swinging boat
  (under one knot) is no longer flagged as a danger to a vessel that is itself anchored or near
  stationary, and the audible alarm is silenced while anchored, with the danger strip still visible
  and a genuinely close, imminent contact still sounding. (#4)
- A Signal K data worker that fails to load (a bundling or chunk error) now surfaces a connection
  error instead of leaving the app stuck on "connecting" with no signal.
- Weather precipitation, wave-height, and tide-station overlays redraw after the base map style
  reloads (the offline fallback) instead of staying blank until their underlying data next changes.
- A route or track that crosses the antimeridian (180 degrees) fits the chart the short way across
  the dateline instead of framing nearly the whole globe.

<a id="v062"></a>

## [0.6.2] - 2026-06-13

A full-codebase reliability, correctness, and coherence pass, plus a weather-panel layer menu. It
hardens the weather overlays, the caching and history layers, the course and anchor logic, makes a
set of previously silent failures visible, and moves the weather layer toggles into a floating menu.

### Changed

- The weather panel's layer toggles move from the header pill row, which ran out of room and
  truncated, into a single layers menu opened from a floating button at the upper left of the
  mini-map. The button lights and shows a count whenever layers are on, the menu groups the area
  fill and the overlays and carries the source line, and it docks as a bottom sheet on a narrow
  panel so it never covers the small map from the top. The one-tap Here conditions control stays
  in the header.

### Fixed

- Pressure isobars no longer stay blank after the base map style swaps (the offline fallback or a
  style reload): the overlay rebuilds its recreated sources instead of seeing an unchanged grid.
- The in-memory cache no longer evicts a just-refreshed weather grid or tide entry before older
  ones, so a refreshed view is not dropped early and refetched.
- A corrupted or legacy profile can no longer render a chart layer transparent or broken: a
  restored opacity is clamped to a valid range, matching first-registration.
- A malformed history timestamp no longer disables gap-splitting for the rest of a 24 hour track.
- The Trends panel can tell a present-but-empty history provider from an unreachable one.
- An active course's route, next, and arrival geometry survives a cross-station activation even
  when the continuously-updating calc values stream in before the one-time hydration completes.
- A dead data link (the worker failing to load, a rejected connect) shows a "Data link failed,
  reload" indicator instead of sitting forever on a connecting state.
- One chunk-load failure no longer kills route editing for the rest of the session.
- A failed track save or delete, a refused anchor drop on a server that advertises the standard
  Anchor API, a failed user chart registration, an empty-and-failed route fetch, and a chart that
  did not sync to the server all surface an error or a log breadcrumb now instead of going silent.
- The arrival alarm is stopped on teardown, profile sync retries after a transient first failure
  instead of staying local-only for the session, and a unit preset from a previous server is
  cleared when reconnecting to a different one.
- The layer opacity slider is a full-size touch target again, panel error lines use the shared
  alarm framing, and the chart action menu supports arrow-key navigation.

### Internal

- IndexedDB and local-storage degrades, and an unavailable audible alarm, now log a one-line
  breadcrumb so a field report is diagnosable.
- Shared cleanups: one safety-button gutter rule, the collision overlay on the shared layer
  helpers, the tracking token on the alarms tag, anonymous access-request fetches, named collision
  threshold constants, a once-computed day paint object, and a dropped redundant per-tick sort.
- New tests cover the stream connection and worker lifecycle, the unit conversion family, the
  anchor acknowledge escalation, client-computed course VMG and time-to-go, and several boundary
  and error paths the audit found untested.
- A shared rovingFocus arrow-key action and an overlay-backdrop utility class now back both the
  chart context menu and the new weather layers menu, replacing duplicated handlers and CSS, and
  the chart context menu moved onto the shared Escape dismiss stack. The now-unused scrollEdges
  action was removed.

<a id="v061"></a>

## [0.6.1] - 2026-06-12

Quick access from community feedback: the chart actions a navigator reaches for stay within one
or two taps, and the weather panel's layer row scrolls honestly instead of clipping its last pill.

### Added

- Measure from the chart: the long-press and right-click menu gains "Measure from here", arming
  the measure tool with its first point at the pressed position, so measuring starts where you
  are looking instead of via the app menu. Re-arming mid-measurement deliberately starts fresh;
  extending an in-progress measurement is a plain chart tap.
- A Charts pill on the bottom status strip opens Layers and charts in one tap, beside Center,
  Follow, and Forecast, so switching charts no longer goes through the app menu.

### Fixed

- The weather panel's layer pills no longer render the last label clipped: the edge fade shows
  only while there is actually more to scroll, lifts at the end of the scroll, and the pills
  keep their natural width instead of compressing when the panel narrows, so the row genuinely
  scrolls.
- The chart context menu sizes itself to its longest label, so its edge-clamp math matches the
  rendered box.
- Voice control can activate the Charts pill by its visible word, its expanded state is not
  announced while it is still disabled during chart load, and its tooltip says the chart is
  loading while it is.

### Internal

- One armMeasure helper replaces the duplicated reveal-then-arm sequence, new measure tests pin
  the seed-after-arm contract and the deliberate reset on re-arm, and CI test flakes from cold
  ICU loading are prevented by a per-worker warm-up rather than per-test timeouts.

<a id="v060"></a>

## [0.6.0] - 2026-06-12

A reliability and correctness pass across the whole app: course following, the collision and anchor
watches, weather, charts, tides, and profiles, with the safety alarms now holding up in a
backgrounded browser tab. Plus: the app menu is a new tile launcher, every readout follows the
server's imperial-or-metric unit preference, and route editing loads on demand.

### Added

- Imperial and metric display units across the whole app, following the Signal K server's unit
  preferences (Server Config, Unit Preferences) with a per-profile local fallback on older
  servers. Depth, anchor distances and radius, MOB range, measured legs, tide heights and station
  range, temperatures, pressure, precipitation, wave heights, and visibility all convert; knots,
  nautical miles, bearings, and the hPa isobar convention stay nautical.
- The app menu is now a launcher: large icon tiles grouped Navigate, Conditions, Safety, and
  Settings over a dimming scrim, bottom-anchored on phones for one-handed reach, with Forecast
  now findable in the menu. Both alarm mutes moved into a new Alarms panel beside the collision
  thresholds.
- The measure layer supports opacity like every other overlay, starting Measure re-shows a hidden
  measure layer, the Tides panel cross-links its stations layer with a show-on-chart toggle, and
  layer opacity sliders have a floor so a checked safety layer can never be dimmed invisible.
- The Terra Draw route editor loads on first use instead of at startup, trimming the initial
  bundle by about 137 kB for faster cold loads on Pi-class displays.
- Standard waypoints: drop one from a long press on the chart, see them as named markers, and
  locate, go to, rename, or delete them from the new Waypoints panel. They live in the server's
  own waypoint resources, so they interoperate with Freeboard-SK and every other client.
- An Active alerts list in the Alarms panel: every notification on the boat (engine, NMEA2000,
  autopilot, or any plugin) surfaces with severity, time, and one-tap Silence and Acknowledge
  that propagate to every station on a 2.28 server.
- Collision and MOB alerts ride the server's v2 Notifications API when available (server-managed
  ids; muting locally silences the boat-wide alert), with the v1 delta publish kept for older
  servers. Server capabilities are detected once from the features endpoint.
- The anchor watch speaks the standard Anchor API the moment a server ships it (the proposal's
  drop, raise, radius, and reposition routes, feature-detected), ahead of the existing
  anchoralarm-plugin path and the client-local watch.
- Custom chart symbols from the signalk-symbol-manager plugin: a note whose icon reference
  resolves to a managed symbol renders that symbol (scale and anchor honored), and a provided
  "waypoint" symbol replaces the built-in waypoint marker. At night-red, user artwork is remapped
  into the red band so the theme's no-color rule holds. Without the plugin, every icon stays
  built-in.

- Worldwide tides through the signalk-tides plugin when the server runs it (NOAA, Neaps,
  WorldTides, or StormGlass per its configuration), with the NOAA CO-OPS path unchanged as the
  fallback; the Tides panel says which source served.
- AIS target trails from the tracks plugin: faded wakes behind moving targets, themed for all
  three themes, fetched only when the plugin is present and the layer is visible.
- Offline charts that actually work: PMTiles archives are cached as blocks in browser storage at
  the protocol layer, so previously viewed chart areas render offline in every context, including
  the plain-http default where no service worker can run (the old service-worker chart cache
  provably never stored anything: range responses cannot enter the Cache API). Plugin-served
  raster chart tiles, the seamark, bathymetry, boundary, and ice overlays, the base-map style,
  and CO-OPS predictions gain service-worker caching over https, with per-cache bounds and quota
  protection; opaque cross-origin responses are no longer cached (each one padded several MB of
  quota).
- Tide stations and predictions, chart notes, and the vessel conditions panel now persist in
  browser storage, so a reload with no signal replays the last data for the area, each item
  declaring its own age, over plain http as well as https.
- When the base map style itself is unreachable (plain http at sea with no internet), the map
  starts on a minimal water-colored fallback instead of staying blank, so cached charts and
  every overlay still load. The real base map returns on the next load with connectivity.
- A Trends panel: depth, apparent wind, barometric pressure, and speed over the last 24 hours
  as themed graphs, served by the server's v2 History API when a history provider runs
  (signalk-questdb, signalk-to-influxdb2, or signalk-parquet), with provider fallback when the
  default provider has no data. Without one, the graphs show the current session, sampled live.
- A "Track history (24 h)" chart layer: the vessel's server-recorded last day as a dashed line
  under the live track, gap-split across stops, opt-in from the Layers panel and only queried
  while shown.

### Removed

- The browser-local PMTiles file upload. Chart files belong on the server: install the
  signalk-pmtiles-plugin and drop .pmtiles files in its charts folder, and they appear in
  Binnacle on every device automatically. Adding a chart by URL is unchanged and still syncs to
  the server. Previously uploaded browser-local charts are dropped cleanly at upgrade.

### Changed

- Delta batching in the stream worker now runs on a timer instead of requestAnimationFrame, and
  AIS staleness pruning runs on a wall clock instead of the render loop, so live data keeps
  flowing and the collision and anchor alarms keep evaluating while the tab is hidden.
- An AIS target that stops reporting is now dropped after seven minutes, so anchored traffic with
  a slow AIS refresh no longer flickers in and out of the target list.
- Track recording no longer accumulates points while the boat sits at anchor: session gaps are
  detected from fix continuity, not motion.
- Cancelling MOB and raising the anchor are now two-tap confirms, and deleting a profile or a
  saved track asks first, matching the route delete.
- Escape handling is one shared topmost stack across the panels, the menu, and the measure tool,
  so Escape always closes the surface on top and never one underneath.
- Layer drag-to-reorder now stays within the layer's own category instead of crossing into the
  next section.
- Opening the Tides panel on a cold start is faster: the tide predictions and the current-station
  lookup now fetch concurrently instead of back to back.

### Fixed

- Editing a route no longer strips its waypoint names.
- The nav strip no longer shows the next waypoint's arrival time as the whole-route ETA.
- An active course now survives a page reload: the course state hydrates on first connect, and
  the route's Active badge tracks the server, including courses started or cleared from another
  station.
- Arrival no longer re-alarms from GPS jitter at the arrival circle; the alarm latches until the
  boat clearly leaves the circle.
- A failed waypoint skip and a partially failed GPX import are now reported instead of passing
  silently.
- At night-red the own vessel, the AIS targets, and the note icons are no longer hidden along
  with the base map's sprite icons.
- An acknowledged collision alert re-arms once the situation clears, and a contact's severity
  downgrade has hysteresis, so the alarm can neither stay silently dismissed nor flap between
  danger and warning.
- A target reporting speed without a course is no longer modeled as steaming due north, and
  contacts with provider-supplied CPA keep classifying during an own-fix dropout.
- The anchor watch announces a degraded state when GPS is lost, and an anchor-marker drag the
  system cancels no longer silently relocates the anchor.
- The MOB strip dashes out bearing and range on a stale fix instead of presenting frozen numbers
  as live.
- Wind particle colors now match the legend's absolute scale.
- Radar frames refetch on schedule: the cache no longer extends its own expiry on every read.
- A partial forecast no longer stretches stale wave pixels over a new viewport, and overlapping
  forecast loads can no longer finish out of order.
- The conditions panel's forecast section falls back to the free grid when a provider returns an
  empty series, and the weather panel's clock notes stay live during a long open.
- Deleting a user chart no longer leaves it in the persisted layer state, and renaming one
  updates its Layers row and its server resource.
- Tide times are correct when the browser's time zone differs from the station's (predictions
  are now requested in GMT), tide data refetches after midnight at anchor, and the on-chart tide
  label no longer shows past events.
- Tide fetches are skipped entirely while nothing displays them.
- Note markers recover after a failed or superseded fetch instead of freezing until reload.
- A transient network failure at startup no longer wipes the stored auth token, and a failed
  access request retries instead of hanging at "Requesting access".
- Profiles no longer show "unsaved changes" on every launch, deleting all profiles no longer
  resurrects the starter profiles, and a synced device no longer marks a profile active without
  applying it. A failed profile import shows an error.
- A refused alarm Silence or Acknowledge now shows an error in the Alarms panel instead of the
  alarm just continuing to sound, and a collision alert whose server notification was cleared
  from another station is re-raised instead of going silent.
- Cleared notifications no longer linger in the Active alerts list, and an unchanged
  notification broadcast no longer re-renders the panel.
- AIS wakes now clear after a few minutes of failed refreshes instead of freezing in place, and
  waypoint markers have their own color in each theme.
- The weather panel's layer pills stay on one scrollable row at every window width instead of
  wrapping into a second header row.
- A trend history load that resolves out of order can no longer overwrite a newer result, and a
  failed load shows its failure note instead of loading forever.
- A trend metric requested twice on one path with different aggregates now maps to its own
  column instead of mirroring the first.
- A tide reading replayed from the offline cache remeasures the station distance from the
  current position, so a reading cached a few kilometers away cannot misjudge the coverage
  radius or misstate the range.
- Muting the collision alarm from the danger strip now reports a refused boat-wide silence in
  the Alarms panel, matching the panel's own Silence and Acknowledge.
- Losing authorization mid-session no longer makes the collision notifier abandon its server
  notification id; the v1 delta fallback carries the change until the server accepts again.
- A unit preset changed on the server while the link was down is picked up on reconnect.
- The offline cache's third-party host matchers accept only the real weather and radar domains
  and their subdomains, not lookalike hostnames that merely end in the same letters.

### Internal

- Map tile, WebGL shader, and PMTiles resources are released on teardown, dead exports and the
  unused weather view persistence were removed, and assorted hot-path allocations were trimmed.
- Shared bbox helpers, a shared test fetch stub, the shared input primitive, and one global
  segmented-control rule replaced per-feature copies.
- The notification mirror compares the four status flags directly instead of serializing the
  status object on every delta, a coordinate-cell quantizer shared by the tides and weather
  caches replaced two copies, an IndexedDB store that degrades to memory now logs one
  diagnostic breadcrumb, and the alarm mute rows sit on the shared button base. New tests cover
  the session trend recorder, the notification dedup, the refused silence and acknowledge
  paths, and the history provider fallbacks.

<a id="v050"></a>

## [0.5.0] - 2026-06-11

A safety-focused redesign of the man-overboard confirm, a broad weather-panel upgrade (more
decision data, honest provenance, and accessibility), and a new app icon.

### Added

- **Gusts without a provider.** The free forecast grid now carries wind gusts, so the reefing
  number shows in the tap readout and the vessel conditions panel even with no weather provider
  configured.
- **Barometric tendency.** The conditions panel shows the trend a sailor decides by ("falling
  1.2 hPa/3 h"): the provider's own tendency when it reports one, otherwise computed from the
  trailing three hours of the forecast grid.
- **More conditions data.** Wave and swell direction (labeled "from"), visibility, and water
  temperature appear when the source carries them, and the current block is tagged Observed or
  Forecast with its valid time and zone.
- **Forecast provenance.** A footer states the source and fetch time, the stale note says how old
  the shown forecast is, and a grid missing its requested wave fields is qualified rather than
  passed off as complete.
- **Radar honesty.** The legend names the frame the loop is painting (for example "frame
  -40 min"), extrapolated nowcast frames are labeled as such, cached radar is flagged when
  offline, and the radar hides while the time slider is away from now instead of painting live
  rain over a three-day-out wind field.
- **Slider orientation.** A tick marks now on the forecast slider, the label carries Past or
  Forecast plus the time zone, and a one-shot note explains the zoom cap the first time you
  pinch into it.
- **New app icon**, aligned with the rest of the plugin family: a compass rose on a white
  compass-card badge over the shared ocean-wave mark.

### Changed

- **Man overboard confirm.** Pressing MOB now opens a centered dialog. The position is captured
  at the press, so the seconds spent confirming can no longer carry the mark away from the
  person; the confirm only gates the alarm. One full-width Mark man overboard button sits in the
  one-handed thumb zone with a quiet Cancel stacked above it, the dialog self-dismisses after 15
  seconds with a visible countdown (a re-press shortly after reuses the earlier press-time fix),
  and without a GPS fix the boat-wide alarm still raises, position-less, with a clear warning.
  The recovery strip adds the wall-clock Marked time for the log and the VHF relay.
- **Weather opens at now.** The time slider seeds to the forecast step nearest now instead of
  the start of the series, which begins up to a day in the past.
- **Conditions track the slider.** With a weather provider configured, the Here panel re-picks
  the forecast step as the slider moves, and it falls back to the free grid when the provider
  fails instead of freezing a one-shot sample.
- **Warnings.** Sorted most severe first, with the issuing source and the validity window, at a
  readable size; free mode now says warnings are unavailable instead of showing a silently empty
  list.
- **Legends.** Wind in whole 10-knot bands, cloud in whole percent, and weather readouts in
  whole knots.
- **Night-red.** The map attribution control follows the theme on both maps instead of rendering
  as a bright white bar.

### Fixed

- The tapped readout blends the two forecast steps exactly as the drawn fields do, so the number
  can no longer disagree with the picture under the finger by a full step.
- Weather provider detection re-runs when the auth token arrives or the stream reconnects; one
  failed probe no longer locks the whole session onto the free sources.
- The latest observation is picked by date rather than response order, and a provider's last
  forecast step no longer answers for a time days past its horizon.
- A rate-limited marine (waves) endpoint no longer blocks the healthy atmospheric fetch, so
  turning waves off recovers immediately.
- Provider precipitation is labeled as the accumulation it is (mm), not a rate.
- The course strip no longer covers the weather panel's slider and legend while a route is
  active; the strips lift to the panel's top edge instead.
- Accessibility: the forecast slider announces real times instead of epoch milliseconds, manual
  time changes are announced, the floating map notes are reliable live regions that stack
  instead of overlapping, scrubbing stops playback so the thumb is not yanked back mid-drag,
  Enter on the focused mini-map samples the center, and the tap readout can be pinned (hover or
  focus) and dismissed.

<a id="v040"></a>

## [0.4.0] - 2026-06-10

Four new at-sea features (an anchor watch, a man-overboard button, a measure tool, and an AIS
target list) plus shell refinements from helm feedback.

### Added

- **Anchor watch.** Drop the anchor at the boat, set the swing radius by hand or capture it from
  the live distance plus a margin, and get a drag alarm after three consecutive fixes outside the
  circle. The alarm latches until acknowledged, so a boat that swings back inside cannot silently
  clear an alarm you never saw, and the watch survives a reload. When the signalk-anchoralarm-plugin
  is installed, Binnacle drives it instead, so the alarm keeps running with the browser closed; the
  panel says which mode is watching. On the chart: the swing circle, a rode line, and a drop-point
  marker you can drag to where the hook actually lies.
- **Man overboard.** An always-visible MOB button centered in the top bar. One tap pops out a
  large confirm (so a stray tap can never raise the alarm, and the window self-dismisses); the
  confirm marks the spot, publishes the boat-wide `notifications.mob` alarm so every station sees
  it, flies the chart to the mark, and raises a recovery strip with live bearing, range, and
  elapsed time. Steering to the mark stays a deliberate second tap (Steer to MOB) through the
  course system, never automatic, since a coupled autopilot may follow the course. An MOB raised
  by another station shows here too, and the mark survives a reload.
- **Measure tool.** Arm it from the menu, tap points on the chart, and read each leg's range and
  bearing plus the running total, with the total labeled at the last point. Undo, Clear, Done, or
  Escape.
- **AIS target list.** Every tracked target as a tappable card with name or MMSI, live range and
  bearing, SOG, and CPA and TCPA when available, sortable by range, CPA, or name, with the
  lookout's severity coloring risky contacts and a tap flying the chart to the target.
- A depth readout in the anchor panel when a sounder publishes `environment.depth.belowTransducer`.

### Changed

- The footer's "Connected" text is now a compact status dot: green by day and dusk, a calm dim red
  in night-red (which forbids green), and the caution color while the stream is down. The label
  remains for screen readers and the hover title, and the dot stays on phones where the word used
  to be hidden.
- The trailing position cluster's numerals now take the same instrument-readout size as the
  leading AIS, SOG, and COG readouts, so the footer reads as one instrument row.
- The four feature alarms now share one edge-triggered core (`GatedAlarm`), with the collision
  alarm keeping its escalation-overrides-mute policy on top; tones are unchanged, and each alarm
  remains audibly distinct (MOB above the collision two-beep, anchor between collision and
  arrival).

### Fixed

- The MOB trigger's boat-wide notification never actually left the browser: the position object
  read from the live store is a reactive proxy, which cannot be structured-cloned into the stream
  worker, so the publish threw and was lost while the local strip looked fine. The mark is now
  snapshotted into a plain object, with a regression test, and the round trip is verified against
  a live server.

<a id="v031"></a>

## [0.3.1] - 2026-06-10

A pass over the existing features for safety, honesty under failure, performance on modest hardware,
and accessibility, plus a few navigation additions.

### Added

- Honest data-staleness signals. When the position feed stops, the footer shows a calm "No GPS fix"
  note and dashes SOG and COG instead of presenting a frozen speed and course as if they were live,
  and the collision watch and the course guidance stop computing against the stale fix. The connection
  badge turns to a caution color and reads "Reconnecting" or "Not connected" during an outage instead
  of staying "Connected".
- A cross-track deviation needle (a CDI) on the nav strip, so steering to track is a glance rather than
  a number read, with a caution color when it pegs at full scale.
- An on-screen arrival banner paired with the arrival tone, for a helm with the volume low.
- A footer "AIS" chip showing how many targets the collision watch is tracking, so an empty danger
  strip reads as all-clear rather than as a possible failure.
- A status note in the weather panel (loading, offline, or showing the last forecast) instead of a
  blank or silently outdated map.

### Changed

- The collision-alarm mute is now session-only and auto-expires after ten minutes, then re-arms; it is
  no longer persisted across a reload or carried by a profile, so a mute set in a crowded anchorage
  cannot silently follow you into the next passage. A close, imminent contact (inside about 0.1 nm and
  two minutes) overrides both mute and acknowledge, so a real emergency always sounds. Acknowledging a
  danger now keeps the strip on screen, dimmed, with its CPA and TCPA, while the target is still
  closing, instead of hiding it.
- Deleting a route now asks to confirm, with distinct wording when the delete will also stop active
  navigation. The nav strip disables waypoint-skip at the first and last points and keeps a gutter
  before Stop, so a mis-tap cannot end navigation.
- The footer SOG and COG step up to the full instrument-readout size, the numbers a helmsman glances
  at most.
- Performance on the Raspberry Pi: the chart's overlays no longer sync at full frame rate while idle
  (they update on real map repaints plus a low-frequency tick and pause when the tab is hidden), the
  weather fields and the wind particle field stop forcing continuous GPU work, and a long track
  simplifies incrementally rather than re-processing the whole track on every fix.
- Signal K conformance: TCPA accepts the spec's ISO-8601 duration form, the nav strip prefers the
  server's estimated time of arrival when a provider supplies it, the client-side course fallback uses
  consistent rhumb-line geometry, and a target that stops reporting is dropped after three minutes
  rather than six.
- Resilience: in-app requests time out instead of hanging on a half-open link, the local chart and
  track stores recover after a transient IndexedDB failure instead of dropping to memory for the
  session, the stream reconnects immediately when the network returns, and persisted charts and
  profiles are validated on load so a drifted entry is dropped rather than trusted.
- Accessibility: opening a panel moves focus into it, the Forecast and Here toggles use aria-expanded,
  in-place confirm and review steps move focus to their new control, a failed chart import is
  announced, and the app menu stays open when a mute toggle is flipped.

### Fixed

- The wind particle field no longer freezes after switching away from and back to the browser tab.

<a id="v030"></a>

## [0.3.0] - 2026-06-09

### Added

- Profiles: named bundles of your settings (theme, which layers are on, their opacity and order, the
  weather layers, the collision thresholds, the track and planning settings, and the alarm mutes) that
  you save, switch between, rename, delete, and set a default for. A switcher pill in the top bar shows
  the active profile and opens a Profiles panel; applying a profile updates the chart live, and tweaking
  a setting marks the profile as edited so you can save the change or discard it by switching away.
  Three starter profiles (Coastal day, Night passage, and At anchor) seed on first run. Profiles are
  stored locally, and when you are logged in to a secured SignalK server they also sync through the
  server's applicationData store so they follow you across devices. The sync degrades cleanly: an
  unsecured server, or a login that cannot use the applicationData store, keeps profiles local, and a
  login that can read the store but not write it stops after one rejected write rather than retrying on
  every edit, so it never floods the console. You can also export a profile to a JSON file and import
  profiles from one, to back them up or share them between boats.

- Course planning on the chart. Long-press (touch) or right-click (desktop) a point and choose "Go to
  here" to navigate straight to it via the Course API, with the destination shown on the nav strip.
- Route interchange via GPX. Export any saved route to a GPX file other plotters, MFDs, and
  Freeboard-SK read, and import routes from a GPX file back into Binnacle, closing the round trip.
- Passage planning in the route editor. A persisted plan speed turns the leg table into a passage
  plan, showing the cumulative time to reach each waypoint and a whole-route Time alongside the
  distance, plus a per-leg distance and bearing table that updates live as waypoints are dragged.
- Track-to-route workflows. Save the current track as a reusable route, reverse a saved route for the
  return leg, navigate home by retracing the current track, and skip the active route's waypoint
  forward or back from the nav strip. The nav strip also shows the whole-route distance and arrival
  time when a multi-leg route is active.
- A minimize control on the Routes panel. On a phone the panel is a bottom sheet that covers the chart,
  so a chevron in the header collapses it to just the header bar while it stays open, freeing the chart
  to tap waypoints into a route. The control only appears at phone widths.

### Changed

- The Layers panel now leads with "My routes and tracks" above "Traffic and live data". The panel
  order is kept aligned with the map stack so drag-to-reorder lands coherently, so this also raises
  the routes and track layers above AIS and the reference overlays on the chart; the own vessel and
  the collision rings stay pinned on top.
- The Tracks panel now renders saved tracks as the same elevated cards as the Routes panel, each
  showing the track's distance and duration, and the current-track stats line was tightened to a
  label, value, and unit grid that removes the trailing whitespace and aligns the values in a column.
- At night-red, the base map's pre-colored sprite icons (road and transit shields, aerodrome marks)
  are now hidden along with the POI dots, so the chart stays pure red on black with no stray blue,
  green, or white icons. The text labels stay visible.
- The route line, the note selection ring, and the AIS target triangles gained a dark casing or halo,
  so they keep their bright color but no longer sit low-contrast against the light day water. The
  casing is invisible on the dark dusk and night-red maps, where the bright shape reads on its own.

### Fixed

- Importing a GPX route no longer aborts on a malformed numeric character entity: a code point outside
  the Unicode range now stays literal instead of throwing an uncaught error that ended the whole import.
- The Routes opacity slider now dims the waypoint labels along with the route line and markers, the way
  the tides and notes overlays already did.
- The active-route strip's previous and next waypoint buttons are now a full 44px touch target, so they
  are usable underway.
- The precipitation legend now reads up to 40 mm/h, matching the range the precipitation field paints.

### Internal

- A simplification pass over the overlay work: each new overlay slice (seamarks, protected areas,
  boundaries, ocean conditions) now exposes a band-owning factory, so the chart widget no longer
  hardcodes which map band each draws into (matching the depth-charts sibling). Deduplicated the
  chart zoom-range expression and the tides upcoming-events computation, moved the station-distance
  formatter into the tides display module, and tidied a handful of comments.
- A simplification pass over the plotter and UI changes: the saved-item card list moved to one global
  `.saved` system in `app.css` consumed by both panels, a shared `downloadBlob` helper backs the
  track and route exporters, the GPX escape and unescape pair moved to one `xml-entities` module, the
  distance-over-speed time uses the shared `etaSeconds` everywhere, the meters-per-degree constant is
  shared from `$shared/nav`, the nav-strip `RouteProgress` type has one definition, the plan-speed
  field uses the shared `.input`, and the whole-route distance derives from the leg table so the total
  and the per-leg numbers cannot drift.
- A simplification pass over the contrast work: the route, selection-ring, and AIS dark contrast aids share
  one `DARK_SCRIM` constant and an `rgbaCss` helper in `$shared/map` instead of three drifting literals,
  and the SlideOver minimize takes one `{ collapsed, onToggle }` object so the state and its toggle are
  always supplied together.
- A simplification pass over the profiles feature: the active-card accent edge-bar and "Active" badge moved
  to the one global `.saved` system in `app.css` consumed by the Routes, Tracks, and Profiles panels, a
  shared `pickTextFile` helper in `$shared/ui` backs both the route GPX import and the profile JSON
  import instead of two hidden-input handlers, the profile importer validates the theme against the
  shared `THEMES` list, and the default profile now auto-applies on a fresh device that has a default
  but no active profile. The server sync also stops pushing after one rejected write, so a read-only
  token attaches for reads but does not fire a doomed write on every later edit.
- A project-wide modularization pass. The labeled current-item stats grid that the
  Routes editor and the Tracks panel duplicated verbatim is now one global `.stat-grid` system in
  `app.css`. A shared `downloadText(filename, text, type)` helper backs the route GPX, track GeoJSON,
  and profile JSON exporters, so the Blob construction lives in one place. The four weather colormaps
  (wind, waves, precipitation, and cloud) build on a new `themedRamp(day, night)` factory in
  `color-ramp.ts`, so the night-red ramp swap is defined once instead of repeated per colormap. Two
  dependency-cruiser rules, `no-cross-slice-shared` and `no-cross-slice-entities`, now enforce that a
  shared or entities slice reaches a sibling only through its index public API, matching the existing
  `no-cross-feature` rule.
- The deferred modularization items. A shared `fetchJsonOrUndefined` helper backs the free-API weather
  clients and the course REST hydration; a shared `MemoryCache` backs the weather grid cache and the
  tides per-station caches; the `SlideOver` shell gained a subtitle and a footer so the last hand-rolled
  panel (the note detail) folds into it; a shared `SavedList` and `VisibilityToggle` back the Routes,
  Tracks, and Profiles cards; the coordinate guards moved to a `shared/geo` slice so geometry no longer
  imports the SignalK transport slice for a type; and the portable profile settings are a single
  declarative registry typed so a forgotten setting fails the build.
- A whole-repo cleanup. Correctness fixes (the GPX entity guard, the route label opacity, a
  marine-merge step-count guard, a deferred object-URL revoke, and a wind-arrow bounds guard), a round
  of dead index re-export trimming, the four repeated course hydrate-and-seed sites folded into one
  helper, and assorted comment and legend fixes.

<a id="v021"></a>

## [0.2.1] - 2026-06-09

### Fixed

- Points of interest (Crow's Nest and ActiveCaptain) no longer flicker. A slow or rate-limited
  provider response made the markers vanish and reappear, because a failed fetch was treated as
  "no POIs" and cleared them. A failed fetch now keeps the markers on screen, and the overlay
  caches fetched sets by area, so panning back, panning a little, or zooming in reuses a recent
  fetch instead of re-hitting the network.
- Active marine warnings (gale, storm, and small-craft advisories) no longer flicker off the
  conditions panel when a weather-provider request transiently fails: the last warnings are kept
  until a real update replaces them.
- An active route's guidance (the nav strip, arrival circle, and auto-advance) no longer freezes on
  stale values after a stream reconnect. The v2 course data is re-hydrated on reconnect, since
  resubscribing cannot redeliver it under subscribe=none, and the route list is refreshed too.
- Server charts no longer blank on a transient failure at map load: the fetch now distinguishes a
  failed request from a reachable server with no charts, matching routes and points of interest.
- Imported-chart storage is reclaimed at startup: a PMTiles blob left behind by a failed save or a
  delete that ran while storage was degraded is now swept once its descriptor is gone, so orphaned
  blobs cannot accumulate on disk.
- The Points-of-interest layer no longer fetches from the provider or re-clusters while it is toggled
  off: a hidden layer now does no network or rendering work until it is shown again.
- Silenced a stream of "styleimagemissing" console warnings: the base map style references a few
  sprite icons and landuse patterns its published sprite does not contain, so a transparent
  placeholder is supplied for each. The map is unaffected; the console stays clean.

### Internal

- Bounded two more caches to a fixed size: the note-detail memo, and the persistent weather-grid
  store (now matching its in-memory tier).
- A whole-codebase cleanup pass: deduplicated the local-date computation shared by
  the tides fetch window and its session-cache key, sourced the vessel and AIS default colors from
  the day theme token, dropped over-broad slice exports, reset the stream reconnect backoff on an
  explicit disconnect, and tidied several comments, an accessibility region, and a redundant live
  region. No user-facing behavior change beyond the fixes above.

<a id="v020"></a>

## [0.2.0] - 2026-06-08

### Added

- A Tides panel (US waters), opened from the app menu, showing the nearest NOAA tide station's next
  high and low with heights in meters and feet, a 48-hour tide curve with a "now" marker, and the
  nearest tidal-current station's next flood or ebb with its rate and set. The nearest tide and
  current stations are also markable on the chart from the Layers panel. It degrades to a clear
  message outside US coverage, and the data is cached for the session.
- New built-in chart overlays, all free, key-free, and verified against the live services. Each
  starts hidden, toggles from the Layers panel, and carries its source attribution:
  - OpenSeaMap seamarks: a global overlay of navigation aids (buoys, beacons, lights, and harbors).
  - Marine protected areas: EMODnet protected areas with Natura 2000 nested under them (EU), and the
    NOAA MPA Inventory (US).
  - Maritime boundaries: the inter-country jurisdiction lines and the territorial sea (12 nm), so you
    can see when a passage crosses into another country's waters.
  - Ocean conditions: NASA GIBS sea-surface temperature and sea ice concentration (global, daily),
    which appear in a new Ocean conditions section of the Layers panel and default to translucent.
- A review step when importing a chart: after the file or URL is read, you can rename it and check
  its type, zoom range, and size before saving, instead of it saving immediately.
- URL-based imported charts now register on the Signal K server as a chart resource, so other
  devices on the same server discover them, and deleting the chart removes the server resource too.
  The chart stays manageable locally (a synced chart is shown once, not twice). File-based imports
  stay on the importing device, since a stock server cannot host the file bytes.

### Changed

- The Layers panel is reorganized into collapsible categories (Traffic and live data, Navigation
  aids, Areas and boundaries, My routes and tracks, Ocean conditions, and Charts and depth), each
  with a row count, so a long flat list reads as a few sections. The two most-used categories open by
  default and the rest collapse to cut clutter; each category remembers whether you left it open or
  closed. Per-layer toggles, opacity, the facet-group cards, and drag-to-reorder are unchanged.
- A better default chart order: the US NOAA ENC nautical chart leads, then US BlueTopo bathymetry,
  then EMODnet (Europe), then GEBCO (global), so the most detailed free coverage is on top. You can
  still drag any layer to reorder it.
- Cleaner, consistent layer names: sentence case throughout, plural for collection layers (Track is
  now Tracks), and a unified "source, type, region" format for the single-layer bathymetry overlays
  (for example "GEBCO bathymetry (global)"). The weather "Cloud cover" layer is now "Cloud" to match
  the other single-word weather layers.
- A denser, more consistent app menu and Layers panel: list rows use a compact row size while action
  buttons keep the larger touch target, the opacity sliders sit in shorter rows, and the gaps are
  snapped to one spacing scale, so more layers and menu items fit without scrolling.
- Three depth sources now present as labeled groups in the Layers panel, each with a base facet and a
  nested survey-quality facet: "NOAA ENC (US)" (Base chart, Data quality (ZOC)), "EMODnet (Europe)"
  (Bathymetry, Quality index), and "BlueTopo (US)" (Bathymetry, Uncertainty). The quality facets show
  how reliable each cell is: ZOC zones for the ENC, EMODnet's combined quality index, and BlueTopo's
  per-cell vertical uncertainty. Within a group the facet toggles are aligned in one column, a single
  drag handle and opacity slider serve the whole group, and the quality facet only enables while the
  base facet is on (turning the base off hides it). A generic sub-layer grouping mechanism backs this,
  so any future multi-facet chart can group its facets the same way.

### Fixed

- Deleting a user-imported chart now actually removes it. The layer row, the map overlay, and the
  stored descriptor were all left in place because the delete handler read the chart id after the
  panel had already cleared its selection, so the removal threw and never ran.
- A chart imported while a dark theme (dusk or night-red) is active now takes the theme immediately,
  instead of staying in day colors until the next theme change. Overlays registered after the first
  recolor are now themed at registration.
- The nearest tide and tidal-current readings no longer briefly go stale around local midnight: the
  session cache now rolls over on the same local day the NOAA forecast window uses, rather than on
  the UTC day.

### Internal

- A whole-codebase cleanup pass: named the shared millisecond constants once (MINUTE_MS, HOUR_MS,
  DAY_MS), added a placeholder-aware nautical-miles readout, deduplicated the base-theme style
  lookups, removed a dead weather-provider field and an empty re-export shim, tightened the
  storage and chart-adapter export surface, and aligned the route and wave overlay label font and
  arrow color with the other overlays. No user-facing behavior change beyond the fixes above.

<a id="v013"></a>

## [0.1.3] - 2026-06-08

### Added

- A fully keyboard-navigable app menu: arrow keys move between items, Home and End jump to the ends,
  and it follows the WAI-ARIA menu pattern with grouped sections (Navigation and Alarms), roving
  focus, and announced toggle states.
- Reduced-motion support: when the system prefers reduced motion, the chart's center-on-boat,
  fly-to, and fit-to-bounds camera moves jump instantly instead of animating.
- An opt-in NOAA ENC data-quality overlay. The NOAA ENC chart is now one clean chart layer plus a
  separate, default-hidden "data quality" layer carrying the Zones of Confidence (CATZOC) ratings,
  so the chart no longer always paints the data-quality triangles and overscale patterns on top.
- One-tap alarm muting from the danger strip, a muted-alarm badge in the top bar, and a spoken
  collision summary written to a live region for assistive technology.
- Motion and depth across the interface: the slide-over panels, the app menu, and the weather panel
  now reveal with a short reduced-motion-aware transition, the theme toggle animates its icon on each
  cycle, and the panels and menu carry a layered shadow. A more confident day palette and a larger
  instrument-readout type tier make the hero numbers (SOG, the nav metrics, the conditions) dominate
  their labels.

### Changed

- Bearings are now labeled true (123 degrees T) on the COG, BTW, and wind readouts, time-to-go shows
  hours and minutes past an hour (2h 05m) instead of a bare minute count, and the collision strip and
  its spoken summary are graded danger versus caution by the worst contact rather than always
  sounding full danger.
- The design system was consolidated: one shared lit-toggle, input, slider,
  and button-row vocabulary replaces the per-component copies, the danger and nav strips now stack
  instead of overlapping so course guidance survives a close-quarters contact, and the danger strip
  stays above the weather panel so Mute and Acknowledge are always reachable.

- The app menu is redesigned. Tracks, Routes, and Layers are now edge-docked slide-over panels
  promoted from inline accordions, each with a back-to-menu button so you can move between panels
  without reopening the menu, and the menu groups its items under section headers.
- Center, Follow, and Forecast now sit together in the bottom status strip as three matching labeled
  pill buttons, in that order. Follow and Forecast show a clear lit on-state, kept dim enough for
  night-red.
- A whole-codebase cleanup pass with no change to behavior beyond the fixes below: the Signal K
  frame pipeline hands the per-frame value map straight to the store instead of rebuilding it each
  frame, the active-route readouts compute each leg's geometry once per change rather than several
  times per render, the Layers drag measures row positions once at drag start instead of on every
  pointer move, and duplicated formatting, geometry, WMS, and map-image helpers were consolidated.

### Fixed

- The bottom status strip no longer overlaps or wraps unevenly on a phone. It stacks into a clean
  layout: the live readouts above, and the Center, Follow, and Forecast controls on one row below.
- The Tracks panel's statistics now align in a single value column.
- The collision danger strip no longer double-announces to screen readers. The app keeps a single
  concise spoken summary of the danger, and the on-screen contact list is now a silent visual
  landmark, so assistive technology reads the danger once instead of twice.
- The animated wind field now honors the system reduced-motion preference, falling back to the static
  wind arrows instead of running a continuous particle animation.
- The active-route strip no longer re-reads its whole readout line to a screen reader every second;
  only the destination name announces, when a waypoint advances.
- On a phone the note detail and a leading panel no longer overlap as stacked bottom sheets (they are
  mutually exclusive at narrow widths), the brand drops its version string so the top-bar controls
  keep room, and the weather "Here" conditions open as a full-width sheet rather than covering the
  small map.
- Form inputs theme their placeholder text, the day caution color is darker for contrast and is
  clearly distinct from the alarm red, and the Forecast control exposes its dialog to assistive tech.

<a id="v012"></a>

## [0.1.2] - 2026-06-05

### Fixed

- Importing a chart now flies the map to the chart's bounds, so a PMTiles archive (by file or URL)
  is immediately visible instead of staying off-screen when it covers a different area than the
  current view. Previously the chart was added to the Layers panel but the map did not move, so it
  looked like nothing happened. (A new fitBounds map command, fired only on a user import, never on
  the charts restored at startup.)

### Changed

- The layer-toggle checkbox no longer shrinks when a layer name is long: it stays square (the name
  ellipsizes instead).

<a id="v011"></a>

## [0.1.1] - 2026-06-05

### Changed

- App Store polish, reviewed against the Signal K AppStore publishing doc. The appIcon is now
  256x256 (the previous 72x72 was below the documented 128x128 minimum). The README is scannable,
  since the server's Webapps view renders it: the screenshots gallery that showed as raw HTML there
  is removed (the screenshots stay in `signalk.screenshots` for the App Store detail page), and the
  duplicate feature inventory is collapsed into one concise list. The title is now "WebGL chart
  plotter for Signal K" across the README, the PWA manifest, and the repository description.

<a id="v010"></a>

## [0.1.0] - 2026-06-05

### Added

- Routes: plan a passage and follow it. Open Routes from the menu, draw a route on the chart (tap to
  add waypoints, drag a point to move it, tap a midpoint to insert one), and watch the leg count and
  total distance update live as you draw. Save it to the Signal K server (`/resources/routes` as a
  GeoJSON LineString), and it syncs to every device and lists with show or hide, edit, activate, and
  delete. Activating a route hands it to the Signal K v2 Course API, and a nav strip shows the active
  waypoint, cross-track error with a steer-left or steer-right side, distance and bearing to the
  waypoint, velocity made good, and time to go, with an arrival alarm at the arrival circle. The
  guidance prefers the server's course calculations and computes them on the client when the
  course-provider plugin is absent (a "computing locally" badge says when), the same graceful
  degrade as the collision CPA. A failed save keeps the route under edit so nothing is lost, and the
  on-chart editing line is themed for day, dusk, and night-red. Route editing uses Terra Draw.

- The weather forecast is cached in IndexedDB, so it survives a reload and a return to a recent view
  reuses it instead of re-fetching. Unlike the service-worker cache, which browsers expose only in a
  secure context, IndexedDB works over plain HTTP, so this is the offline-leaning weather cache for
  the many users without SSL. Each grid is stored with a one-hour expiry, expiries are kept apart from
  the grids so pruning never loads them, and the store degrades to memory and never throws when
  IndexedDB is unavailable. Verified over https: after a reload, opening the forecast served the grid
  from IndexedDB with zero Open-Meteo requests.

- Weather. A dedicated weather mini-map, opened by the Forecast button centered in the status strip,
  keeps the navigation chart clean and the weather within its data resolution. The mini-map is capped
  at zoom 7 (RainViewer's real radar resolution) and panned independently of the chart, so weather can
  never be zoomed past what the data supports: no "zoom not supported" tiles, no pretending a coarse
  grid has street-level detail. In the panel you toggle Wind, Pressure, Waves, Precipitation, Cloud
  cover, or Rain radar, scrub the coming days with a time slider, read a per-layer color-ramp legend,
  and tap anywhere for the wind, pressure, sea state, and rain at that point and time. Wind draws as
  speed-colored arrows, mean-sea-level pressure as labeled isobar contours (marching squares, 4 hPa),
  significant wave height, precipitation, and cloud cover as smooth color fields, and precipitation
  radar as an animated RainViewer loop. The four area fills (waves, precipitation, cloud, and radar)
  are mutually exclusive, one at a time, so they never stack into mud; wind arrows and pressure
  isobars stay freely combinable on top. A "Here" panel shows the current conditions, a short
  forecast, and any gale or storm warnings for the vessel's own position.
- Weather data prefers a configured Signal K weather provider (for example AccuWeather) for point
  data: the tap readout and the "Here" conditions and warnings come from the provider when one is
  set, and fall back automatically to the free, browser-only sources when none is configured. Area
  data is always free, because no provider exposes gridded fields through Signal K: the atmospheric
  grid and the marine wave field come from Open-Meteo, and radar from RainViewer, with no key and no
  server plugin. Results are cached by viewport in memory so panning reuses a recent fetch, and the
  Open-Meteo responses, the RainViewer frame index, and the radar tiles are cached by the service
  worker for offline use. Layers beyond wind and waves are off on first open, themed for day, dusk,
  and night-red (a deep, low-brightness red on black at night, no blue; the radar raster is
  desaturated and dimmed).
- Wind draws as an animated WebGL particle field, the glanceable signature layer: thousands of
  particles stream through the forecast wind with fading trails, colored by speed (the day ramp, and
  a pure red-on-black ramp at night). It is a custom MapLibre layer running a GPU particle simulation
  over the forecast u/v, projected so pan and zoom only reproject the particles and the trails reset
  cleanly on a move. It falls back to the speed-colored arrow layer when WebGL is unavailable, and
  the animation runs only while the Wind layer is on.

- Approving Binnacle's Signal K access is now self-explanatory and recognizable. The request uses a
  named client id (`binnacle-<short>`) instead of a bare UUID, so it is easy to spot in the Signal K
  access-requests list, and the "Requesting access" banner shows that id plus a one-click "Approve in
  Signal K" shortcut that opens the admin access-requests page. A legacy bare-UUID client id is
  upgraded to the named form on load, keeping any existing token.

- Follow boat: a "Follow boat" item in the menu locks the chart to the vessel, recentering on each
  new position fix at your current zoom. It centers immediately when turned on, and a manual pan of
  the chart releases the lock (a scroll-zoom keeps it). It is off by default and does not persist
  across reloads. The one-shot "Center on boat" remains for a quick recenter that also zooms in when
  you are zoomed far out.

- A Layers panel and drag-to-reorder for every layer. The old inline "Layers" submenu is now a
  "Layers and charts" launcher that opens a left-docked slide-over listing every layer top of the map
  first, grouped into "Charts and Depth" and "Overlays" with the own vessel and active alarms pinned on
  top. Each row toggles, sets opacity, and drags (by pointer or keyboard) to restack the z-order, and
  the order persists across visits. The panel docks opposite the note detail so both can be open at
  once, and it themes for day, dusk, and night-red.

- Streaming depth charts. Four free hosted bathymetry and chart sources toggle on from the Charts
  and Depth section, off by default and cached as you pan: GEBCO global bathymetry, EMODnet (Europe), the
  NOAA ENC chart (US), and NOAA BlueTopo (US). They are reference overlays, not certified for
  navigation. A raster source cannot be recolored, so at night it is desaturated and dimmed (no blue,
  low brightness) rather than left full-color.

- Import your own charts. Add a PMTiles archive by URL or by dropping a file into a themed drop zone;
  Binnacle reads its name, bounds, zoom, and whether it is vector or raster, lists it under Charts
  and Depth as a normal reorderable layer, and stores an uploaded file in the browser for offline use. A
  per-chart detail view renames it, shows its metadata, and deletes it (stating the storage freed).
  Both vector and raster PMTiles render; full S-52 styling of converted ENC depth features is a later
  spec.

- Note detail panel: tapping a point of interest now opens a slide-in side panel with native,
  structured detail instead of a plain-text popup that bounced you to an external viewer. Binnacle
  consumes Crow's Nest's presentation-neutral `properties.crowsNest` sections from
  `/resources/notes/{id}`, rendering each item by kind (measures with units, availability badges,
  rating stars, flag toggles, links, and notes), and falls back cleanly to the plain-text
  description for any other notes provider or schema version. The marker icon now uses the
  explicit POI type when present, the structured values render as text with scheme-checked links
  (no HTML injection), and the panel is themed for day, dusk, and night-red and becomes a bottom
  sheet on a narrow screen.

- Tracks: Binnacle now records and shows where you have been. The active track is drawn behind the
  boat as you move, colored by speed (dark for slow, bright for fast) or a single solid color, and a
  break in the line marks a GPS dropout or a gap between sessions. The whole voyage is kept in the
  browser (IndexedDB) and reappears after a refresh. A "Tracks" submenu in the menu pauses and
  resumes recording, shows live voyage stats (distance, duration, and average and maximum speed),
  saves the current track to the Signal K server (`/resources/tracks` as GeoJSON), clears it, and
  toggles the color mode. Saved tracks list with show or hide on the chart, delete, and a GeoJSON
  export you can download. Track speeds are stored in SI (m/s) and converted to knots only at the
  display edge; the track layer is a normal layer, so it toggles and fades from the Layers submenu.

- Lookout collision thresholds are now editable (differentiator step 6). A "Collision thresholds"
  submenu in the menu sets the danger and warning CPA (nautical miles) and TCPA (minutes); changes
  apply live to the assessment and persist across visits, with a reset to defaults. Values are stored
  in SI and edited at the display edge in nm and minutes.

- Lookout publishes its collision alert to Signal K (differentiator step 5). When the assessment
  crosses a threshold, Binnacle writes `notifications.navigation.collision` over the streaming API
  (state alarm for danger, warn for warning, with the appropriate method) so other Signal K clients
  and devices share the alarm; it clears to normal when the risk passes. It is published only when
  the state or worst contact changes, not on every per-second tick.

- Lookout now sounds an audible collision alarm (differentiator step 4). When an AIS contact
  crosses the danger CPA/TCPA threshold, a repeating two-beep tone plays, synthesized with the Web
  Audio API so nothing is downloaded. Acknowledging the contact on the danger strip silences it, and
  a new or more severe contact re-arms it; a "Mute alarm" toggle in the menu turns sound off entirely
  and persists. The audio primes on your first interaction with the page (browsers block sound until
  a gesture). Warnings stay visual only.

- An app menu in the top bar gives app-wide options a home. It stays a single button until
  opened, then drops a themed popout, and closes on selection, Escape, or a click outside; the
  trigger is a labeled disclosure (aria-haspopup, aria-expanded, aria-controls). The menu is generic:
  it renders whatever action items it is given plus optional collapsible submenus, so adding an
  option is one `MenuItem` (or one `MenuSubmenu`) in the app shell, never a change to the menu
  itself. It hosts a "Center on boat" action that flies the map to the vessel and a "Layers"
  submenu.

- Binnacle now remembers your session across a page refresh. The map reopens at the last center and
  zoom, and each layer's visibility and opacity are restored, alongside the theme that was already
  persisted. The view is saved to local storage after panning settles (one write per gesture, not
  per frame), layer changes are saved as they happen, and a corrupt or out-of-range saved view is
  ignored in favor of the default world view.

- Points-of-interest markers now use per-category icons and a rich detail popup. Each note is sorted
  into a category (anchorage, marina, fuel, services, inlet, boat ramp, bridge, hazard, navaid,
  structure, or a generic point of interest), matched from the provider's skIcon against the live
  Crow's Nest / ActiveCaptain vocabulary with a keyword fallback for unfamiliar variants, so
  navigation lights and channel buoys read as navaids, creek inlets as inlets, and boat ramps and
  bridges as themselves instead of plain pins. Each category draws as a themed disc with a glyph:
  Lucide glyphs (anchor, sailboat, fuel pump, wrench, waves, landmark, triangle-alert, map-pin) per
  the spec's chosen app icon family, plus custom slipway and bridge marks. Hazards take the alarm hue,
  navaids the caution hue, the rest the POI hue; all recolor with the theme (night-red stays in the
  red band).
  Clicking a marker opens a themed popup with the name, category, any description and source
  attribution, and an http(s)-only link to the provider's detail page, and the selected marker gets a
  highlight ring.

- Navaids now render type-specific symbols instead of one generic marker. The note name is parsed
  into a kind (lighthouse, light, buoy, daybeacon, or generic) and, for buoys and daybeacons, a
  lateral side from the aid's number using the US IALA-B convention (even = red, starboard hand;
  odd = green, port hand). Lights draw as a magenta flare, lighthouses as a lantern-topped tower,
  starboard marks as a red cone or triangle, port marks as a green cylinder or square, so a channel
  reads at a glance. The side is carried by shape as well as color, so it survives night-red (where
  red and green collapse to two red shades). This infers symbols from the note text; full S-52
  symbology keyed off S-57 ENC attributes (shape, color, category) remains the later vector-chart
  spec, since notes carry no such attributes.

- Points-of-interest markers cluster at lower zoom and split apart as you zoom in, so a busy harbor
  shows a single counted disc instead of a stack of overlapping markers; clicking a cluster zooms to
  expand it. Marker size scales gently with zoom.

- Points-of-interest overlay: Binnacle now renders Signal K `notes` resources on the map, so POI
  providers like signalk-crows-nest (Active Captain, OpenSeaMap, NOAA, USCG light list) show up.
  The overlay fetches notes scoped to the current viewport (`?bbox=...`, no `provider` so every
  notes provider merges, which is how Freeboard-SK retrieves them), refetched as the map moves and
  gated below zoom 9. POIs draw as themed dots with names at zoom 12 and up, and toggle from the
  layers panel. Earlier nothing showed because Binnacle had no consumer for `notes` resources; the
  data was being served correctly all along.

- Lookout collision chart highlight (differentiator step 3): dangerous AIS contacts now get a graded
  ring on the chart in the safety z-band, danger and warning colored from the theme (day, dusk, and
  night-red, which keeps both in the red band with danger brighter). The overlay is dirty-checked
  against the assessment so it only rebuilds when a contact's id, severity, or position changes, is
  theme-aware through the layer manager's applyTheme broadcast, and toggles from the layers panel.

- Lookout danger strip: collision danger now surfaces on screen. A strip floats at the bottom of
  the chart listing the most dangerous AIS contacts with their closest point of approach in nautical
  miles and time to closest approach in minutes, color-graded by severity, with an acknowledge
  control and a "computing locally" note when the values are the client-side fallback rather than a
  Signal K provider. The strip is absent when nothing is dangerous, so a calm night watch stays dark,
  and it updates as traffic moves. This is the first on-screen slice of the active-safety Lookout
  feature; the chart highlight, audible alarm, notifications, and thresholds panel follow.
- Offline and PWA caching: Binnacle is now an installable progressive web app. A service worker
  precaches the app shell, runtime-caches the OpenFreeMap base map and the Signal K PMTiles charts
  cache-first (range-request aware) as they are viewed, and never caches the live Signal K stream or
  REST API, so anywhere the navigator has looked renders offline while live data stays fresh. The
  top bar offers an update when a new build is published, and the status strip shows an offline
  indicator. Service workers require a secure context, so this activates when the Signal K server is
  served over HTTPS; over plain HTTP the app degrades cleanly to online-only with no errors.
- The status strip shows the map's center latitude and longitude and the zoom level, updating as
  the chart is panned and zoomed, formatted at the display edge with hemisphere suffixes.
- Lookout (active-safety, first slice): the headless collision data layer behind the upcoming
  danger strip. A pure, test-first closest-point-of-approach module computes CPA and TCPA from the
  own vessel and a target's position and velocity, a persisted-settings helper holds
  user-configurable danger and warning thresholds with sensible defaults, and a collision
  assessment ranks AIS contacts by severity, preferring the server's `navigation.closestApproach`
  when a provider supplies it and falling back to the computed values otherwise. The danger strip,
  chart highlight, audible alarm, and Signal K notification publishing follow in later slices.
- Theming: a design-token system with day, dusk, and night-red palettes, switched by a single
  theme controller that sets `data-theme` on the document and persists the choice. Every surface
  recolors from CSS custom properties, a top-bar toggle cycles the themes, and the map base
  recolors via `setPaintProperty` (keeping tiles and overlays). Night-red is pure red on true
  black with no blue, and a dedicated alarm token stays distinguishable in every palette.
- Identity: self-hosted Inter (UI) and JetBrains Mono (tabular numeric readouts) typography
  bundled for offline use, Lucide icons for the theme toggle and the layers panel, the own-ship
  and AIS symbols recolored per theme so the chart shows no blue on the night-red theme (the own
  ship turns red and AIS a night-safe amber), and the build version shown in the top bar.
- AIS targets: the worker learns the self vessel from the `hello` handshake and routes other
  vessels' deltas into a per-context AIS stream, the store accumulates each target and prunes
  ones that go silent past a six-minute window, an `AisTargets` entity interprets each target
  into display units, and an AIS overlay renders them as GPU symbols in the traffic band that
  rotate with course and skip rebuilding when nothing changed. The app subscribes `vessels.*` at
  a controlled rate, and CPA and TCPA are read from `navigation.closestApproach` when a provider
  supplies them.
- Charts: a generic chart-source adapter turns any Signal K chart resource into MapLibre source
  and layer specs, branching on the chart type (raster tilelayer, WMS, WMTS, and S-57, plus
  vector tileJSON with PMTiles resolved to the `pmtiles://` protocol) and honoring bounds and
  zoom limits. Each chart wraps as a basemap-band overlay on the existing layer manager, the
  charts client discovers them from `/resources/charts` (v2, falling back to v1, degrading to an
  empty list offline), and a layers panel gives each chart a visibility toggle and an opacity
  slider.
- Verify-before-push git hooks (`.githooks/`, installed via `npm run hooks`): a fast format,
  lint, and boundary check before each commit, and the full type-check, test, and build gate
  before each push, so a broken tree cannot be committed or pushed.

### Changed

- A final whole-codebase cleanup before the 0.1.0 release, no feature change. The
  panel, button, icon, label, and instrument-strip styling moved into shared `app.css` utilities
  (`.icon-btn` with accent and danger modifiers, `.btn-ghost`, `.btn-pill`, a shared bottom-strip
  metrics row, a `.caps-label` for the uppercase section labels, and a 4px-based `--space-*` spacing
  scale for the common padding, gap, and margin values): the Routes panel now renders the same
  slide-over shell as the Layers and note panels instead of having the app shell hand-roll its dock
  chrome, every panel header reads the shared `.panel-title`, and the row-action icon buttons and
  ghost buttons stop being re-declared per component. The Signal K
  resource clients (routes, charts, tracks, and course) now share one `fetchKeyedResource` plus
  `putResource` and `deleteResource` instead of three copies of the v2-then-v1 fetch and five copies
  of the PUT and DELETE wrapper; the three IndexedDB stores share one `openIdbDatabase` opener and one
  `degradeToMemory` policy; the weather grid blends through the shared `lerp`; user-chart ids and the
  save-name prompt use shared helpers; the store iterates own keys with `Object.entries`; the
  longitude-delta normalize is total over any input; and the unused `routeLegs` was removed.

- The Signal K webapp manifest is complete for the App Store and the 0.1.0 release: five screenshots
  (the chart with AIS, route planning, charts and depth, an anchorage point-of-interest detail, and
  the weather mini-map) and a "Works well with" list (Crow's Nest for the points of interest Binnacle
  renders, signalk-ssl for the HTTPS its offline cache needs, and signalk-virtual-weather-sensors as a
  weather provider it reads). A cross-platform webapp CI builds, tests, and packs on Linux, macOS, and
  Windows on Node 22 and 24, and a release publishes to npm with a provenance attestation.

- A UI consistency pass covering design tokens, layout, typography,
  accessibility, and marine HMI conventions brought the whole interface to one standard. New tokens defined for all three themes (a large
  radius, a shared hover and press timing, a caution-tier warning color, and an alarm tint) replace
  the values components used to hand-code. Panel titles are consistent headings, the numeric readouts
  share the mono instrument font, the bottom-strip titles match the panel title scale, and the
  night-red border is deepened so panels stay separated where the shadow is dropped. The on-chart
  route editing color now reads the one map-theme source instead of a duplicated table. The four
  slide-over and overlay panels share one dismiss behavior (Escape closes the topmost, and focus
  returns to the control that opened it).

- Routing cleanup pass covering geodesy and the route domain, course guidance and the resource
  clients, the overlay, editor, and chart wiring, and the routing UI and app wiring, no feature
  change. The Earth-radius constant and the antimeridian longitude-delta normalize are now
  shared by the rhumb-line geometry and the collision CPA projection instead of duplicated, a
  `steerSide` helper centralizes the port-versus-starboard cross-track convention, a `clientId` helper
  folds the two copies of the secure-context id fallback, and the route distance no longer allocates a
  leg array just to sum it. Stopping an active course now clears every course cell, where before it
  left the previous point, the active route, and the arrival circle stale, and the seeding and
  clearing of those cells moved onto the course entity that owns them. Dead route-editor methods and a
  redundant overlay visibility flag were removed. Tests went from 412 to 415.

- The weather mini-map opens centered on the navigation chart's current view, so the forecast is for
  the area you are looking at, rather than reopening at its own last position. The zoom is still capped
  to the mini-map's maximum so weather never zooms past its data resolution.

- Second whole-repo cleanup pass covering weather, the Signal K data layer, map and charts, notes
  and tracks, safety and chrome, and app and build infrastructure, no feature change.
  The wind particle field caches its GPU uniform and attribute locations once at setup instead of
  re-querying them every frame, the layer manager applies the stacking order once per batch when the
  chart and overlays first load rather than restacking after each of a dozen-plus registrations, and
  shared helpers fold repeated logic: a `DEG_TO_RAD` constant for hot numeric loops, an `HOUR_MS`
  constant, an `applyRasterTheme` for the night-red raster treatment shared by the chart, depth, and
  radar layers, an `asKeyedObject` guard shared by the chart, note, track, and weather resource
  clients, a `toLonLat` mapper for the track coordinate builders, and one `RAIN_VISIBLE_MM_H`
  threshold. Dead Signal K path constants were removed.

- A new app build now surfaces an Update control instead of silently reloading. The progressive web
  app uses prompt registration rather than auto-update, so a fresh build never reloads the chart out
  from under you mid-passage; the Update control lets the navigator choose when to apply it.

- Whole-repo cleanup pass, weather-weighted, no behavior change. One shared
  `emptyFeatureCollection` in `$shared/map` replaces the per-overlay copies (vessel, track, ais,
  notes, and weather), a shared `headingDegrees` helper folds the vessel and AIS heading fallback,
  the weather mini-map's viewport cache is now bounded, the wind overlay reports both its candidate
  layer ids so a rare WebGL fallback still restacks, the notes cluster click no longer double-fires,
  the radar opacity is one constant, and dead surface was removed (the unused `cellIndex` export, the
  unused weather `type` field and `weatherCacheKey` export, and a pass-through wrapper).

- Points of interest cluster later and say what they hold. Markers now uncluster from zoom 12 (up
  from 14), so the zoom you usually navigate at shows individual POIs instead of group circles, while
  the wider view (zoom 9 to 11) still clusters so it does not turn into a mash of overlapping pins. A
  cluster no longer reads as a generic purple circle: it shows the colored icon of its most important
  member (a red hazard disc if it holds any hazard, the amber navaid disc otherwise the point-of-
  interest disc), inside a ring that marks it as a group, with a count badge. Clicking a cluster still
  zooms it apart.

- Tidied the Signal K auth flow internals, with no behavior change. The focus and cross-tab
  storage listeners now live inside `AuthController` (like `OnlineStatus` owns its own listeners)
  instead of the app shell parsing the stored auth JSON itself, a single in-flight guard stops a
  duplicate access-request poll when a tab return fires focus and visibilitychange together, and
  the own-vessel and AIS subscriptions are issued in one call.

- Cleanup pass over the depth-charts work. The two IndexedDB stores now
  share one open-and-transaction helper; the unused PMTiles store list and total-size methods were
  dropped; byte-size formatting moved to a shared `formatBytes`; and a few small dead guards, a
  redundant array copy, and duplicated layer-id lists were tidied.

- Whole-repo cleanup pass. The collision assessment is memoized with
  `$derived`, so the O(targets) CPA loop runs once per real change instead of several times per
  frame (it was recomputed on every animation frame by the overlay and twice per alarm tick). CPA
  and TCPA display formatting is centralized in `shared/lib` (`formatCpaNm`, `formatTcpaMin`). The
  Signal K socket gates every handler on still being the current socket, so a superseded socket
  cannot inject a delta or schedule a second reconnect. POI classification is case-insensitive, the
  notes overlay skips per-frame work when the map is idle, the layers view updates one item in place
  instead of rebuilding the list on every slider tick, the menu submenu is tied to its content with
  `aria-controls`, and the empty-spec chart overlay no longer installs a dangling listener. Renamed
  `radiansToDegrees` to `radiansToBearing` (it normalizes to 0..360), exported `SELF_CONTEXT`, and
  added `nauticalMilesToMeters`. No behavior change beyond the perf and robustness fixes.

- Second whole-repo cleanup pass. The vessel, AIS, and collision
  entities now expose speed and course in SI (m/s and radians); knots and compass-bearing
  conversion moved to the display edge (the status strip, the vessel and AIS overlays, and a shared
  `formatKnots`), removing a knots-to-m/s and degrees-to-radians round-trip in the collision math.
  The worker hands the AIS batch to the main thread as a nested `Map` across the Comlink boundary,
  dropping a per-frame object rebuild on each side. The collision overlay dirty-checks the
  assessment by reference instead of building a per-frame signature string. Gap-splitting for track
  simplification and export is one shared `splitAtGaps` helper, the theme and settings localStorage
  writes are guarded against quota and private-mode failures, the menu-icon, connection-phase, and
  theme label maps are typed to their unions, and dead code (an unused `metersToNauticalMiles`
  export, a `LatLon` re-export, the entry-module default export, and a redundant callback wrapper)
  was removed.

- The layers controls (per-layer visibility and opacity) moved off the chart into the app menu.
  They were a panel floating over the top-left of the map; they now live in a collapsible "Layers"
  submenu inside the menu, so the chart is unobstructed and the controls share one place with other
  app options. Each layer's visibility and opacity still persist across refreshes.

- The own-vessel marker is now a boat hull instead of a flat triangle. It is drawn with the 2D
  canvas (filled hull, darker outline, sharp bow, flat transom) at 2x for retina crispness, rotates
  to `headingTrue` (falling back to `courseOverGroundTrue`), and recolors with the theme (blue by
  day, red at night). The pointed bow makes the heading unambiguous. The symbol-overlay factory
  gained an optional `pixelRatio` so an icon can be drawn at 2x.

- A tiled chart now hands off to the base map when you zoom past its native detail. Each chart's
  draw layers are capped one zoom level beyond the source's native maximum (read from the loaded
  tile metadata, so it is archive-agnostic), so zooming in past the chart's scale reveals the sharp
  base map instead of a blocky overzoomed chart. The chart stays authoritative within its own zoom
  range and aligned with the base beyond it.

- The collision danger strip's Acknowledge control now works: acknowledging suppresses the current
  worst contact, and a new or more severe contact automatically re-arms the alert. The full
  mute/alarm lifecycle remains a later Lookout step.

- Whole-repo cleanup pass: a chart now themes its own draw layers through an `applyTheme` broadcast
  from the layer manager, so the widget no longer reaches into chart layers by id (the source-layer
  to color mapping lives in one place); the vessel and AIS overlays are built from a shared
  `createSymbolOverlay` factory instead of duplicated scaffolding; the vector draw order and per
  source-layer styling are a single ordered list; a `mapstyleJSON` chart is a clean no-op pending
  the style pipeline rather than a broken source; AIS target views are memoized by version so
  own-vessel motion no longer rebuilds the list; the AIS staleness scan is throttled off the
  per-frame path; the subscription registry gained a refcounted `remove` and the worker routes
  unsubscribe through it so a dropped path is not resurrected on reconnect; `PersistedValue` reports
  `fromStorage` by key presence rather than a value compare; coordinate formatting and the
  AIS-target field extractors were de-duplicated; the connecting state is a shared
  `INITIAL_CONNECTION_STATE`; dead code was removed (`PathCell.receivedAt`, the unused `worst`
  getter, the `kelvinToCelsius` and `metersToFeet` helpers, identity arithmetic in the icons, and
  several unreachable null-guards); and the danger strip shows a "+N more" cue instead of silently
  truncating the contact list.

- Whole-repo cleanup pass: the chart source and layer ids derive from a single `chartSourceId`
  helper, the own-vessel overlay skips its per-frame `setData` when position and heading are
  unchanged, the vessel icon is built once and cached, the connection clears its reconnect timer
  on disconnect, malformed delta frames and chart fetch errors now warn instead of failing
  silently, MapLibre source and layer specs are properly typed (no `as never` casts), the layers
  panel hides the opacity slider for layers that do not support it, the unit converters accept
  `null`, the connection wakes a single shared own-vessel instead of two, and the shared test
  fakes (`FakeWebSocket`, `createFakeMap`) live in `src/shared/testing/` rather than being
  redefined per test. The dependency-cruiser ruleset now covers every Feature-Sliced Design
  layer direction, including the cross-feature public-API boundary.

- The map: a MapLibre GL map with a vector base, rendered in the chart area. A framework-free
  `LayerManager` gives every overlay an independent toggle, opacity, and deterministic z-order
  via sentinel layers and `beforeId`, so a new overlay later is a new file plus one
  registration. The own vessel renders as a GPU symbol layer that rotates with heading (falling
  back to course over ground), updated from the Signal K store each animation frame. Includes
  the PMTiles protocol registration for future offline tiles.

- Real-time data layer: a Web Worker hosts the Signal K WebSocket client, bridged to the main
  thread with Comlink, delivering one batched frame per animation frame. A path-keyed runes
  store of independently reactive cells lets a component bound to one Signal K path avoid
  re-running when an unrelated path changes. Includes delta reconciliation, a per-frame
  last-write-wins batcher, a refcounted subscription registry, full-jitter reconnection with
  resubscribe on open, and an own-vessel entity that converts SI values to display units at the
  edge. The shell shows live connection state and own-vessel SOG and COG.

- Project floor (Phase 1 of the foundation): a Svelte 5, Vite, and TypeScript application
  that builds as a Signal K webapp, serving static files from `public/` at `/binnacle/`.
- Feature-Sliced Design layout (`app`, `views`, `widgets`, `features`, `entities`, and
  `shared`) with module boundaries enforced by dependency-cruiser.
- SI unit-conversion module in `shared`, built test-first, covering meters per second to
  knots, radians to a normalized degree bearing, Kelvin to Celsius, meters to feet, and
  meters to nautical miles.
- Verification toolchain: Biome for lint and format, svelte-check for type-checking, Vitest
  for unit tests, Playwright for an end-to-end smoke test, and a CI workflow running the
  full gate on Node 24.
- Foundation design spec and Phase 1 implementation plan under `docs/superpowers`.
- README, an Apache-2.0 LICENSE, and a Buy Me a Coffee funding link (README badge,
  `.github/FUNDING.yml`, and the `package.json` funding field).

### Fixed

- The active-route Stop button and the collision-alarm Acknowledge button on the bottom strips were
  inert. When both strips moved to the shared `.bottom-strip` class, the app shell's `pointer-events`
  override still targeted their old `.nav-strip` and `.danger-strip` selectors, so each slot's
  `pointer-events: none` reached the button. The override now targets `.bottom-strip`, restoring both
  safety-critical actions.

- Night-red contract violations are corrected: the AIS target was orange (it is
  now in the red band, with a test guarding it), and the rain-radar legend showed literal blue and
  green chips at night (now a red intensity ramp). The collision warning severity and an empty track's
  stats are no longer misleading (a distinct warning color in the danger strip and the thresholds, and
  a placeholder instead of a zero), and the weather panel no longer renders with square corners
  because a referenced radius token was undefined.

- Accessibility fixes: the slide-over panels close on Escape and restore focus, the
  layer visibility checkboxes and the threshold inputs have explicit names, the note-detail and
  weather conditions async states announce as status or alert, the add-chart URL field is labeled, the
  chart rename commits on Enter, the layer-reorder handle advertises its arrow-key shortcut, and the
  menu popout uses dvh so a long menu stays reachable on a phone.

- Saving a route now works. The Signal K server validates the standard route resource, and two
  things failed that validation silently: an unnamed waypoint wrote an empty metadata entry the
  schema rejects (every entry must carry a name), and over plain HTTP the route id fell back to a
  non-UUID string that the resources API refuses for standard types. Routes now omit per-waypoint
  metadata when no waypoint is named (and name the gaps by position otherwise), and route and track
  ids are always real v4 UUIDs, generated from `crypto.getRandomValues` where `crypto.randomUUID` is
  unavailable. Verified end to end against the server: a drawn, unnamed route now saves, lists, and
  survives a reload.

- The on-chart route editing line is easier to see and the Routes controls read as actions. The
  editing line was a blue that blended into the water; it now uses the bright selection accent (amber
  by day, a light red at night) and a heavier stroke, and the New route and Save buttons are filled
  with the accent instead of flat gray. Each saved route now sits in its own elevated card: the name
  is a title on its own line, a mono distance and waypoint-count readout sits beneath it in the same
  instrument style as the navigation strip, the actions form a clean cluster with the delete pushed to
  the trailing edge, and the active route is marked with an accent edge bar, an accent tint, and an
  "Active" pill so the live route is obvious at a glance in every theme.

- In the menu, Routes now sits above Layers and charts.

- A vector chart that declares a coverage extent now honors it. The raster chart paths already passed
  the declared `bounds` to MapLibre, but the vector path dropped it, so a regional vector chart
  requested and 404'd tiles across the whole world instead of only within its coverage. The vector
  source now carries `bounds` the same way the raster sources do.

- A provider-supplied collision contact is now gated the same as a locally computed one at the exact
  instant of closest approach. The provider branch treated a TCPA of zero (closest approach right now)
  as a live danger while the computed branch treated the same geometry as no longer closing; both now
  require a positive TCPA, so the two CPA sources agree and a just-passed contact cannot flicker as a
  danger from one source but not the other.

- Weather values now read consistently to one decimal. The legend low and high labels and the wave
  period readout previously mixed bare integers ("0", "9") with decimals ("0.0", "0.5"); wind, waves,
  precipitation, and cloud now all show one decimal place ("X.X"). Bearing, pressure, and temperature
  stay whole numbers, as those units are conventionally integers.

- Weather caching now fits the data. Forecasts are cached for an hour rather than 30 minutes (Open-Meteo
  model runs are hours apart, and the time slider already shows the right hour from the cached 5-day
  window), roughly halving request volume. When only the marine (waves) endpoint fails, commonly an
  Open-Meteo 429 on its separate host, the forecast grid (wind and pressure) is still shown but is not
  cached and the loader backs off, so panning no longer re-hits the rate-limited endpoint on every move.

- The weather mini-map no longer freezes blank when Rain radar is on. The RainViewer raster source
  starts with no frame URL (real frames arrive later), and MapLibre loads tiles for a layer in the
  style regardless of its visibility, so an empty tiles array crashed its tile-URL builder and then
  the raster render program, freezing the panel. The source now seeds a transparent placeholder tile
  so tile loading always succeeds, and the layer stays hidden until a real frame is applied so it is
  never drawn empty. Real frames replace the placeholder as before.

- Weather is gentler on the free data sources and correct over fresh water. The atmospheric forecast
  no longer forces Open-Meteo's sea cell selection, which picked wrong or missing cells over inland
  and freshwater areas such as the Great Lakes; sea selection now applies only to the marine wave
  request. A failed grid fetch backs off for a minute instead of retrying on every pan, the per-load
  grid is sampled to fewer points so a load fits a single request, and the viewport cache is capped.
  The "Here" conditions panel keys its lookups on a position rounded to about 110 meters, so GPS
  jitter no longer refetches (and no longer spams a Signal K weather provider with point requests) on
  every fix.

- The Forecast button is no longer clipped at the bottom of the status strip, and wind readouts show
  one decimal place (matching waves), even at zero.

- Signal K access approval now connects on its own. Previously, after you approved Binnacle in the
  Signal K UI and returned to the tab, it kept polling a stale request and only a second tab would
  connect. Binnacle now rechecks the pending request the moment the tab regains focus (background
  tabs throttle the poll timer), re-requests a fresh one if the old request expired, connects the
  stream reactively the instant access is granted (no reload), and adopts a token approved in another
  tab via the storage event. The old one-shot blocking connect that required a reload or a second tab
  is gone.

- A raster chart layer now follows the night-red theme (desaturated and dimmed) instead of staying
  full-saturation and full-brightness, matching the streaming depth layers.

- The track and PMTiles stores no longer lose records when IndexedDB degrades mid-session: every
  write is mirrored to the in-memory fallback, so data written before the failure survives.

- Switching the theme from night-red or dusk back to day no longer leaves the base map broken. The
  day restore brings the water and land fills back to their real colors and clears the dark label
  halo from street names. `fill-pattern` is a paint property in MapLibre, not a layout one, so the
  day-restore snapshot had silently dropped every fill layer, and the label halo was reset only when
  the source style already defined one.

- In the day theme, an unchecked layer checkbox no longer renders as a solid black square. The day
  theme declared a dark `color-scheme` despite being a light theme, so native controls rendered in
  dark mode; day now uses a light `color-scheme`, and checkboxes follow the theme accent (no blue at
  night).

- The base map now recolors fully for the theme. Previously only the background and water were
  themed, so over land at higher zoom the OpenFreeMap roads stayed white and the parks and landcover
  green even in night-red, breaking the pure-red-on-black contract. Every base layer is now recolored
  from its source layer (water, landcover, landuse, transportation, building, boundary, and text
  labels) per theme, fill patterns are cleared so the flat themed color shows, and label text gets a
  background-colored halo. Day and dusk gain a calmer palette consistent with the app; night-red is
  red-on-black across the whole map.

- A vector (PMTiles) chart could drop tiles to blank gaps at low-to-mid zoom (around z9) on some
  GPUs, even though the tiles fetched fine (HTTP 206) and decoded correctly. The cause was render
  load: the archive ships `landuse` un-simplified from low zoom, so a single z9 tile can carry
  roughly 1700 polygons that are invisible at that scale but heavy to draw over the full base map,
  which a weaker or high-DPI GPU silently fails to render. The chart now holds `landuse` until z12,
  where it is actually legible, cutting the low-zoom chart draw load sharply. Each chart layer's
  minzoom is preserved through the max-zoom cap.

- A vector (PMTiles) chart could show blank gaps over a real network. The archive is read
  uncached (`cache: 'no-store'`, to dodge a Chrome disk-cache write failure), so each chart tile
  depends on a live HTTP range read; a transient drop or a server hiccup under a burst of reads (a
  zoom that pulls in new tiles) blanked that tile until a later zoom re-requested it. The PMTiles
  source now retries a failed or 5xx range read (short backoff, up to two tries) while still
  honoring a caller abort, so a transient failure no longer leaves a hole.

- AIS targets disappeared from the chart after about six minutes of page uptime. The worker stamped
  each frame's epoch with 0 (`requestAnimationFrame` is absent in the worker, so the batcher's
  fallback passed 0) while the overlay pruned staleness against `performance.now()`, so pruning
  tracked uptime, not real staleness. The worker now stamps a wall clock (`Date.now`) and the
  overlay prunes with the same clock.
- The AIS change counter bumped on every worker frame, not only on AIS changes, because the worker
  always emits an `ais` object (empty when only the own vessel moved). It now bumps only when a
  context actually updates, so the AIS overlay and the collision assessment no longer rebuild every
  frame.
- The stored-token auth probe now omits credentials, so a live session cookie cannot mask a stale
  token and leave the WebSocket streaming nothing.

- Vector charts (MVT/PMTiles) rendered nothing on the map. A vector tile source paints nothing on
  its own: MapLibre needs a draw layer per source-layer, and the chart adapter both routed these
  charts to a raster source and, on the vector path, emitted no draw layers. The adapter now routes
  any chart marked `mvt`/`pbf`, typed `tileJSON`/`mapstyleJSON`, or ending in `.pmtiles` to a vector
  source and generates themed fill and line draw layers per source-layer. It covers the two dominant
  vector base-map schemas (Protomaps and OpenMapTiles) and, because Signal K's charts API often
  returns an empty layer list for an archive, falls back to the full known set when none are
  declared; MapLibre silently ignores a draw layer whose source-layer is absent. The chart layers
  recolor with the day, dusk, and night-red themes, and per-layer opacity now uses the correct paint
  property for fill, line, and raster layers.

- PMTiles vector charts failed to render with `ERR_CACHE_WRITE_FAILURE`: a large archive served
  with a weak ETag over range requests makes Chrome fail the HTTP disk-cache write, which rejects
  the whole fetch and blanks the chart. Binnacle now registers each PMTiles archive with a source
  that fetches ranges with `cache: 'no-store'`, bypassing the browser cache for these reads. Durable
  offline caching of these archives is a later spec.

- Collision assessment no longer raises a false alarm on an opening or already-passed AIS target:
  the provider closest-approach path now drops a contact whose time to closest approach is negative
  (the closest approach is in the past), matching the computed path's behavior.
- Closest-point-of-approach math now normalizes the longitude difference, so a vessel pair
  straddling the antimeridian computes a real short range instead of a bogus near-360-degree offset.
- The AIS change counter is now reactive state, so a future reactive consumer is notified rather
  than only the per-frame poll, removing a latent reactivity trap.

- Own-vessel readouts (SOG and COG) stayed blank while live data flowed. The store creates a
  path cell lazily on first access; the first access was the shell's reactive readout, so a
  brand-new `$state` source was created during the effect's tracking pass and never subscribed,
  and later updates did not re-render. `OwnVessel` now creates its cells at construction, before
  the readout runs, so the reactive read tracks an existing cell.
- The auth probe could mistake a secured server for an unsecured one. It checked a REST path that
  a browser session cookie satisfies, so it concluded "unsecured" and connected the WebSocket
  stream without a token, which the cookie does not authenticate, leaving no live data. The probe
  now checks a stored token first and runs the anonymous check with credentials omitted, so a
  cookie cannot mask the need for a token.
- The Signal K worker crashed at load with "Class extends value undefined" because the worker
  graph imported the server-side `@signalk/server-api` package, whose entry re-exports a
  `FullSignalK` class extending Node's `EventEmitter`; bundled into the browser worker with
  `events` externalized, that base class resolved to `undefined`. The worker now mirrors the few
  Signal K wire types it needs locally and no longer imports the package, dropping the worker
  bundle from about 164 KB to about 7 KB and removing the dependency entirely.
- The chart area rendered all blue offshore because the base map was fetched from a CDN
  (`tiles.openfreemap.org`), which is unreachable on a boat with no internet, leaving an empty
  map that showed the page background through it. Binnacle now ships a bundled, offline base
  style that the theme recolors, with Signal K charts layered on top. Bundled vector base tiles
  are a later spec; this removes the CDN dependency in line with the offline-first rule.

### Security

- The points-of-interest popup's "View details" link now follows only `http:` and `https:` URLs.
  A note's link comes from a resource provider Binnacle does not control, so a `javascript:` or
  `data:` URL would otherwise execute when clicked; non-http schemes and unparseable URLs are now
  dropped.
