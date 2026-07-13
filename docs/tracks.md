# Tracks

The Tracks menu records the vessel's breadcrumb trail, keeps the active recording across reloads,
saves completed tracks to Signal K resources, and can derive a route from the latest continuous
segment. Track output is advisory. Review any derived route against the chart, hazards, conditions,
and the vessel's capabilities before navigating it.

## Quick use

1. Open **Menu**, then **Tracks**. Recording is already active when a fresh vessel position is
   available.
2. Use **Pause** before a period that should not be part of the trail. **Resume** starts the next kept
   point as a new segment.
3. Review the point count, distance, elapsed duration, average speed, and top speed. Choose **Speed**
   or **One color** for the active line.
4. Select **Save**, name the track, and wait for the server write. The accepted prefix moves to Saved
   tracks. Any fixes captured during the request stay in the active recording.
5. Use the eye control to show or hide a saved track. Download exports that saved track as GeoJSON.
6. Use **Discard** only to clear the active recording. It does not delete a saved server resource.

On a secured Signal K server, Save, Save as route, Retrace track, and Delete require read/write access.
The panel explains when the current grant is read-only.

## Recording

- Recording begins automatically when Signal K supplies a fresh, valid `navigation.position`.
- Points are stored in SI with latitude, longitude, Unix time in milliseconds, and speed over ground
  in meters per second.
- The default thinning policy records after 10 seconds and 10 meters of movement. Stored profile
  settings are accepted only within 1 to 3,600 seconds and 1 to 10,000 meters.
- Stale, malformed, out-of-order, and out-of-range fixes are ignored. Negative speed is normalized to
  zero.
- A pause, a fix outage longer than five minutes, or an implausible GPS jump starts a new segment. No
  distance or chart line crosses that gap.
- IndexedDB is the active-track store. If it is unavailable or fails, recording continues in memory,
  and the panel warns that the current track will not survive a reload.

Duration is elapsed time from the first kept point to the latest kept point, including time between
segments. Distance and average speed never include a direct leg across a segment gap. Top speed is the
highest valid recorded speed. Displayed distance and speed use nautical miles and knots, while stored
values remain SI.

## Panel behavior

The panel separates current recording state from saved-resource state. It reports loading, refresh
failure with retained data, true empty results, memory-only persistence, missing write access, and
pending mutations explicitly. Save, delete, route conversion, and retrace are disabled while their
required write access or operation capacity is unavailable.

Discard and delete require inline confirmation. Retrace also requires confirmation because it creates,
saves, activates, and reverses a route. Visibility toggles and GeoJSON export remain local read actions.

Saved-track visibility is session UI state. It does not modify the server resource and is not synced to
another display. Saved records themselves are server resources and appear on other clients that read the
same Signal K collection.

## Saved tracks

Save writes a GeoJSON `MultiLineString` Feature to:

`/signalk/v2/api/resources/tracks/{id}`

The Feature properties include the name, `source: "binnacle"`, distance in meters, and timespan in
seconds. Successful writes update the panel and overlay immediately before the follow-up server refresh.
A failed refresh therefore does not hide a track that the server already accepted. Fixes captured while
the save request is in flight remain in a new active recording. Reads try the v2 collection first and
fall back to the v1 collection for compatibility.

Incoming resources are bounded to 500 tracks and 100,000 valid points per track. Blank names fall back
to the resource id, negative metadata is ignored, and malformed geometry is dropped. Downloads use
portable, bounded `.geojson` filenames.

The server resource preserves segment geometry, the track name, source, distance, and timespan. The
download preserves the geometry, name, and source. Neither form preserves every point timestamp or
speed sample. Use the GeoJSON as a portable trail, not as a raw navigation-data archive.

### Data lifecycle

| Action | Active browser recording | Signal K resource |
| --- | --- | --- |
| Pause | Kept, with the next recorded point starting a segment | No change |
| Discard | Cleared after confirmation | No change |
| Save | Accepted prefix removed; newer in-flight fixes remain | New track written |
| Show or hide | No change | No change |
| Download | No change | Read only |
| Delete | No change | Track removed after confirmation |

## Route conversion and retrace

GPS gaps are hard navigation boundaries. Save as route and Retrace track use only the latest continuous
segment and require at least two connected points. Earlier segments remain in the saved track but never
become a straight route leg across missing GPS history. The segment is simplified to route turning
points before it is saved. Retrace reverses those waypoints and starts Signal K course navigation only
after confirmation.

If the latest segment has fewer than two points, route actions stay disabled even when an earlier
segment is drawable. Record another connected point, or use the earlier trail only as a saved track.

## Failure and recovery states

- **Loading saved tracks:** the HTTP resource read is still pending. It does not depend on the live
  Signal K WebSocket.
- **Could not refresh:** previously loaded or newly saved tracks remain visible. Restore server
  connectivity, then select **Retry saved tracks**.
- **Saved tracks unavailable:** neither the v2 nor v1 collection produced a usable response. A 404 on
  both collections is treated as a reachable server with no saved tracks.
- **Track storage is memory-only:** IndexedDB is unavailable or failed. Save the current trail to the
  server before reloading or closing the tab.
- **Write token needed:** approve Binnacle for read/write access in Signal K. Read-only actions, such as
  visibility and download, remain available.
- **Route action disabled:** the latest continuous segment needs at least two points, another track or
  route mutation is pending, or write access is unavailable.
- **Recording has no new points:** confirm that `navigation.position` is present and fresh. Stale or
  malformed fixes are deliberately ignored.

## Architecture

- `src/entities/track/recorder.svelte.ts`: fix validation, thinning, gap detection, statistics, and
  ordered persistence.
- `src/shared/storage/track-store.ts`: IndexedDB log and observable in-memory degradation.
- `src/features/tracks/`: panel, saved-resource controller, Signal K client, and GeoJSON export.
- `src/features/track-layer/`: active and saved overlays, simplification, and gap-safe route conversion.
- `src/app/App.svelte`: service construction, fresh-fix feed, and auth-triggered resource refresh.

The saved-track controller uses latest-result-wins refreshes and one mutation at a time. Successful
writes update local state before reloading the collection, so a slow or failed follow-up read cannot
erase an accepted save. The recorder serializes local appends, clears, and prefix rewrites to prevent
IndexedDB completion order from resurrecting discarded points or dropping a post-save tail.

## Verification

Run `npm run lint`, `npm run cruise`, `npm run check`, `npm test`, `npm run build`, and
`npm run test:e2e`. Unit coverage includes recorder corruption and races, persistence degradation,
resource parsing, optimistic controller state, portable export names, panel states, and gap-safe route
conversion. The browser test covers saved-resource loading without a live stream and narrow-screen
panel layout.
