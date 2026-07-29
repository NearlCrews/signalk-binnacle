# Marine radar

Binnacle can overlay a live marine radar picture on the chart and expose the controls reported by the
radar. Navigation output remains advisory. Verify the picture against the radar display and other
instruments, especially after a provider restart, network interruption, heading loss, or range change.

## Provider contract

Binnacle uses the Signal K v2 Radar API:

- `GET /signalk/v2/api/vessels/self/radars` discovers the current radars.
- `GET /signalk/v2/api/vessels/self/radars/{id}/capabilities` describes available controls.
- `GET /signalk/v2/api/vessels/self/radars/{id}/controls` hydrates their current values.
- `PUT /signalk/v2/api/vessels/self/radars/{id}/controls/{controlId}` writes a control.
- Signal K deltas at `radars.{radarId}.controls.{controlId}` reconcile live out-of-band changes.
- `RadarInfo.streamUrl`, or the built-in per-radar stream fallback, carries protobuf spokes over a
  WebSocket.

Mayara is the reference provider. Binnacle does not require Mayara specifically and does not implement
the older Radar SK transport. A stock Signal K server without a Radar API provider remains fully usable;
the Radar menu item stays visible and explains the missing capability.

Radar and control ids are bounded opaque provider strings. Punctuation, including dots, is preserved.
Control characters are rejected, and control keys named `__proto__`, `constructor`, or `prototype` are
not accepted.

## Setup

1. Run or configure a Radar API provider and confirm the discovery endpoint returns your radar.
2. Open Binnacle and approve read access in Signal K. Approve read-write access to change transmit,
   standby, range, gain, clutter, or other controls.
3. Open **Radar** from the Safety group. If several radars are present, select one.
4. Select **Transmit**, review the emission confirmation, and confirm only when it is safe to emit.
   **Standby** remains immediate so emission can stop without another confirmation.
5. Enable **Show echo on chart**, then select **Open overlay settings** to adjust opacity and stacking
   directly in the Overlays view.

On an HTTPS page, the spoke stream must use `wss:`. A browser will reject an insecure `ws:` stream as
mixed content. Relative stream URLs resolve against the Signal K origin. Authentication is appended only
to same-origin streams.

## Runtime behavior

Discovery distinguishes checking, available, absent, restricted, unreachable, and invalid provider
states. It refreshes after reconnects and token changes, and removes a radar that disappears. A selection
generation prevents a late capability or control response for one radar from overwriting another.

The spoke worker opens only when all of these are true:

- the selected radar is transmitting;
- the radar overlay is visible;
- the browser document is visible; and
- the Signal K radar capability is available.

The worker integrates spokes in a bounded polar buffer and transfers a frame only after new spokes
arrive. If no spoke arrives for five seconds, Binnacle clears the echo and range rings and reports the
picture as stale. Reconnect attempts use bounded jitter. Hiding the overlay, putting the radar in standby,
or backgrounding the page closes the stream and clears the cached picture.

The chart renderer requires a fresh vessel position and heading. Spoke bearing supplies heading when
present; otherwise Binnacle falls back to a fresh `navigation.headingTrue`. A reconnect generation and
receipt-time check prevent pre-reconnect or timed-out center and heading values from positioning a new
picture. Without fresh inputs, it suppresses the echo instead of guessing north-up. Stream health and
WebGL renderer health are reported separately.

## Controls and units

Capabilities remain data-driven. Binnacle parses number, enum, boolean, string, button, compound,
sector, zone, and rectangle definitions, including categories, ordering, descriptions, read-only state,
automatic mode, enabled state, and live allowed state. Unknown compound controls stay readable and
read-only. Rectangle values use the Radar API's `x1`, `y1`, `x2`, `y2`, and `width` fields.

A guard zone is editable only when the provider reports the object-keyed native `dataType: "zone"`
dialect with:

- angular bounds in radians;
- a positive bounded `maxDistance`;
- `hasEnabled: true`; and
- a complete live value containing `value`, `endValue`, `startDistance`, `endDistance`, and `enabled`.

The panel snapshots the accepted geometry when Edit starts. Form changes affect only that draft. Save
revalidates every field and sends one complete geometry update, while Cancel leaves the provider
unchanged. Start and end angles are not sorted because a valid zone can cross the capability boundary.
A provider update during editing preserves the draft, reports a conflict, and requires the navigator
to reload the current geometry before saving. Closing the panel, going Back, switching radars, or
opening overlay settings asks before discarding a dirty draft.

Enabled means the zone is configured and active at the provider. It is not write permission and does
not mean the zone is alarming. Alarm styling and copy remain reserved for a provider-reported
notification. Live `allowed: false`, static read-only state, missing write access, and an in-flight
write all block Save independently.

Sector editing remains read-only because a sector can describe a no-transmit area and therefore change
the radar's emission envelope. Rectangle and generic compound editors also remain unsupported until
their individual provider and hardware behavior is validated. The form is the complete accessible
workflow; Binnacle does not claim chart gesture ownership for radar geometry in this slice.

Radar API values remain SI in state and writes. Meters follow the server's metric or imperial display
preference, radians display as degrees, and seconds display as durations. Converted slider bounds and
steps return to SI when committed. A manual write to an automatic control explicitly sends `auto: false`.

Writes are optimistic and serialized per radar and control. If another value is queued while a request
is active, Binnacle coalesces unsent values to the newest snapshot so an older request cannot reach the
radar after the desired final value. Polling stays excluded for the full request lifetime, then observes
a short echo grace period. The panel shows pending state and rejected writes, restores the exact prior
scalar or geometry entry after the final write fails, and explains when read-write access is required.
Every write rechecks static read-only state and the live allowed flag at the controller boundary.
Dotted control ids reconcile from Signal K deltas without being mistaken for nested controls, and
closing the radar controller stops its capability polling.

The Signal K single-control route and some providers each unwrap or wrap `body.value`, which can nest
a structured value and lose its required wire shape. Structured writes therefore use the standard
bulk-control Radar API route with one control map. The server passes that map to the provider's bulk
write unchanged, so all zone fields arrive together. Binnacle does not call a Mayara-specific route.

## Night-red behavior

Every radar echo, Doppler accent, trail, sweep, ring, and label has zero green and blue in night-red.
Special returns remain distinguishable through red intensity and alpha, never through a blue or green
pixel.

## Verification

Focused tests cover Radar API parsing, bounded geometry, relative and cross-origin URLs, token handling,
protobuf decoding, spoke integration, pending-frame state, buffer recycling, serialized control
writes, whole-entry rollback, live permission changes, provider removal, heading math, WebGL setup,
theme tables, range geometry, vector overlays, and synthetic radar frames. The Playwright smoke suite
verifies both the unavailable Radar menu path on a stock server and a provider-backed discovery,
control hydration, identity, status, transmit confirmation, guarded radar switching and menu
dismissal, direct overlay-settings transition from a collapsed disclosure, slider path, 320 px
guard-zone form, and the exact atomic bulk-control payload.

The native guard-zone fixture and SI round trip were also verified against the Mayara 3.7.0 built-in
emulator. The provider-hop contract is covered separately using the Signal K bulk-control envelope
that Mayara forwards unchanged. These checks confirm the `zone` capability bounds and a
read-after-write value containing both angles, both distances, and enabled state. They are
provider-emulator evidence, not a claim that every radar model has been tested. Sector and rectangle
support still require their own hardware matrix.

For provider development, use the current Mayara emulator or a captured binary fixture and run:

```bash
npx vitest run src/features/marine-radar
npm run verify:browser
```
