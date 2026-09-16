# Profiles and settings

Profiles are named helm setups. They let one navigator keep separate coastal, night, passage, and
anchor configurations without turning browser layout or active safety state into portable data.

## What saves automatically

After a profile is active, Binnacle saves changes to it after a short debounce. There is no separate
dirty, save, or discard step. Saving current settings as a new profile creates another named setup and
makes it active on that device.

Each saved-profile card keeps its device-selection action visible. Rename, set-default, export, and
delete actions live in the labeled three-dot menu. That menu flips above or below its trigger and
stays within the visible viewport on narrow displays and while the panel scrolls.

**Use profile** applies a setup to this device, and **Active here** identifies the current choice.
**Set as default** changes the shared starting choice for a device that has no active profile. It does
not switch displays already in use. Deleting a profile requires confirmation and, when sync is
available, propagates the deletion to other stations using the same Signal K account.

A profile contains:

- theme, automatic theme selection, display dimming, bright-sun chart palette, and text size;
- chart layers, visibility, opacity, and order;
- chart orientation (north-up, course-up, or heading-up);
- weather layers;
- collision and shallow-depth thresholds;
- track recording and display settings;
- planning speed;
- the local units fallback used when server unit preferences are unavailable;
- bottom-toolbar pins;
- instrument selection and order;
- Data trends selection and order, including an intentionally empty selection; and
- the preferred radius for the next anchor drop.

Stored settings remain in SI units. Conversion happens only at the display boundary.
The Signal K server's published unit preference takes precedence over the profile's local fallback.
The Units section explains which source is in use; the fallback selector is offered only when the
server does not publish a preference.

Applying a profile changes this display's local collision and shallow-depth settings. It does not
publish server depth zones or change the boat's alarm configuration. Sharing a shallow-depth limit
boat-wide is a separate, confirmed action in the alarm settings. Server depth zones still participate
in the local watch, so selecting a profile cannot silently weaken a deeper server limit.

The Data trends selection is independent from the instrument dock selection. New starter profiles
and legacy profiles without a stored trends selection resolve to Depth, Apparent wind, Barometer,
and Speed over ground in that order. A profile can deliberately save no trends. Saved dynamic
instrument IDs remain in the profile when their sensor is offline, so the selection returns when
the instrument is discovered again.

## What stays on this device

Each browser keeps its own active profile. Selecting a profile on a tablet does not switch the helm
display running in another browser. The chart center and zoom, instrument-dock open state, layer
category disclosure, panel layout, alarm volume, dismissed hints, and similar browser chrome also
stay local. A browser origin includes its protocol, hostname, and port; another address for the same
boat server has separate browser storage.

The synced default is used when a browser has no active profile. If synced profiles exist without a
default, Binnacle captures the browser's current settings as **Current setup** instead of applying an
arbitrary remote profile.

## What never enters a profile

Profiles do not contain:

- Signal K device tokens or administrator sessions;
- routes, tracks, waypoints, chart sources, Chart Locker areas, or radar provider configuration;
- an active MOB, anchor watch, route, navigation session, or measurement;
- alarm acknowledgements or mute state;
- the live radius or position of an active anchor watch;
- offline caches, history caches, imported file contents, or unfinished drafts; or
- the chart center, zoom, and browser panel state.

Server resources continue to use their Signal K APIs. Safety state keeps its own lifecycle and cannot
silently travel to another station.

## Cross-device synchronization

On a secured Signal K server, profiles sync through the authenticated user's applicationData store.
The active profile id is deliberately absent from the server document, while the default profile is
shared. This is account-scoped synchronization, not a boat-wide library shared automatically with
every Signal K user. Another station needs access to the same account's applicationData to receive
that library.

Binnacle journals changed fields, names, defaults, and deletions in browser storage. A failed or
offline server write remains queued across reloads when that storage is available. If the browser
refuses local storage, the running setup can continue in memory, but unsynced changes are not
guaranteed to survive a reload. Reconnect, window focus, and returning to a visible tab retry
synchronization.

The panel distinguishes local-only settings, waiting for a connection, active synchronization, and
successful synchronization. A refusal offers a read and write access request. Unreadable server data
or an unresolved merge offers **Retry profile sync** rather than claiming that the server copy was
saved.

The version 2 profile document has a revision number, profile records keyed by id, deletion
tombstones, and logical clocks for individual settings. A write tests the current revision before
applying its field-level patch. On a conflict, Binnacle reloads, merges, and retries a bounded number
of times. Edits to different settings are preserved instead of allowing the last full-document write
to replace everything. Equal clocks without a pending local edit resolve to the server copy, so two
stations converge instead of repeatedly restoring their own stale value.

