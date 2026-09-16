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
the current visible chart bounds. Opening Find places also turns on the Places overlay, which shows
the same Signal K notes, so a hidden layer cannot leave the list without its chart markers. The panel's
**Show places on chart** control reads and writes that same overlay state and restores a hidden layer directly. Panning
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

With a fresh GPS fix, the initial order is nearest first. Without a usable fix, including a fix that
is more than ten seconds old, predates the current connection, or is declared timed out by Signal K,
distance and bearing display as unavailable. Until the
navigator chooses a sort, Binnacle switches between nearest-first with a fresh fix and name-first
without one. An explicit sort choice is preserved if GPS availability changes. Bearings are marked
in degrees true, not magnetic.

Pointing at or focusing a row previews it with the chart ring. Selecting a row keeps it highlighted,
rings the marker, and opens the standard note detail panel without moving the chart. Closing Find
places or returning to the main menu clears its preview and selection. On a phone, opening note detail
replaces the list because both surfaces use the same bottom-sheet position. Its Back control returns to
Find places with the current results and selection intact.

At most 250 matching rows render at once. Search or zoom in to narrow a larger result set. The complete
accepted in-view set still participates in search and sort before this display limit is applied. The
panel states how many matches are shown when the display limit is reached. That is separate from the
5,000-note ingestion limit; neither number promises an exhaustive directory of every place nearby.
The search field has a clear control. While the field is focused, Escape clears its text before a
second Escape dismisses the panel.

## Place details and confidence

Opening a result reads its detail from Signal K. **Details checked** shows when Binnacle last received
the detail, including the date, time zone, and age. This is a retrieval time, not a survey date or proof
that a provider's measurements are current. Details are kept in a bounded session cache for five
minutes; reopening the same record within that interval does not reset its age.

**Refresh place details** requests a new copy. If the refresh fails, the last detail stays visible
with its original checked time and an explicit retained-information warning. **Retry place details**
tries again without treating the old content as newly fetched. A failure with no retained detail says
that the detail could not load. Switching to a different place cannot display the previous place's
detail as the new one.

Provider descriptions render as plain text. True and false flag values are distinct from missing or
malformed values, which display **Unknown**. A Dangerous flag becomes **Dangerous to navigation**,
**Provider does not mark this feature as dangerous**, or **Danger status unknown**. A false or absent
danger flag is not a claim that the place is safe. Check provider attribution, charts, notices, and
conditions before acting on these details. External source links open outside Binnacle and may share
request information with that website.

Selecting a result does not start navigation. **Show on chart** explicitly centers the place.
**Navigate here** requires a confirmation naming the destination before changing the shared Signal K
course. **Save as waypoint** opens an editor with the place's name and position. Navigation and saved
resource writes require appropriate Signal K access.

## Personal notes

Right-click the chart, press and hold it on a touch screen, or press the Context Menu key or Shift+F10
while the chart is focused, then choose **Add note here**. The editor accepts a name, plain text, a
point-of-interest category, an optional note symbol, and latitude and longitude. Names are limited to
120 characters, text to 4,000 characters, symbols to 256 characters, and coordinates to their valid
geographic ranges. Changing the coordinates moves an existing note.

Personal notes are standard Signal K `notes` resources written through
`/signalk/v2/api/resources/notes/{id}`. Binnacle marks its resources with the exact
`binnacle.signalk.org` schema-versioned ownership object. Edit and Delete appear only when that marker
is valid. Provider-created and third-party notes remain read-only even when their title, source, or
other fields resemble a Binnacle note.

The v2 resource route is the only write transport. A server that exposes only the v1 collection
continues to supply places but is labeled read-only. If no notes provider is available, the editor
explains how to enable Notes in Signal K's built-in Resources Provider. Read-only authorization offers
a direct read and write access request. A refused or failed save keeps the editor and all entered values
open; a refused or failed delete keeps the selected note and confirmation context intact.

Latitude and longitude controls keep invalid or partial input visible with an inline explanation
rather than silently moving the note. A pending save disables editing and duplicate submission, and
Escape cannot discard the pending editor. After a failed save, correct the input or access problem
and retry; canceling the editor is an explicit dismissal, not a durable draft save.

After Signal K accepts a create, edit, move, or delete, the chart and Find places apply that result
immediately. A bounded session-only bridge keeps the confirmed result through a slow or failed
collection refresh, including when the first refresh has no prior provider snapshot. Signal K remains
the source of record, and an exact successful provider response retires the local bridge. The bridge
is not a second note database and does not survive a reload.

## Provider and offline states

The panel distinguishes these states instead of presenting every empty list as the same condition:

- loading the current view;
- ready with results, or ready with a real empty response;
- below the chart zoom limit;
- hidden because the overlay was turned off;
- showing a cached result while offline; and
- provider or connection failure.

Successful validated note sets persist in IndexedDB and may be reused across reloads for up to seven
days. Malformed stored entries are discarded before they can reach the list or chart. While offline,
an already loaded set can remain available past its session-cache freshness window and is labeled
as cached because provider changes may be missing. This does not guarantee that an expired persisted
set survives a reload. With no usable cached set, the panel explains that none is available for this
view and does not issue a provider request. A cache failure does not prevent a live request, and
writing the cache does not delay rendering a successful live response.

A transient refresh failure keeps the last rendered results and labels them as such. Failed requests
retry after a cooldown and a subsequent chart sync. **Retry places** forces a new current-viewport
request when online, bypassing that cooldown and the cached result. While offline, reconnect first;
retry does not manufacture fresh data. Reconnecting requests the current viewport immediately instead
of waiting for a fresh-cache interval. A token change invalidates session caches and pending results.
This is not a substitute for erasing persisted browser data on a shared device: use the
[Profiles device privacy controls](profiles.md#device-privacy) before handing the device to someone
else.

## Implementation map

- `src/features/notes/notes-client.ts` validates and normalizes resource entries.
- `src/features/notes/notes-source.ts` owns viewport cache, persistence, single-flight loading, and
  retry cooldown.
- `src/features/notes/notes-detail.ts` owns validated detail loading and the session detail cache.
- `src/features/notes/NoteDetailPanel.svelte` owns detail freshness, retained-data recovery, and
  confirmed navigation.
- `src/features/notes/notes-overlay.ts` renders markers and reports the current viewport state.
- `src/features/notes/personal-note-contract.ts` owns field bounds and the strict ownership marker.
- `src/features/notes/personal-notes-client.ts` probes write capability and performs v2 mutations.
- `src/features/notes/personal-notes-controller.svelte.ts` owns editor, access, mutation, and
  confirmed-refresh behavior.
- `src/entities/poi/personal-notes-store.svelte.ts` holds the bounded session-only confirmed-write
  bridge.
- `src/features/poi-search/poi-search-rows.ts` owns search, distance, bearing, and stable sorting.
- `src/features/poi-search/PoiSearchPanel.svelte` owns the accessible list interaction and copy.

Focused tests cover parsing, unknown hazard flags, bounds, cache corruption and failure, provider and
connectivity changes, detail freshness and retry, token invalidation, ownership, v1 and v2 capability
states, mutation failures, accepted-write synchronization, search normalization, stable sorting, row
limits, and hover and selection wiring. The Playwright suite covers a provider-backed menu flow, a
layer initially saved as hidden, metadata search, the
direct visibility toggle, selection, personal-note create, edit, move, and delete, refresh failure,
the zoom-limit message, narrow-screen overflow, and phone detail navigation.
