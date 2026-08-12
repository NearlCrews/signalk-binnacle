# Binnacle Chartplotter

[![npm version](https://img.shields.io/npm/v/signalk-binnacle.svg)](https://www.npmjs.com/package/signalk-binnacle)
[![npm downloads](https://img.shields.io/npm/dm/signalk-binnacle.svg)](https://www.npmjs.com/package/signalk-binnacle)
[![CI](https://github.com/NearlCrews/signalk-binnacle/actions/workflows/ci.yml/badge.svg)](https://github.com/NearlCrews/signalk-binnacle/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/NearlCrews/signalk-binnacle/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22.18-brightgreen.svg)](https://nodejs.org)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://www.buymeacoffee.com/nearlcrews)

A WebGL chartplotter for [Signal K](https://signalk.org).

> **It has not been field-tested at any scale.** It has been developed and verified against a single
> Signal K server, never across a fleet or a range of real-world boats, hardware, and conditions. It
> is also not certified for safety-of-life navigation. Always carry redundant means of navigation,
> cross-check against your primary instruments, and treat every display as advisory.

## What's new in 0.20.0

The watchkeeping release. A change of watch gets a real handoff: a timestamped snapshot of the
fix, course, alarms, closest contact, depth watch, radar, weather and tide ages, and route
coverage, shared between stations through Signal K and honest about what is device-only. The
chart learns course-up and heading-up as explicit profile-owned modes that fall back to north the
moment their reference goes stale, the route plan becomes a passage plan with departure time and
a local-clock arrival at every point, and an advisory coverage check reports whether the charts
along a route are actually cached for offline use.

Trust is the through-line. When the Signal K server declares a path timed out, every surface
reacts at once: retained values are labeled with their age instead of posing as current, the
instrument detail names the source that went quiet, and with two GPS units the surviving one
keeps the position live. The detail also lists what each recent source reports, a
recent-source-change cue catches quiet failovers, and an ambient chart badge grades every view
honestly, counting the NOAA ENC as a chart only inside its real regional coverage and never
calling the reference base map a chart.

The helm itself sharpens: one alarm authority ranks every sound so MOB and a closing contact
interleave instead of colliding, the collision strip's CPA and TCPA take the largest numerals on
screen, instrument tiles lead with SOG-style abbreviations and honest state chips, the MOB button
becomes the chrome's one solid-red key (dimmed at rest at night), zoom and scale controls follow
the theme so night vision survives them, and first-run help orients a new crew without nagging a
returning one. See the changelog for the complete list.

## What it does

Signal K is an open marine data standard that streams a boat's navigation, environment, and AIS data
over a single API. Binnacle displays that data: a GPU-rendered, offline-capable chartplotter that
runs in a browser and is served by the boat's Signal K server.

It is built for low-bandwidth, offline use on modest hardware. It has night-readable themes, computes
collision and course data on the client when no server provider supplies them, and caches viewed
areas so they keep rendering without a connection. It runs on the same Raspberry Pi that hosts the
Signal K server.

## Features

Binnacle ships its full feature set as a Signal K webapp:

- **Charts and layers:** a GPU vector base map, server charts, five streaming bathymetry and ENC
  sources (NOAA ENC, BlueTopo, and EMODnet each add a nested survey-quality facet; GEBCO is global
  base bathymetry; Seascape adds globally merged depth shading, hillshade, contours, and soundings),
  and your own PMTiles charts added by URL or served from the server's charts folder. The Charts tab
  selects chart sources and opens source details. Signal K style-document sources remain listed and
  available for inspection, but Binnacle labels them unsupported and keeps them off instead of
  presenting a blank chart. The Overlays tab controls visibility, opacity, and stacking for marks,
  routes, weather-adjacent data, and other map overlays.
  An ambient chart badge on the map corner grades the current view honestly: Chart when a real
  nautical chart covers it (a server or user chart, or the NOAA ENC within its actual regional
  coverage), Reference map only when nothing but the base map is showing, and Outside chart
  coverage, Chart overzoomed, or a failure state when that is the truth; bathymetry references
  never count as charts.
  A 24 hour **track history** layer draws the server-recorded past day under the live track.
- **Offline charts:** with the optional Chart Locker plugin, draw and save the chart area needed for a
  passage, choose overview, coastal, or harbor detail, review the estimated download and available
  storage, and watch visible tile, byte, and error progress. Saved-area cards lead with an
  at-a-glance summary (detail level, chart count with any unavailable ones, and approximate span in
  nautical miles) with actions to show the area on the chart,
  download it again, or reuse its settings for an adjusted copy. While navigating a route, an
  advisory coverage check samples a chosen 1, 5, or 10 nautical-mile corridor against the ready
  saved areas and their included charts, reports Complete, Partial, or Unknown, and highlights
  uncovered and insufficient-detail stretches on the chart; it never certifies navigation or
  passage safety. The same landing page manages
  automatic caching around the boat, installed chart names and file health, and storage. Without
  Chart Locker, the menu entry stays visible and explains how to add it.
- **Overlays:** free, key-free OpenSeaMap seamarks, marine protected areas, maritime boundaries, and
  NASA GIBS ocean conditions (sea-surface temperature and sea ice), each with its source attribution.
- **Marine radar:** an optional live radar picture from the Signal K Radar API, rendered over the chart
  with range rings, a heading line, strict night-red colors, confirmed transmit, immediate standby,
  direct overlay settings, the tuning controls reported by the radar, and atomic form and chart
  editors for complete native zones, no-transmit sectors, and rectangles. Chart placement keeps its
  active step and Stop action visible on phones, while area geometry follows the live frame heading
  and range. Provider, stream, stale-data, access, and renderer failures remain distinct so an old
  picture is never presented as live.
- **Routing:** draw and save routes as Signal K resources, or tap **Go to here** (long-press or
  right-click the chart) to navigate straight to a point. Follow a route with a nav strip (cross-track,
  distance, bearing, velocity made good, and time to go) over the v2 Course API, with an arrival alarm
  and extent-aware skip-waypoint controls. A plan speed and an editable departure time turn the route into a
  **passage plan** with a named leg table: cumulative elapsed time and a local-clock arrival at every
  endpoint (dated when it lands past midnight), plus the whole-route passage duration. Routes **import and export as GPX** to move between
  Binnacle and other chartplotters and MFDs, and saving an active route refreshes the server's Course
  API without dropping the current route list during a transient read failure.
- **Profiles:** keep named helm setups containing the theme, chart and weather layers, collision
  thresholds, track and planning settings, unit fallback, toolbar pins, instrument and Data trends
  selections, and preferred anchor radius. Changes to the active profile save automatically.
  Profiles, defaults, and edits sync through Signal K when you are logged in, while each browser
  keeps its own active choice and chart view. Concurrent edits merge by setting instead of replacing
  the whole profile. Signal K 2.23.0 and later provide the strongest atomic cross-station revision
  protection, while older servers retain local saves and best-effort synchronization.
- **Instruments:** tap the Instruments pill and the chart slides left for a gauge dock (SOG,
  heading, depth, apparent wind, and more from a curated catalog you pick and reorder); on a phone
  the tiles take the full screen, KIP-style. Values color by your server's configured meta.zones
  alarm bands, and selections ride profiles. Customize discovers the live Signal K model and, when a
  history provider is installed, equipment recorded during the preceding year. Previously recorded
  readings remain clearly marked and never replace live values. Dynamic options name both the reading
  and source, while a catalog-level fallback keeps future repeated labels distinct. Every tile's
  detail names its live Signal K source and, on watch-critical paths, calls out a recent source
  change or several alternating sources so a quiet failover never goes unnoticed; when two or more
  sources feed the shown path, a Recent sources list shows what each one reports, neutrally.
  Staleness honors the server first: a path the server's meta.timeout enforcement declares timed
  out reads Stale (server declared) across every surface at once, keeps its last good value
  visible with an honest age, and names the source that went quiet, and a path's own declared
  timeout replaces the default tile staleness window so a legitimately slow sensor is never
  flashed stale. Instrument
  dashboard (KIP) launches the installed KIP webapp; when KIP is absent, the item stays visible but
  unavailable and explains how to add it.
- **Time travel:** review 1 hour, 6 hours, 24 hours, or 7 days from one registered Signal K history
  provider. Scrub or replay the synchronized recorded track, vessel position, depth, apparent wind,
  barometer, and speed over ground at 0.5x, 1x, or 2x. Full local dates identify day transitions,
  Now returns to the newest loaded sample without another query, and a failed range keeps the last
  accepted history visible.
- **Weather:** a zoom-capped mini-map with animated WebGL wind, pressure isobars, waves,
  precipitation, cloud, and radar, plus time-aware point readouts, marine forecasts, source and age
  labels, deterministic risk cues, and official warnings when a Signal K weather provider supplies
  them. Open-Meteo provides the key-free fallback, including wind waves, swell, currents, and sea
  surface temperature, while cached forecasts remain available offline with explicit stale labeling.
  The routes shown on the chart draw read-only over the forecast with their named waypoints, so a
  passage can be read against the weather without implying the forecast was routed along it.
- **Tides:** independent tide-height and tidal-current station selection with automatic nearest
  choices, exact manual NOAA CO-OPS choices, a 48-hour tide curve, and the next high, low, flood, ebb,
  or slack. Filled tide markers, hollow current markers, and their loaded prediction labels are
  selectable on the chart. Manual choices survive chart pans for the session but reset on reload.
  NOAA CO-OPS covers US waters out of the box; automatic tide height prefers the signalk-tides plugin
  when the server runs it.
- **Lookout:** a collision watch with CPA and TCPA, chart-highlight rings, an audible alarm, and a
  published Signal K notification, plus a searchable, risk-filtered **AIS target list** with
  tappable chart targets, live in-panel details, and sorting by range, CPA, or name. Each detail
  keeps range and bearing live, locates the target on the chart, and complements faded **target
  trails** from the tracks plugin. An
  **Alarms panel** collects every active alert on the boat (engine, autopilot, any plugin); any alarm
  or emergency grade notification outside the dedicated hazards sounds its own tone and raises a
  strip with the count showing live on the Alarms menu entry, with one-tap Silence and Acknowledge
  that propagate to every station and a device-local mute when the server cannot silence it. One
  alarm sounds at a time through a single audio authority: man overboard and an escalating
  collision danger interleave at the top, lower alarms rotate with bounded reminders so none is
  hidden, courtesy tones like arrival yield to real alarms, and blocked or failed alarm audio is
  stated on the status strip with a one-tap Enable.
- **Anchor watch:** drop the anchor at the boat, set the swing radius (or capture it from the live
  distance), and get a drag alarm that latches until acknowledged. It drives the
  signalk-anchoralarm-plugin when installed (so the alarm keeps running with the browser closed) and
  falls back to a fully in-browser watch when it is not, with a draggable drop-point marker on the
  chart.
- **Man overboard:** an always-visible MOB button in the top bar with a confirm pop-out. Confirming
  marks the spot, publishes the boat-wide Signal K alarm, and raises a recovery strip with live
  bearing, range, and elapsed time, plus an opt-in **Steer to MOB** handoff to the course system. An
  MOB raised by another station shows here too.
- **Watch handoff:** a timestamped review-status snapshot for the change of watch: fix and source
  age, course with cross-track error and a basis-qualified time to go, raised alarms and mute
  expiry, the top collision contact and assessment health, depth watch, radar health, weather and
  tide ages, and whether the active route's offline coverage was checked, plus a short operator
  note. Snapshots share between stations through Signal K applicationData, queue on the device when
  the server store is unreachable, and always state whether they are shared, waiting to sync, or on
  this device only. Taking one changes nothing else, and the surface reviews status; it never
  declares it safe to take watch.
- **Measure:** tap points on the chart for rhumb-line leg range, true bearing, and a running total.
  Select any point from its generous chart target or the strip, move or delete it, and Undo the
  completed operation without dismantling later legs. Collision-managed leg labels stay restrained
  by zoom, Clear confirms before resetting, and Done removes the temporary session-only points.
- **Tracks:** record, pause, save, show, and export segmented voyage tracks as
  GeoJSON. GPS gaps never become invented route legs. Save the latest continuous segment as a reusable
  route, or confirm a retrace to navigate home along it. The panel explains persistence, access,
  loading, and refresh failures instead of silently losing state. The active trail survives reloads in
  IndexedDB. Completed tracks live in Signal K resources and can be shared with other clients once the
  server stores them, which takes one administrator step: in the Signal K admin UI, open Server,
  then Plugin Config, then Resources Provider (built-in), and add tracks under Resources (custom).
  Until that is done, the panel names the step instead of letting a save fail.
- **Waypoints:** drop one from a long press, see it as a named marker, and search, sort, locate,
  navigate to, rename, or delete it from the Waypoints panel. Search covers name and description, and
  sorting by name, distance, or bearing needs a fresh GPS fix. Loading and failures stay explicit,
  accepted writes survive refresh failures, and navigation requires confirmation and sends the
  waypoint's resource reference so the destination name reaches the navigation strip and other
  stations. Marks live in the server's waypoint resources, so they interoperate with other Signal K
  clients.
- **Data trends:** choose and reorder up to eight supported navigation, weather,
  electrical, propulsion, tank, or cabin readings independently for each profile. Each themed chart
  uses one source and one provider for its 24-hour Signal K History API series, falling back to
  bounded live-session samples on a stock server. Touch and keyboard timeline scrubbing and a
  textual summary make the charts usable without hover, and every chart states its data coverage:
  percent of samples present, the longest gap, and the newest sample's age, marked Partial or Stale
  when warranted. Eligible instrument details can open one
  focused recent trend without changing the saved overview.
- **Find places and points of interest:** search the notes in the current chart view by name,
  category, or provider; sort them by name, category, distance, or true bearing; preview and select a
  result on the chart; and open its structured detail. Add personal notes from a chart press, then
  edit, move, or delete only the notes Binnacle owns. Accepted writes remain visible through a failed
  refresh, while v1-only providers and read-only authorization explain why saving is unavailable.
  Loading, zoom-limit, cached-offline, empty, and provider-error states remain distinct. Custom chart
  symbols are supported through the signalk-symbol-manager plugin.
- **Chart orientation:** north-up by default, with course-up and heading-up as explicit
  profile-owned choices. Heading-up follows fresh true heading, course-up follows fresh COG with
  way on, and a stale or missing reference falls back to north immediately; the status strip keeps
  the live orientation and its reference visible with a one-tap return to north, and a rotated
  chart under Follow gains a bounded look-ahead so the water ahead gets the pixels.
- **Help:** a first-run orientation banner and a permanent Help panel with safe-use framing (an
  advisory chartplotter, not a navigation chart), the reference-map-versus-charts distinction,
  Signal K access and alarm-sound setup, a marine glossary, and operating-context checklists for a
  coastal day, a night passage, and lying at anchor.
- **Your units:** every readout follows the server's imperial-or-metric unit preference; knots,
  nautical miles, and bearings stay nautical.
- **Themes:** day, dusk, and night-red, with true red on black for a dark-adapted watch.

See the changelog for the full list.

## Architecture

Binnacle is built on a current web stack and engineered to run on modest helm hardware:

- **Front end.** Svelte 5 with runes, Vite, and TypeScript, linted and formatted with Biome. The code
  is organized as cohesive, single-responsibility slices under a strict Feature-Sliced Design, with the
  import boundaries enforced by the build through a dependency-cruiser gate, a modular stylesheet
  assembled one concern per file, and shared UI primitives and helpers, so a new feature drops in
  against stable interfaces rather than by surgery on the core.
- **GPU rendering.** MapLibre GL JS 6 draws the vector base map and chart layers through WebGL2. The
  own vessel and every AIS target render as GPU symbol layers, and wind draws as a WebGL particle
  field advected through the forecast on the graphics card.
- **Off-main-thread real-time pipeline.** A dedicated Web Worker hosts the Signal K WebSocket client;
  deltas are coalesced into frame-rate batches on a worker timer and fed into a path-keyed reactive
  store, so a busy AIS anchorage updates the readouts without stalling the chart render, and data and
  alarms keep flowing while the tab is in the background. A failed stream can recreate the worker,
  reconnect, and replay subscriptions without reloading the chartplotter.
- **Minimal network and render work.** Binnacle subscribes to exactly what it draws, keeps everything
  in SI internally, and converts only at the display edge.
- **Offline caching.** Self-hosted fonts and assets (no CDN for app code). PMTiles chart areas are
  cached as blocks in IndexedDB at the protocol layer, so they work offline even over plain http;
  tides, notes, weather, and the vessel conditions persist the same way. Over https a service
  worker additionally caches the base map, plugin chart tiles, supported online overlays, and
  predictions. With Chart Locker installed, server-side saved areas, automatic caching, shared tile
  storage, and installed PMTiles files add a boat-wide offline layer that is independent of one
  browser's cache.

## Requirements

- Signal K server 2.x.
- Node.js >= 22.18 (for building from source).
- A WebGL2-capable browser that supports the shipped ES2023 bundle. Safari 16.4 or later is required.
- Optional: `signalk-chart-locker` for server-managed saved areas, automatic caching, shared storage,
  and installed PMTiles chart management.
- Optional: a Signal K Radar API provider, such as Mayara, for the marine radar overlay and controls.

## Installation

Binnacle is a Signal K webapp. The production build ships inside the package, so there is nothing to
build.

**From the App Store (recommended).** In the Signal K admin UI, open Apps and Plugins, then Store,
search for Binnacle, and install. Open it from the **Webapps** list.

**With npm.** Install into the server's home directory and restart Signal K:

```bash
cd ~/.signalk
npm install signalk-binnacle
```

**From source.** See [Development](#development) below.

**Optional offline-chart management.** Install **Chart Locker** (`signalk-chart-locker`) from the
Signal K App Store, then start the plugin. Binnacle detects it automatically. A secured server may
require you to sign in to Signal K as an administrator before downloads and chart-name edits are
enabled. This is separate from approving Binnacle's ordinary read/write access request. Chart Locker
management calls use the browser's Signal K administrator session, not Binnacle's device token.
Binnacle checks Signal K's live login status before suggesting sign-in, so a Chart Locker permission
failure does not mislabel an authenticated administrator as signed out.

**Optional marine radar.** Run or configure a provider that exposes the standard Signal K Radar API at
`/signalk/v2/api/vessels/self/radars`. Mayara is the reference provider. Binnacle discovers radars,
hydrates `/controls`, listens for `radars.*.controls.*` Signal K deltas, and opens the selected radar's
reported spoke stream. Read access is sufficient for the picture; transmit, standby, and tuning writes
require read-write approval. A provider that reports complete native zone, sector, or rectangle
shapes also gets explicit Edit, Save, Cancel, and optional chart-placement controls. No-transmit
sectors require an additional emission-envelope confirmation. Angles display in degrees, distances
follow the server unit preference, and each write remains one SI geometry update.

## Usage

Open Binnacle from the **Webapps** list in the Signal K admin UI, or go straight to
`http://your-sk-server:3000/signalk-binnacle/`. It opens on the chart, centered on your boat.

A few interactions cover most of the helm:

When installed as a PWA on a touch device, Binnacle automatically reserves bottom clearance for
Android navigation and tablet taskbars. The status strip and mobile app-menu sheet also follow
reported bottom and landscape side safe areas, so their helm controls remain reachable when system
chrome overlays the app window.

The **Profiles** panel includes **Forget credentials** and **Erase all local data** for a shared or
retired display. These actions affect only Binnacle data in the current browser. They do not delete
Signal K routes, waypoints, tracks, profiles, Chart Locker data, administrator sessions, or
server-side device authorization. Synced profiles return after the browser signs in and syncs again.
Profiles and changes that have not synced are permanently lost. Full erasure is blocked while MOB,
anchor watch, navigation, route editing, measurement, or an unsaved recorded track is active.

### Network privacy

Binnacle gets boat data from your Signal K server and loads its vector base map from OpenFreeMap when
the chart opens. When their chart or overlay layers are visible, the browser can also request tiles
from OpenSeaMap, NASA GIBS, Open Waters Seascape, GEBCO, EMODnet, and NOAA services for ENC,
BlueTopo, marine protected areas, and seabed infrastructure. The maritime-jurisdiction and UNESCO
site overlays request VLIZ Marine Regions.

Opening weather or enabling its optional layers can contact Open-Meteo and RainViewer. Opening tides
can contact NOAA CO-OPS for automatic fallback, tidal-current predictions, or a manually selected
station. These services can observe your public network address and the requested tile, map area, or
forecast coordinates. Optional marine, weather, and tide requests are made only when the
corresponding layer or feature is used, and cached results remain usable when a provider is
unavailable.

User-added URL charts are fetched by the browser. Binnacle rejects URLs with embedded usernames or
passwords, removes URL fragments, redacts every query value in displays and errors, and keeps every
query-bearing URL on this device unless you explicitly choose to share the complete URL with the
Signal K server. Chart detail can repair a moved or expired URL, refresh archive metadata, and change
that sharing choice without losing the chart's id or layer settings. Use HTTPS for Signal K so device
credentials and boat data are encrypted on the local network.

- **Open the context menu.** Long-press the chart on a touch screen, right-click with a mouse, or focus
  the chart and use the Context Menu key or Shift+F10. Drop a waypoint, choose **Go to here** to
  navigate straight to that point, or start a route or measurement.
- **Measure a chart leg.** Open **Measure**, tap a start and destination, then read the rhumb range,
  true bearing, and total. Select a point to inspect both adjacent legs, choose **Move point** to drag
  or place it again, and use **Undo** to reverse an add, move, or deletion. Use **Done** when finished.
- **Manage charts and overlays.** Open **Charts** to select chart sources, inspect their details,
  repair a saved PMTiles URL, refresh its metadata, or change server sharing. Switch to **Overlays**
  to toggle overlays, change opacity, and drag rows to reorder their stack.
- **Prepare offline charts.** Open **Offline charts**, choose **Save a chart area**, draw over the
  passage, review the included charts and detail, and start the download. Confirm the saved area's
  status and update date before relying on it away from coverage.
- **Switch themes.** Cycle the day, dusk, and night-red themes from the theme control. Night-red is
  pure red on true black for a dark-adapted watch.
- **Mark a man overboard.** Tap the always-visible **MOB** button in the top bar and confirm to mark
  the spot, raise the boat-wide alarm, and start the recovery strip.

For caching behavior, storage, and HTTPS requirements, see
[Offline charts, Chart Locker, and SSL](#offline-charts-chart-locker-and-ssl-optional) below.

For behavior, availability, recovery states, and safety rules for every menu action, see the menu
items guide in the repository's docs directory. Detailed guides there also cover tracks, waypoints,
find places, measure, marine radar, and offline charts, including offline preparation and
administrator-session troubleshooting. The guides ship inside the installed package as well.

## Offline charts, Chart Locker, and SSL (optional)

Chart Locker is optional, but it is the recommended way to prepare a passage rather than depending
only on charts viewed previously in one browser. Install `signalk-chart-locker` from the Signal K App
Store, then open **Offline charts** in Binnacle. If the plugin cannot be reached, that menu item stays
visible but unavailable and explains whether to install, start, or sign in to Signal K as an
administrator. When administrator access is required, the header status opens that sign-in directly.
The sign-in flow stays in the PWA window and redirects back to the current Binnacle route. If Signal K
already reports an administrator session but Chart Locker refuses it, Binnacle reports an access
error and offers a retry instead of asking the administrator to sign in again.

The offline charts guide in the repository's docs directory covers the full setup, access,
troubleshooting, download, and storage workflow.

The Offline charts landing page has four jobs:

1. **Saved areas.** Choose **Save a chart area**, draw a rectangle on the chart, review the smart
   default chart selection, pick Overview, Coastal, or Harbor detail, check the estimated download and
   free space, name it, and start the download. On a phone, the panel collapses while drawing so the
   chart owns the gesture. A saved-area card is ready only when it says **Saved, works offline**.
   Accepted downloads recover by area identifier if their immediate job response is lost, and a
   temporary status failure offers Retry status without starting a duplicate download. If a saved
   definition references a removed chart source, Binnacle preserves the existing cached coverage,
   labels the missing source, and directs the user to adjust a copy before downloading again.
2. **Automatic caching.** Optionally keep selected charts cached around the moving boat. This is a
   rolling nearby cache, not a substitute for saving and verifying the full planned passage. Settings
   follow Chart Locker's limits for 64 sources, zoom 0 through 24, distances up to 100 km, and update
   intervals from one minute through 24 hours.
3. **Installed charts.** Rename installed PMTiles charts, edit their descriptions, inspect bounds,
   zoom range, and scale, refresh the file list, and see actionable errors for invalid files. Add,
   replace, or remove archives in the Chart Locker chart folder on the Signal K server.
4. **Storage.** Review saved-area, recently viewed, and automatic-caching usage, choose when recently
   viewed charts clear, and clear only that expendable cache without deleting saved areas.

The header's Offline status reports the cache amount or a service problem. It does not certify that a
particular passage is complete. Before leaving coverage, open Offline charts and verify the intended
area's coverage, included charts, **Saved, works offline** status, and update date.

SSL is not required. Binnacle runs fully over plain HTTP, which is how the Signal K server serves it
by default: the chart, AIS, weather, points of interest, tracks, and the Lookout alarms all work
without it.

Much of the offline caching works without SSL. PMTiles chart areas, the weather forecast, tides,
chart notes, and the vessel conditions are cached in IndexedDB, which is not secure-context gated,
so even over plain HTTP a reload replays the last data and previously viewed PMTiles charts keep
rendering offline. What SSL adds is the service-worker layer: browsers expose the service worker
and cache-storage APIs only in a secure context (HTTPS or `http://localhost`), so caching the base
map, plugin-served chart tiles, and the streaming overlays activates only when the server is
reached over HTTPS. Over plain HTTP those degrade cleanly to online-only with no loss of live
function.

Chart Locker's server-side downloads and cache work independently of the browser service worker, so
they do not require HTTPS. HTTPS is still valuable because it enables Binnacle's additional
browser-side service-worker cache for the base map, plugin chart tiles, and streaming overlays.

There are two good ways to add HTTPS to Signal K:

- The [signalk-ssl](https://www.npmjs.com/package/signalk-ssl) plugin
  ([source](https://github.com/dirkwa/signalk-ssl)), which generates a local certificate
  authority, issues the server certificate, and distributes the root to your devices by QR code.
  It runs its certificate tooling on the shared
  [signalk-container](https://github.com/dirkwa/signalk-container) runtime. The Signal K server's
  built-in SSL settings (Server, then Settings, then SSL) are a bare-bones alternative.
- [Tailscale](https://tailscale.com), which adds remote access and publicly trusted certificates
  (no trust-store step at all) in one move. See
  [Accessing Signal K remotely with Tailscale](https://gist.github.com/NearlCrews/3f7af717fec853a80e7de1063940382e)
  for a quick start, including a clean `signalk.<tailnet>.ts.net` service name.

One more step is required, and it is easy to miss: your browser has to **trust** that certificate,
not just reach it. A self-signed certificate, including one the signalk-ssl plugin generates, is not
trusted by default, and browsers refuse to register a service worker from an origin whose certificate
they do not trust, even after you click through the page's certificate warning. So if you only accept
the one-time warning, the page loads but offline caching never activates, and the console shows a
message like "service worker registration failed: an SSL certificate error occurred." To fix it,
install the certificate authority's root (the QR code or `.pem` the plugin gives you) into your
browser or operating system trust store and mark it trusted, then reload over HTTPS. Once the
certificate is trusted, the service worker registers and the base map and chart tiles cache for
offline use.

## Development

Development targets Node 22.18 or newer and npm 11.6 or newer. The recommended npm version is
11.19.0. `.node-version` and `packageManager` record the project defaults, while `devEngines`
enforces the supported minimums. All tools use repository-local dependencies.

```bash
git clone https://github.com/NearlCrews/signalk-binnacle.git
cd signalk-binnacle
npm install        # install dependencies
npm run hooks      # install the git pre-commit and pre-push gates (run once)
npm run dev        # Vite dev server
npm run check      # type-check application, tooling, and browser tests
npm run lint       # code, Svelte, Markdown, and spelling checks
npm run format     # Biome format (write)
npm run ci:biome   # format, lint, and import-order verification
npm run cruise     # dependency-cruiser boundary check
npm run deadcode   # unused files, dependencies, and public exports
npm test           # Vitest unit tests
npm run test:coverage # unit tests with the enforced coverage floor
npm run build      # production build into public/
npm run size       # compressed production bundle budgets
npm run verify     # complete non-browser local and CI gate
npm run test:e2e:fast # Build, then run the Chromium browser checks only (no offline/PWA or WebKit coverage; use test:e2e:cross-browser or test:e2e:gate for the full spread)
npm run test:e2e:cross-browser # Build, then run Chromium, PWA, and WebKit checks
npm run verify:release # full gate, cross-browser E2E, package checks, and runtime audit
```

After `npm run hooks`, git runs `verify:commit` before each commit and `verify:browser` before each
push. The hooks live in `.githooks/` and are opt-in via `core.hooksPath`, never a package lifecycle
script. The E2E commands build first, while the pre-push
`test:e2e:gate` reuses the existing `public/` build from `verify` so a push does not rebuild.

Maintainers preparing a version should follow the release checklist in `docs/releasing.md`.
Preparation does not authorize a tag, GitHub release, or npm publication.

To run a local build inside your own Signal K server, link it into the server's module directory and
add it to the server config so it loads:

```bash
ln -sfn "$(pwd)" ~/.signalk/node_modules/signalk-binnacle
```

```json
{
  "dependencies": {
    "signalk-binnacle": "file:../path/to/signalk-binnacle"
  }
}
```

Restart Signal K, then open `http://your-sk-server:3000/signalk-binnacle/` in a browser.

## License

Apache-2.0. See the LICENSE file for the full text. The software is provided "AS IS", without
warranty of any kind. It has not been field-tested at scale and is not certified for navigation.
Treat all on-screen information as advisory, and always carry independent means of position-fixing.

## Acknowledgments

Binnacle is written and maintained by [Nearl Crews](https://github.com/NearlCrews). It stands on
open data and open source:

- [Signal K Project](https://signalk.org/) for the open marine data standard.
- [MapLibre GL JS](https://maplibre.org/) for the GPU map renderer, and
  [OpenFreeMap](https://openfreemap.org/) for the vector base map, built from
  [OpenStreetMap](https://www.openstreetmap.org/) data under the
  [Open Database License](https://opendatacommons.org/licenses/odbl/).
- [Open-Meteo](https://open-meteo.com/) for atmospheric and marine forecast grids, and
  [RainViewer](https://www.rainviewer.com/) for precipitation radar.
- [NOAA](https://www.noaa.gov/) for the ENC chart, BlueTopo bathymetry, the MPA Inventory, and the
  CO-OPS tide and current predictions; [EMODnet](https://emodnet.ec.europa.eu/) for European
  bathymetry, protected areas, and the seabed infrastructure layers (power cables, telecom cables,
  pipelines, and wind farms); [GEBCO](https://www.gebco.net/) for global bathymetry;
  [Open Waters](https://openwaters.io/charts/seascape) for Seascape, merging GEBCO, EMODnet,
  NOAA CUDEM, and other regional sources into worldwide depth shading, hillshade, contours, and
  soundings; [NASA EOSDIS GIBS](https://www.earthdata.nasa.gov/engage/gibs) for the ocean-conditions imagery;
  [OpenSeaMap](https://www.openseamap.org/) for the seamark overlay; and the
  [Flanders Marine Institute (VLIZ)](https://www.vliz.be/) Marine Regions service for the maritime
  boundaries, the 12 nm, 24 nm, and high seas limits, the IHO sea areas, and the UNESCO marine
  sites.

Custom chart symbols come from
[`signalk-symbol-manager`](https://github.com/joelkoz/signalk-symbol-manager) by
[Joel Kozikowski](https://github.com/joelkoz), who also contributed the symbol rendering Binnacle uses
in [#6](https://github.com/NearlCrews/signalk-binnacle/pull/6).

Binnacle pairs well with sibling plugins such as
[`signalk-crows-nest`](https://github.com/NearlCrews/signalk-crows-nest), which supplies the points
of interest it renders, and works with any Signal K weather provider, such as
[`signalk-virtual-weather-sensors`](https://www.npmjs.com/package/signalk-virtual-weather-sensors).

## Support

Find this project useful? You can support its continued development by
[buying me a coffee](https://www.buymeacoffee.com/nearlcrews).

- [Report a bug](https://github.com/NearlCrews/signalk-binnacle/issues/new?template=bug_report.yml)
- [Request a feature](https://github.com/NearlCrews/signalk-binnacle/issues/new?template=feature_request.yml)
- [Security issues](https://github.com/NearlCrews/signalk-binnacle/security/policy)
