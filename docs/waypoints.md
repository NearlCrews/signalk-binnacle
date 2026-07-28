# Waypoints

Waypoints are named positions stored in the Signal K server and drawn on the chart. They are shared
resources, not browser-only bookmarks, so other Signal K clients can read and update the same marks.
Any navigation started from a waypoint is advisory. Confirm the destination against current charts,
hazards, conditions, and direct observation.

## Quick use

1. Press and hold or right-click the chart, or focus it and use the Context Menu key or Shift+F10,
   then choose **Drop waypoint**.
2. Enter a name, choose the default marker, a built-in place icon, or a compatible custom symbol, then
   select **Save**.
3. Open **Menu**, then **Waypoints** to search, sort, locate, edit, or delete saved marks.
4. Select the navigation icon, review the named destination, then select **Start navigation**. The
   confirmation prevents a rolling-deck mis-tap from replacing an active course.
5. Select the waypoint name to move the chart to it without changing navigation. On a phone, this
   also minimizes the panel so the mark remains visible.

Adding, editing, deleting, and starting navigation require read/write access on a secured Signal K
server. The panel leaves local read actions available and explains when writes are blocked.

## Signal K resources

Reads try these collections in order:

1. `/signalk/v2/api/resources/waypoints`
2. `/signalk/v1/api/resources/waypoints`

The v1 path is a read-only compatibility fallback. Writes use the standard v2 resource path:

`PUT /signalk/v2/api/resources/waypoints/{id}`

Deletes use `DELETE` on the same resource URL. The body stores the name and optional description at
the resource top level, with a GeoJSON Point in `feature.geometry` and the symbol reference in
`feature.properties.skIcon`. Coordinates are `[longitude, latitude]` in GeoJSON and become
`{ latitude, longitude }` inside Binnacle.

Starting navigation references the saved mark instead of copying its position: the Course API
destination receives `{ "href": "/resources/waypoints/{id}" }`, with the id percent-encoded so any
resource id stays one path segment. The server resolves the resource and publishes the waypoint's name
with the course, so the destination reads by name in the navigation strip and on every other station.
If the server rejects the reference, Binnacle retries once with the position alone, which keeps
navigation available at the cost of the destination name.

## Loading and mutation behavior

Waypoint loading is independent of the live Signal K WebSocket. It begins when access resolves, so a
working HTTP resource API can populate the panel even when the vessel stream is unavailable. A stream
reconnect also refreshes the collection.

The panel distinguishes initial loading, refresh with retained rows, a real empty collection, and a
failed load. A refresh failure keeps the current marks on the chart and in the panel. Refreshes are
latest-result-wins, so an older response cannot overwrite newer data. A failed load or refresh offers
**Retry waypoints** in place and does not raise a repetitive startup toast.

Only one waypoint mutation runs at a time. The dialog and conflicting panel controls show or enter a
disabled state while a write is pending. A failed add or edit leaves the dialog open with its values,
so the navigator can retry without re-entering the mark. An accepted add, edit, or delete updates local
state before the follow-up collection refresh. A failed refresh therefore cannot hide a server-accepted
change.

Delete and navigation use separate inline confirmations. Delete names the destructive action.
Navigation names the exact waypoint and warns the navigator to check the destination before relying on
it.

## Finding a waypoint in the panel

The panel searches and sorts saved marks with the same list idioms as Find places, over the shared
`src/shared/nav/nav-rows.ts` core.

- Search covers the name and the description. Matching ignores case and accents, so a lowercase
  unaccented query still finds a capitalized or accented name. The search field and the sort control
  appear only once the locker holds at least one mark.
- Sort by **Name**, **Distance**, or **Bearing**. Selecting the current key reverses it, and a new key
  starts ascending. Equal values break by collated name and then by resource id, so rows never swap
  places between renders.
- Distance is rhumb distance and bearing is rhumb bearing in degrees true, the same leg the navigator
  steers. Both need a fresh vessel fix. Without one the two readouts show `--`, the list sorts by name,
  and the panel explains why.
- Until the navigator chooses a sort, the panel follows the fix: nearest first as soon as a fresh fix
  arrives, by name while it is absent or stale. An explicit choice is never overridden.
- At most 250 cards render at once. The panel reports how many matches are hidden and asks for a
  narrower search rather than rendering a full collection of action-bearing cards.
- When the collection arrives at the 5,000-waypoint ingestion limit, the panel says more marks may
  exist on the server, so a short list is never mistaken for the whole locker.

## Validation and limits

- Coordinates must be finite, with latitude from -90 through 90 and longitude from -180 through 180.
- Resource ids are trimmed, reject control characters, and are limited to 512 characters.
- Names are trimmed and limited to 256 characters. A missing provider name falls back to the resource
  id.
- Descriptions are limited to 10,000 characters, and icon references are limited to 256 characters.
- At most 5,000 valid waypoints are accepted from one collection response.
- Invalid resources are skipped without making the rest of the collection unavailable.

These are ingestion boundaries as well as UI limits. Provider-controlled text is bounded before it
reaches the panel, overlay, symbol resolver, or write path.

## Symbols

The default marker uses the `waypoint` role. Built-in place categories can be selected directly. When
the optional `signalk-symbol-manager` plugin supplies compatible waypoint symbols, the same picker also
offers those resources. Missing or removed custom symbols degrade to the default marker. Binnacle does
not require the plugin for standard waypoint behavior.

## Implementation and verification

- `src/entities/waypoint/waypoint-geojson.ts` owns resource validation and conversion.
- `src/entities/waypoint/waypoints-store.svelte.ts` owns reactive collection state and optimistic
  upsert and remove operations.
- `src/features/waypoints/waypoints-client.ts` owns v2 and v1 reads and v2 writes.
- `src/features/waypoints/waypoint-controller.svelte.ts` owns loading, dialogs, serialization, and
  refresh generations.
- `src/features/waypoints/waypoint-rows.ts` builds the searchable, sortable panel rows on the shared
  `src/shared/nav/nav-rows.ts` core.
- `src/features/waypoints/WaypointsPanel.svelte` and `WaypointDialog.svelte` own the helm interaction.
- `src/features/waypoints/waypoint-overlay.ts` renders the shared collection.

Unit coverage verifies resource conversion, validation limits, stale refresh rejection, retained
dialogs, serialized writes, optimistic state, load copy, access gating, search matching, sort order and
tie-breaking, and the render and ingestion cap notices. The Playwright flow covers HTTP-only loading,
narrow layout, and the navigation confirmation boundary.
