# Find places

Find places is the chart-synchronized list for Signal K notes and points of interest. It is available
from the Navigate group in the main menu. Navigation information from providers is advisory and should
be checked against current charts, notices, and direct observation.

## Data and viewport contract

Binnacle requests the merged Signal K notes resource at
`/signalk/v2/api/resources/notes?bbox=[west,south,east,north]`, with the v1 collection as a read-only
fallback. It does not select one provider. A stock server can return its own notes, and optional
providers can contribute marinas, anchorages, services, hazards, and other place records through the
same resource API.

The chart overlay fetches a padded area for efficient panning, but Find places clips those records to
the current visible chart bounds. Opening Find places also turns on the Points of interest overlay, so
the list and the chart markers cannot disagree because of a hidden layer. The panel's **Show places on
chart** control reads and writes that same overlay state and restores a hidden layer directly. Panning
or zooming refreshes the list. Below zoom level 9, the panel asks the navigator to zoom in before it
requests places. On a phone, minimize the panel to inspect or move the chart without closing the list.

Coordinates are accepted only when latitude is from -90 through 90 and longitude is from -180 through
180. Blank provider names fall back to the title and then the resource id. Resource ids and optional
name, source, attribution, icon, and URL strings reject control characters and have fixed length
limits. A viewport accepts at most 5,000 notes. Detail responses accept at most 32 sections and 100
items per section. Measures must be finite, ratings must be from zero through five, and detail links
open only when they use bounded HTTP or HTTPS URLs.

## Search, sort, and selection

Search matches the place name, category, source, and attribution. Matching ignores case and accents.
The list can sort by name, category, distance, or true bearing. Equal values use name and resource id
as stable tie-breakers, so a provider refresh does not randomly reorder rows.

With a fresh GPS fix, the initial order is nearest first. Without a fix, or when the last fix is more
than ten seconds old, the initial order is by name and distance and bearing display as unavailable. An
explicit sort choice is preserved if GPS availability changes.

Pointing at or focusing a row previews it with the chart ring. Selecting a row keeps it highlighted,
rings the marker, and opens the standard note detail panel without moving the chart. Closing Find
places or returning to the main menu clears its preview and selection. On a phone, opening note detail
replaces the list because both surfaces use the same bottom-sheet position. Its Back control returns to
Find places with the current results and selection intact.

At most 250 matching rows render at once. Search or zoom in to narrow a larger result set. The complete
in-view set still participates in search and sort before this display limit is applied.

## Provider and offline states

The panel distinguishes these states instead of presenting every empty list as the same condition:

- loading the current view;
- ready with results, or ready with a real empty response;
- below the chart zoom limit;
- hidden because the overlay was turned off;
- showing a cached result while offline; and
- provider or connection failure.

Successful validated note sets persist in IndexedDB and may be reused across reloads. Malformed stored
entries are discarded before they can reach the list or chart. While offline, an expired cached set
remains available and is labeled as cached because recent provider changes may be missing. With no
cached set, the panel says that no places are available offline and does not issue a provider request.
A cache read or write failure cannot delay or block a successful live response.

A transient refresh failure keeps the last rendered results and labels them as such. Failed requests
retry after a cooldown and a subsequent chart sync. Reconnecting requests the current viewport
immediately instead of waiting for a fresh-cache interval. A token change invalidates session cache and
pending results so data fetched under prior credentials cannot leak into the new access context.

## Implementation map

- `src/features/notes/notes-client.ts` validates and normalizes resource entries.
- `src/features/notes/notes-source.ts` owns viewport cache, persistence, single-flight loading, and
  retry cooldown.
- `src/features/notes/notes-overlay.ts` renders markers and reports the current viewport state.
- `src/features/poi-search/poi-search-rows.ts` owns search, distance, bearing, and stable sorting.
- `src/features/poi-search/PoiSearchPanel.svelte` owns the accessible list interaction and copy.

Focused tests cover parsing, bounds, cache corruption and failure, provider and connectivity changes,
token invalidation, search normalization, stable sorting, and hover and selection wiring. The
Playwright suite covers a provider-backed menu flow, a layer initially saved as hidden, metadata
search, the direct visibility toggle, selection, the zoom-limit message, narrow-screen overflow, and
phone detail navigation.
