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

## Navigate

- **Routes** loads Signal K route resources independently of the live WebSocket. Creating, editing,
  importing, reversing, deleting, activating, stopping, skipping, and chart-side route actions
  require write access. Route activation and chart-position navigation require confirmation. Failed
  refreshes keep the last accepted list, and route ids, names, geometry, and collection size are
  bounded before use.
- **Tracks** records a continuous local track and manages saved Signal K track resources. GPS gaps
  remain gaps, server mutations update the UI immediately, and route conversion uses only the latest
  continuous segment. Retrace requires confirmation. See [Tracks](tracks.md).
- **Waypoints** loads standard Signal K waypoint resources, supports chart drops, edits, deletes,
  location, and confirmed navigation. See [Waypoints](waypoints.md).
- **Find places** searches chart notes and points of interest, including cached offline results.
  Loading, zoom limits, hidden layers, empty results, offline cache, and provider failure remain
  distinct. See [Find places](find-places.md).
- **Measure** arms chart taps for distance and bearing. The active strip gives the next gesture, and
  selecting Measure again preserves current work. See [Measure](measure.md).
- **Layers and charts** opens to chart sources first. Signal K chart discovery can be retried without
  removing the last loaded sources. A broken source cannot stop the chart from opening. URL-backed
  PMTiles imports accept bounded HTTP or HTTPS URLs, validate metadata, persist locally, and sync to
  secured or unsecured Signal K servers when writes are available. Overlays remain in their own tab
  with visibility, opacity, management, and stacking controls.

## Safety

- **Nearby vessels (AIS)** lists up to 500 current targets by distance, CPA, or name. Stale or absent
  own GPS removes derived distance and bearing instead of showing frozen values. The panel labels a
  disconnected Signal K stream, shows collision severity, and exposes target identity, position,
  course, heading, speed, CPA, TCPA, navigation state, and reported ship type.
- **Radar** stays discoverable without a provider and explains what is missing. Controls report radar
  identity, control-write state, spoke-stream health, renderer health, and stale pictures. See
  [Marine radar](marine-radar.md).
- **Anchor watch** prefers the Signal K Anchor API and falls back to a browser-only watch. A fresh GPS
  fix is required to drop. Lost GPS makes browser drag detection visibly degraded, while a server
  watch remains active independently. Server-mode changes require write access; client-mode changes
  stay available. Conflicting actions are locked until completion.
- **Alarms** lists bounded, validated Signal K notifications by severity. Silence and acknowledge are
  locked while pending and require server write access. A disconnected stream is labeled because
  displayed alarm state may be stale. Collision and shallow-water settings stay in safe numeric
  bounds, in SI internally, with conversion only at display inputs.

## Weather

- **Forecast** opens a weather mini-map at the navigation chart view. Wind and waves start visible on
  a fresh install. Cached data is labeled with source and fetch time, stale data remains visible, and
  a manual Retry bypasses automatic backoff after a failed fetch. Conditions at the boat require a
  fresh GPS fix. Provider warnings state when warning data is unavailable or cached.
- **Tides** shows the nearest useful tide station, high and low events, a tide curve, and the nearest
  current station with distance, set, rate, and next flood, ebb, or slack. The signalk-tides plugin is
  preferred when available, with NOAA CO-OPS as the US-waters fallback. Cached readings survive a
  failed refresh, and Retry bypasses the automatic cooldown. Provider station and event payloads are
  validated and bounded.

## Instruments

- **Data trends** shows the last 24 hours when a history provider works and otherwise uses this
  session's recorder. History and chart-module failures have separate retry actions. Provider
  discovery in progress, query failure, and session-only operation are labeled separately.
- **Instruments** opens the live instrument dock. Customize can show, hide, and reorder tiles,
  including bounded discovered batteries, engines, tanks, solar controllers, and cabin sensors. An
  intentionally empty selection explains how to add a tile. Duplicate, invalid, and oversized saved
  selections are normalized.
- **Open KIP** opens the installed KIP webapp in a new tab. Transport or access failures keep its
  availability in the checking state instead of claiming KIP is absent. A blocked pop-up produces a
  visible message.
- **Time travel** replays the last 24 hours from an available history provider. Loading, no-provider,
  empty, and failed states are distinct. Retry handles thrown or failed history requests, Now moves
  the scrubber to the newest loaded sample without another network query, and range buttons disable
  at their endpoints.

## Offline charts

- **Offline charts** stays visible without Chart Locker and explains installation, startup, access,
  and chart-loading requirements. It manages saved areas, automatic caching, installed charts, and
  storage. See the Offline charts section in the [README](../README.md#offline-charts-chart-locker-and-ssl-optional).

## Settings

- **Profiles** saves portable chart, weather, alarm, toolbar, instrument, track, unit-fallback, and
  planning settings. Switching away from a dirty active profile requires confirmation. Imports are
  size-limited, deeply validated, bounded, and report the number saved. Profile names, ids, settings,
  timestamps, list sizes, and server documents are validated before merge. Without server write
  access, edits remain local, and delete confirmation warns that a server copy may remain.
