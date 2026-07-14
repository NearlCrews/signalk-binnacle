# Binnacle Chartplotter

[![npm version](https://img.shields.io/npm/v/signalk-binnacle.svg)](https://www.npmjs.com/package/signalk-binnacle)
[![npm downloads](https://img.shields.io/npm/dm/signalk-binnacle.svg)](https://www.npmjs.com/package/signalk-binnacle)
[![CI](https://github.com/NearlCrews/signalk-binnacle/actions/workflows/ci.yml/badge.svg)](https://github.com/NearlCrews/signalk-binnacle/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/NearlCrews/signalk-binnacle/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://www.buymeacoffee.com/nearlcrews)

A WebGL chartplotter for [Signal K](https://signalk.org).

> **It has not been field-tested at any scale.** It has been developed and verified against a single
> Signal K server, never across a fleet or a range of real-world boats, hardware, and conditions. It
> is also not certified for safety-of-life navigation. Always carry redundant means of navigation,
> cross-check against your primary instruments, and treat every display as advisory.

## What's new in 0.15.0

Safer, clearer menu workflows across navigation, chart management, safety, weather, instruments,
offline charts, and profiles.

- **Complete menu refresh.** Every action now distinguishes loading, stale data, missing providers,
  read-only access, empty results, and recoverable failures. Destructive and navigation actions use
  confirmations, pending operations lock conflicting controls, and retries retain accepted data.
- **Expanded helm tools.** Radar controls expose stream and renderer health, instruments discover
  more Signal K equipment, Chart Locker saved areas show detailed progress and coverage, and routes,
  tracks, waypoints, Find places, Measure, weather, tides, trends, and profiles have richer workflows.
- **Hardened boundaries.** Server resources, imported files, provider responses, persisted settings,
  geometry, names, URLs, and collection sizes are validated and bounded before entering UI state.

See the [changelog](CHANGELOG.md#v0150) for the full list.

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
  selects chart sources and opens source details; the Overlays tab controls visibility, opacity, and
  stacking for marks, routes, weather-adjacent data, and other map overlays.
  A 24 hour **track history** layer draws the server-recorded past day under the live track.
- **Offline charts:** with the optional Chart Locker plugin, draw and save the chart area needed for a
  passage, choose overview, coastal, or harbor detail, review the estimated download and available
  storage, and watch visible tile, byte, and error progress. Saved-area cards show coverage, included
  charts, detail, size, update date, and readiness, with actions to show the area on the chart,
  download it again, or reuse its settings for an adjusted copy. The same landing page manages
  automatic caching around the boat, installed chart names and file health, and storage. Without
  Chart Locker, the menu entry stays visible and explains how to add it.
- **Overlays:** free, key-free OpenSeaMap seamarks, marine protected areas, maritime boundaries, and
  NASA GIBS ocean conditions (sea-surface temperature and sea ice), each with its source attribution.
- **Marine radar:** an optional live radar picture from the Signal K Radar API, rendered over the chart
  with range rings, a heading line, strict night-red colors, confirmed transmit, immediate standby,
  direct overlay settings, and the tuning controls reported by the radar. Provider, stream,
  stale-data, access, and renderer failures remain distinct so an old picture is never presented as
  live. See [Marine radar](docs/marine-radar.md).
- **Routing:** draw and save routes as Signal K resources, or tap **Go to here** (long-press or
  right-click the chart) to navigate straight to a point. Follow a route with a nav strip (cross-track,
  distance, bearing, velocity made good, and time to go) over the v2 Course API, with an arrival alarm
  and extent-aware skip-waypoint controls. A plan speed turns the route into a **passage plan** with
  per-waypoint and whole-route arrival times. Routes **import and export as GPX** to move between
  Binnacle and other chartplotters and MFDs, and saving an active route refreshes the server's Course
  API without dropping the current route list during a transient read failure.
- **Profiles:** save named bundles of your settings (theme, which layers are on and their order, the
  weather layers, the collision thresholds, and the track and planning settings), switch between them
  in one tap, set a default, export and import them as files, and sync them across devices through the
  server when you are logged in. The panel identifies local-only, syncing, synced, and failed states.
- **Instruments:** tap the Instruments pill and the chart slides left for a gauge dock (SOG,
  heading, depth, apparent wind, and more from a curated catalog you pick and reorder); on a phone
  the tiles take the full screen, KIP-style. Values color by your server's configured meta.zones
  alarm bands, and selections ride profiles. Open KIP launches the installed KIP webapp; when KIP is
  absent, the item stays visible but unavailable and explains how to add it.
- **Weather:** a zoom-capped mini-map with animated WebGL wind, pressure isobars, waves,
  precipitation, cloud, and radar, plus time-aware point readouts, marine forecasts, source and age
  labels, deterministic risk cues, and official warnings when a Signal K weather provider supplies
  them. Open-Meteo provides the key-free fallback, including wind waves, swell, currents, and sea
  surface temperature, while cached forecasts remain available offline with explicit stale labeling.
- **Tides:** the nearest tide station's next high and low with a 48-hour curve and the nearest
  tidal-current station's next flood or ebb. NOAA CO-OPS covers US waters out of the box; the
  signalk-tides plugin extends coverage worldwide when the server runs it.
- **Lookout:** a collision watch with CPA and TCPA, chart-highlight rings, an audible alarm, and a
  published Signal K notification, plus a sortable **AIS target list** (by range, CPA, or name) with
  live range and bearing, tap-to-locate, and faded **target trails** from the tracks plugin. An
  **Alarms panel** collects every active alert on the boat (engine, autopilot, any plugin) with
  one-tap Silence and Acknowledge that propagate to every station.
- **Anchor watch:** drop the anchor at the boat, set the swing radius (or capture it from the live
  distance), and get a drag alarm that latches until acknowledged. It drives the
  signalk-anchoralarm-plugin when installed (so the alarm keeps running with the browser closed) and
  falls back to a fully in-browser watch when it is not, with a draggable drop-point marker on the
  chart.
- **Man overboard:** an always-visible MOB button in the top bar with a confirm pop-out. Confirming
  marks the spot, publishes the boat-wide Signal K alarm, and raises a recovery strip with live
  bearing, range, and elapsed time, plus an opt-in **Steer to MOB** handoff to the course system. An
  MOB raised by another station shows here too.
- **[Measure](docs/measure.md):** tap points on the chart for rhumb-line leg range, true bearing, and
  a running total. The active strip guides each next tap, Undo and Clear keep the tool active, and
  Done removes its temporary session-only points.
- **[Tracks](docs/tracks.md):** record, pause, save, show, and export segmented voyage tracks as
  GeoJSON. GPS gaps never become invented route legs. Save the latest continuous segment as a reusable
  route, or confirm a retrace to navigate home along it. The panel explains persistence, access,
  loading, and refresh failures instead of silently losing state. The active trail survives reloads in
  IndexedDB, while completed tracks live in Signal K resources and can be shared with other clients.
- **[Waypoints](docs/waypoints.md):** drop one from a long press, see it as a named marker, and locate,
  navigate to, rename, or delete it from the Waypoints panel. Loading and failures stay explicit,
  accepted writes survive refresh failures, and navigation requires confirmation. Marks live in the
  server's waypoint resources, so they interoperate with other Signal K clients.
- **Trends:** depth, apparent wind, barometric pressure, and speed over the last 24 hours as themed
  graphs from the server's v2 History API, or live session sampling without a history provider.
- **Find places and points of interest:** search the notes in the current chart view by name,
  category, or provider; sort them by name, category, distance, or true bearing; preview and select a
  result on the chart; and open its structured detail. Loading, zoom-limit, cached-offline, empty, and
  provider-error states remain distinct. Custom chart symbols are supported through the
  signalk-symbol-manager plugin. See [Find places](docs/find-places.md).
- **Your units:** every readout follows the server's imperial-or-metric unit preference; knots,
  nautical miles, and bearings stay nautical.
- **Themes:** day, dusk, and night-red, with true red on black for a dark-adapted watch.

See the [changelog](CHANGELOG.md) for the full list.

## Architecture

Binnacle is built on a current web stack and engineered to run on modest helm hardware:

- **Front end.** Svelte 5 with runes, Vite, and TypeScript, linted and formatted with Biome. The code
  is organized as cohesive, single-responsibility slices under a strict Feature-Sliced Design, with the
  import boundaries enforced by the build through a dependency-cruiser gate, a modular stylesheet
  assembled one concern per file, and shared UI primitives and helpers, so a new feature drops in
  against stable interfaces rather than by surgery on the core.
- **GPU rendering.** MapLibre GL JS draws the vector base map and chart layers on the GPU. The own
  vessel and every AIS target render as GPU symbol layers, and wind draws as a WebGL particle field
  advected through the forecast on the graphics card.
- **Off-main-thread real-time pipeline.** A dedicated Web Worker hosts the Signal K WebSocket client;
  deltas are coalesced into frame-rate batches on a worker timer and fed into a path-keyed reactive
  store, so a busy AIS anchorage updates the readouts without stalling the chart render, and data and
  alarms keep flowing while the tab is in the background.
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
- Node.js >= 22 (for building from source).
- A browser on the helm display, tablet, or phone.
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

**Optional marine radar.** Run or configure a provider that exposes the standard Signal K Radar API at
`/signalk/v2/api/vessels/self/radars`. Mayara is the reference provider. Binnacle discovers radars,
hydrates `/controls`, listens for `radars.*.controls.*` Signal K deltas, and opens the selected radar's
reported spoke stream. Read access is sufficient for the picture; transmit, standby, and tuning writes
require read-write approval. See [Marine radar setup and behavior](docs/marine-radar.md).

## Usage

Open Binnacle from the **Webapps** list in the Signal K admin UI, or go straight to
`http://your-sk-server:3000/signalk-binnacle/`. It opens on the chart, centered on your boat.

A few interactions cover most of the helm:

When installed as a PWA on a touch device, Binnacle automatically reserves bottom clearance for
Android navigation and tablet taskbars. The status strip also follows reported bottom and landscape
side safe areas, so its helm controls remain reachable when system chrome overlays the app window.

- **Open the context menu.** Long-press the chart on a touch screen, right-click with a mouse, or focus
  the chart and use the Context Menu key or Shift+F10. Drop a waypoint, choose **Go to here** to
  navigate straight to that point, or start a route or measurement.
- **Measure a chart leg.** Open **Measure**, tap a start and destination, then read the latest rhumb
  range, true bearing, and total in the strip. Use **Done** when finished.
- **Manage charts and overlays.** Open **Charts** to select chart sources or inspect their details.
  Switch to **Overlays** to toggle overlays, change opacity, and drag rows to reorder their stack.
- **Prepare offline charts.** Open **Offline charts**, choose **Save a chart area**, draw over the
  passage, review the included charts and detail, and start the download. Confirm the saved area's
  status and update date before relying on it away from coverage.
- **Switch themes.** Cycle the day, dusk, and night-red themes from the theme control. Night-red is
  pure red on true black for a dark-adapted watch.
- **Mark a man overboard.** Tap the always-visible **MOB** button in the top bar and confirm to mark
  the spot, raise the boat-wide alarm, and start the recovery strip.

For caching behavior, storage, and HTTPS requirements, see
[Offline charts, Chart Locker, and SSL](#offline-charts-chart-locker-and-ssl-optional) below.

For behavior, availability, recovery states, and safety rules for every menu action, see
[Menu items](docs/menu-items.md). Detailed guides also cover [Tracks](docs/tracks.md),
[Waypoints](docs/waypoints.md), [Find places](docs/find-places.md), [Measure](docs/measure.md), and
[Marine radar](docs/marine-radar.md). Offline preparation and administrator-session troubleshooting
are covered in [Offline charts](docs/offline-charts.md).

## Offline charts, Chart Locker, and SSL (optional)

Chart Locker is optional, but it is the recommended way to prepare a passage rather than depending
only on charts viewed previously in one browser. Install `signalk-chart-locker` from the Signal K App
Store, then open **Offline charts** in Binnacle. If the plugin cannot be reached, that menu item stays
visible but unavailable and explains whether to install, start, or sign in to Signal K as an
administrator. When administrator access is required, the header status opens that sign-in directly.
Return to Binnacle afterward; it retries Chart Locker automatically.

For the full setup, access, troubleshooting, download, and storage workflow, see
[Offline charts](docs/offline-charts.md).

The Offline charts landing page has four jobs:

1. **Saved areas.** Choose **Save a chart area**, draw a rectangle on the chart, review the smart
   default chart selection, pick Overview, Coastal, or Harbor detail, check the estimated download and
   free space, name it, and start the download. On a phone, the panel collapses while drawing so the
   chart owns the gesture. A saved-area card is ready only when it says **Saved, works offline**.
2. **Automatic caching.** Optionally keep selected charts cached around the moving boat. This is a
   rolling nearby cache, not a substitute for saving and verifying the full planned passage.
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

This project targets Node 22 or newer. Biome is installed with the development dependencies, and all
commands use the repository-local binary.

```bash
git clone https://github.com/NearlCrews/signalk-binnacle.git
cd signalk-binnacle
npm install        # install dependencies
npm run hooks      # install the git pre-commit and pre-push gates (run once)
npm run dev        # Vite dev server
npm run check      # type-check (svelte-check)
npm run lint       # Biome lint
npm run format     # Biome format (write)
npm run ci:biome   # format, lint, and import-order verification
npm run cruise     # dependency-cruiser boundary check
npm test           # Vitest unit tests
npm run build      # production build into public/
npm run test:e2e   # Chromium browser, mobile, keyboard, and accessibility checks
npm run test:e2e:cross-browser # Chromium and WebKit UI checks; CI runs this gate
```

After `npm run hooks`, git runs a fast format, lint, and boundary check before each commit, and the
full type-check, test, and build gate before each push. The hooks live in `.githooks/` and are opt-in
via `core.hooksPath`, never a package lifecycle script.

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

Apache-2.0. See [LICENSE](LICENSE) for the full text. The software is provided "AS IS", without
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
  bathymetry and protected areas; [GEBCO](https://www.gebco.net/) for global bathymetry;
  [Open Water Software](https://openwaters.io/charts/seascape) for Seascape, merging GEBCO, EMODnet,
  NOAA CUDEM, and other regional sources into worldwide depth shading, hillshade, contours, and
  soundings; [NASA EOSDIS GIBS](https://www.earthdata.nasa.gov/engage/gibs) for the ocean-conditions imagery;
  [OpenSeaMap](https://www.openseamap.org/) for the seamark overlay; and the
  [Flanders Marine Institute (VLIZ)](https://www.vliz.be/) Marine Regions service for the maritime
  boundaries.

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
- [Security issues](.github/SECURITY.md)