Concurrent-writer protection also depends on the server applying its read, revision test, and write
as one serialized operation. Keep Signal K current when multiple stations edit profiles. Binnacle
does not use a server-version number to decide whether to sync; it uses the actual API responses.
Profiles still save locally when applicationData is unavailable, the server is unsecured, or write
access has not been granted.

## Import, export, and capacity

**Export profile** downloads a JSON file containing the named setup, not device credentials, active
safety state, or server resources. Treat exported settings and names as information about the vessel's
setup, and review a file before sharing it. **Import** validates the file and creates new profile ids
so it does not overwrite existing profiles. Importing does not activate the imported setup. Invalid
or unusable files show an error; a successful import reports how many profiles were added.

The library accepts up to 1,000 profiles. At that limit, **Save current as profile** is disabled with
an explanation. An import can add only as many profiles as remain available. If synchronization would
combine more than 1,000 profiles, the panel reports a capacity conflict and asks for a deletion before
retrying; it does not report a completed sync.

## Startup and remote changes

Startup waits for the authentication decision and attempts server hydration before creating starter
profiles. The selection order is:

1. the active profile already chosen by this browser;
2. the synced default;
3. starter profiles on a completely empty account; or
4. a new **Current setup** capture when profiles exist but no default is available.

If a later sync changes the profile currently in use, Binnacle updates the saved profile record but
does not immediately alter the live chart. The last-applied setup is stored separately on that
browser, so a reload does not silently accept or revert the update. The Profiles panel offers **Apply
update** and **Keep current setup** so the navigator chooses which version becomes shared.

An existing local profile activates immediately. On an empty browser, startup waits for the
authentication and hydration attempt before creating starters. Network requests are bounded, and an
offline or still-pending access request falls back to a provisional **Current setup** after one
network window so autosave remains available. If it remains untouched, a later successful sync
replaces it with the synchronized default. If the navigator changes it first, Binnacle preserves it
as a real local profile.

## Migration and validation

The version 1 applicationData document remains read-only during migration. Binnacle validates it,
writes an initialized version 2 document, and leaves the old data available for rollback. A nonempty
malformed version 2 document is never replaced automatically.

Profile names, ids, settings, extension depth and size, collection sizes, logical clocks, pending
journals, response size, and server documents are bounded and validated before use. Bounded unknown
extension fields and their clocks are preserved during updates so a newer client can add a setting
without an older client deleting it. Legacy layer-disclosure and arrival-mute fields are removed
during ingestion because device chrome and safety mute state are not portable.

## Device privacy

**Forget credentials** removes Binnacle's Signal K device token from the current browser. It does not
revoke that device authorization on the server or sign out an administrator session.
**Erase all local data** removes Binnacle-owned settings, local profile cache and pending journal,
offline databases, caches, service worker, and credentials after the safety checks pass.

Neither action deletes server profiles or other Signal K resources. Synced profiles return after the
browser signs in and syncs again. Profiles and edits that have not synced are permanently lost during
local erasure. Profile persistence is suspended before erasure so a queued autosave or in-flight
server acknowledgement cannot recreate the cleared browser record.

Both actions require confirmation. Erasure can be blocked while safety-critical or unsaved work is
active, including another Binnacle tab when the browser supports the coordination check. A partial
failure names the storage that could not be cleared; it is not reported as a complete erase. Data and
sign-in state owned by other Signal K webapps are outside Binnacle's erase inventory.

These actions are not a network privacy switch. External chart, weather, and tide requests can
disclose the requested area, and automatic weather-warning checks can send the vessel position even
with Weather closed. **Review network privacy** opens the explanation in Help. Closing a
panel or removing local data does not disable the server's plugins or their external requests.

## Adding a setting

Classify a new production localStorage key in
`src/shared/persistence/storage-keys.ts`. A portable setting also needs:

1. a field in `ProfileSettings`;
2. bounded validation;
3. an entry in the profile binding table;
4. inclusion in the portable setting-key list and field timestamp merge; and
5. capture, apply, migration, offline, and conflict tests.

Device, server-resource, safety, credential, cache, and draft values must remain outside the profile
binding table.

The local profile library and mutation journal use the profile-scoped `binnacle:profiles` record.
Device-local active selection and last-applied settings use the separate device-scoped
`binnacle:profile-device` record.
