# Deferred catalog sources, 2026-08-02

`signalk-chart-sources` 0.7.0 added twenty sources. Eleven were surfaced in the Layers panel at the
upgrade, and nine were deliberately left out. This records which nine, why each was held, and what
each one needs before it ships, so the decision does not have to be rediscovered from the catalog
diff.

None of these is blocked on the catalog. Every one is available today and correct upstream; what is
missing is Binnacle-side design.

## Held: the seven time-dynamic weather and ocean rasters

| Source | Refreshes every |
| --- | --- |
| `weather-radar-conus` | 5 minutes |
| `weather-radar-alaska` | 5 minutes |
| `weather-radar-hawaii` | 5 minutes |
| `weather-radar-caribbean` | 5 minutes |
| `weather-alerts-us` | 5 minutes |
| `weather-tropical` | 1 hour |
| `ocean-sst-global` | 6 hours |

**Why held.** Each carries `maxAgeSeconds`, which is the catalog stating outright that a fetched tile
expires. Adding them the way every other overlay is added would paint a raster once and leave it on
the chart indefinitely, so a navigator would be reading radar from an hour ago with nothing on screen
saying so. That is worse than not showing radar at all, and it is worse specifically on the surface
where being wrong matters most. The existing weather feature is a separate concern: it reads
Open-Meteo and Signal K point forecasts, not catalog raster tiles, so there is no refresh machinery
here to reuse.

**What each needs before it ships.**

1. A refresh loop keyed on `maxAgeSeconds` per source, not one shared interval. Five minutes and six
   hours are not the same problem, and re-fetching a six-hour product every five minutes wastes the
   boat's connection.
2. A visible age, and an explicit stale state when a refresh fails. The design system's precedent is
   the accepted-data contract: keep the last good frame, say how old it is, and never silently
   present it as current. The Forecast and Tides panels are the reference.
3. A decision on what happens offline, where these can never be current. Most likely they hide
   rather than show a frozen frame, which is the opposite of how the static overlays behave.
4. Confirmation that the companion cache passes them through without storing them. They are already
   excluded from pre-warm by `isVolatile` in `features/prewarm/estimate.ts`; rendering is a
   different path and has not been checked against Chart Locker.
5. A service-worker route keyed on `maxAgeSeconds`, not the shared overlay cache. All seven sit on
   `nowcoast.noaa.gov`, a host `isOverlayTile` in `sw-caching.ts` already matches, so today they
   would land in `binnacle-overlay-tiles` and its seven-day expiry. A seven-day runtime cache on a
   five-minute product is the same staleness this section exists to prevent, arriving through the
   browser rather than through pre-warm. The catalog states the real budget outright, so route from
   it rather than adding a second copy of the number.

Until all five exist, these stay out of the panel. The pre-warm exclusion is already in place and
tested, so nothing can accidentally download them for later in the meantime.

## Held: `basemap-dark`

**Why held.** A base map is not an overlay, and this one is a theme decision rather than a layer
toggle. Binnacle already has three themes (day, dusk, and night-red) whose whole point is that
night-red is pure red on true black with no blue at all. Adding a dark base map as a fourth
independent choice would let a navigator select a dark base under the day theme, or a light base
under night-red, which defeats the rule the themes exist to enforce.

**What it needs before it ships.** A decision on whether the base map follows the theme
automatically (dusk and night-red select it, day does not) or becomes a per-theme preference. The
first is more consistent with the design system and needs no new control; it also needs a check that
the dark style's own colors do not reintroduce blue at night, which is the constraint that matters.

## Held: `traffic-vessel-density`

**Why held.** It is a monthly-averaged historical density surface, not live traffic. Binnacle already
renders live AIS, so the panel would offer two things that look like traffic and mean different
things, one of them a year-scale average. The value is in passage planning rather than navigation,
which is a different surface from the Layers panel.

**What it needs before it ships.** A place where historical, planning-scale data belongs, and copy
that distinguishes it from live AIS at a glance. Worth revisiting if a passage-planning surface is
ever built; not worth a Layers row before then.

## What was surfaced instead

For the record, the eleven that did ship at the upgrade: GEBCO in flat color and measured-soundings
only, EMODnet depth contours, the 24 nm contiguous zone, the high seas, the IHO sea areas, UNESCO
marine sites, and the four seabed-infrastructure layers (power cables, telecom cables, pipelines, and
wind farms). All are static, so none of them raises the staleness question above.
