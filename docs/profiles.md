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

A profile contains:

- theme;
- chart layers, visibility, opacity, and order;
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

The Data trends selection is independent from the instrument dock selection. New starter profiles
and legacy profiles without a stored trends selection resolve to Depth, Apparent wind, Barometer,
and Speed over ground in that order. A profile can deliberately save no trends. Saved dynamic
instrument IDs remain in the profile when their sensor is offline, so the selection returns when
the instrument is discovered again.

## What stays on this device

Each browser keeps its own active profile. Selecting a profile on a tablet does not switch the helm
display running in another browser. The chart center and zoom, instrument-dock open state, layer
category disclosure, panel layout, dismissed hints, and similar browser chrome also stay local.

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
shared.

Binnacle keeps a durable local journal of changed fields, names, defaults, and deletions. A failed or
offline write remains queued across reloads. Reconnect, window focus, and returning to a visible tab
retry synchronization.

The version 2 profile document has a revision number, profile records keyed by id, deletion
tombstones, and logical clocks for individual settings. A write tests the current revision before
applying its field-level patch. On a conflict, Binnacle reloads, merges, and retries a bounded number
of times. Edits to different settings are preserved instead of allowing the last full-document write
to replace everything. Equal clocks without a pending local edit resolve to the server copy, so two
stations converge instead of repeatedly restoring their own stale value.

Signal K server 2.23.0 and later serialize applicationData writes per file, which provides the
strongest concurrent-writer protection for revision tests. Profiles still save locally when the
server is older, unavailable, unsecured, or has not granted write access.

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

**Forget credentials** removes Binnacle's Signal K device token from the current browser.
**Erase all local data** removes Binnacle-owned settings, local profile cache and pending journal,
offline databases, caches, service worker, and credentials after the safety checks pass.

Neither action deletes server profiles or other Signal K resources. Synced profiles return after the
browser signs in and syncs again. Profiles and edits that have not synced are permanently lost during
local erasure. Profile persistence is suspended before erasure so a queued autosave or in-flight
server acknowledgement cannot recreate the cleared browser record.

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
