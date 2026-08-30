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
- `PUT /signalk/v2/api/vessels/self/radars/{id}` writes one complete structured area through the
  standard bulk-control envelope.
- Signal K deltas at `radars.{radarId}.controls.{controlId}` reconcile live out-of-band changes for
  every discovered radar, not only the selected one, so switching radars seeds current values.
- `RadarInfo.streamUrl`, or the built-in per-radar stream fallback, carries protobuf spokes over a
  WebSocket.
- `GET /signalk/v2/api/vessels/self/radars/{id}/targets` returns the provider's tracked ARPA
  targets: id, status, a position (bearing and distance, plus latitude and longitude when the
  provider has own-ship navigation data), optional motion (course and speed), and an optional
  danger block carrying CPA in meters and TCPA in seconds. While the selected radar transmits,
  Binnacle polls this every five seconds and feeds georeferenced tracking targets into the same
  collision assessment AIS uses, labeled as radar contacts. A provider without target tracking
  answers with an error status and the poll stays dormant until the radar or provider changes.

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
generation prevents a late capability or control response for one radar from overwriting another. A
rediscovery that changes the selected radar's legend reapplies the echo color table.

The spoke worker opens only when all of these are true:

- the selected radar is transmitting;
- the radar overlay is visible;
- the browser document is visible; and
- the Signal K radar capability is available.

The worker integrates spokes in a bounded polar buffer and transfers a frame only after new spokes
arrive. If no spoke arrives for five seconds, Binnacle clears the echo and range rings and reports the
picture as stale. Reconnect attempts use bounded jitter, and an armed reconnect backoff is the single
reconnect authority: control deltas and other lifecycle syncs cannot preempt it, and they do not tear
down a silent but still open stream. A picture that stays stale past a bounded escalation window
forces the close a half-open socket never signals and hands the reopen to the backoff, so a dead
upstream with no close event cannot leave the echo dark until a manual toggle. Hiding the overlay, putting the radar in standby,
or backgrounding the page closes the stream and clears the cached picture. A standby or transmit
change reconciled from the controls poll or a Signal K delta resyncs the stream the same way:
standby closes it and clears the picture, and transmit reopens it. Providers spell the operational
control `power` or `status`; both drive the TX and standby state.

The chart renderer requires a fresh vessel position and heading. Spoke bearing supplies heading when
present; otherwise Binnacle falls back to a fresh `navigation.headingTrue`. A reconnect generation and
receipt-time check prevent pre-reconnect or timed-out center and heading values from positioning a new
picture. Without fresh inputs, it suppresses the echo instead of guessing north-up: a missing
own-vessel position reports the same blocked state as a stale one, and clearing the picture withdraws
an input-blocked report while GL context failures stay reported. Stream health and
WebGL renderer health are reported separately.

## Controls and units

Capabilities remain data-driven. Binnacle parses number, enum, boolean, string, button, compound,
sector, zone, and rectangle definitions, including categories, ordering, descriptions, read-only
state, automatic mode, enabled state, and live allowed state. Unknown compound controls stay readable
and read-only.

A structured radar area is editable only when the provider reports the object-keyed native dialect
with bounded geometry. Angular ranges must use radians, stay within the normal native radar domain,
and span no more than one revolution. This keeps malformed provider values out of chart placement and
puts a fixed upper bound on polygon tessellation. A supported definition includes:

- `dataType: "zone"` with angular bounds in radians and a positive bounded `maxDistance`;
- `dataType: "sector"` with angular bounds in radians;
- `dataType: "rect"` with meter bounds and a positive bounded `maxDistance`;
- `hasEnabled: true`; and
- every geometry field required by that shape.

Zone values contain `value`, `endValue`, `startDistance`, and `endDistance`. Sector values contain
`value` and `endValue`. Rectangle values contain `x1`, `y1`, `x2`, `y2`, and `width`. Rectangle
coordinates are local meter offsets from the radar, with positive x east and positive y north. The
first two points form an edge, and the positive width extends perpendicular to that edge. A fresh
Mayara stationary area can omit `enabled`; Binnacle seeds that complete native geometry as disabled.
A fresh zero rectangle opens as a draft, but validation blocks Save until it has distinct edge points
and a positive width.

The panel snapshots the accepted geometry when Edit starts. Form changes affect only that draft. Save
revalidates every field and sends one complete geometry update, while Cancel leaves the provider
unchanged. Start and end angles are not sorted because a valid zone can cross the capability boundary.
A provider update during editing preserves the draft, reports a conflict, and requires the navigator
to reload the current geometry before saving. Closing the panel, going Back, switching radars, or
opening overlay settings asks before discarding a dirty draft.

Enabled means the area is configured and active at the provider. It is not write permission and does
not mean a guard zone is alarming. Alarm styling and copy remain reserved for a provider-reported
notification. Live `allowed: false`, static read-only state, missing write access, and an in-flight
write all block Save independently. A no-transmit sector keeps its safety warning associated with
both angle fields and both Area enabled buttons for assistive technology. Saving it also requires a
separate confirmation because the change can alter the radar emission envelope.

The form is the complete keyboard-accessible workflow. **Edit on chart** is an optional, explicit
placement mode for a form draft:

- a sector uses taps for its start and end bearings;
- a zone uses taps for its inner start and outer end corners; and
- a rectangle uses two taps for one edge and a third tap for positive width.

If the second zone tap is closer to the radar than the first, Binnacle swaps the complete
angle-distance pairs. The closer tap remains the inner start corner, and the farther tap remains the
outer end corner. It never sorts distances independently from their tapped bearings.

Starting chart placement reveals the Radar overlay if it was hidden. The radar panel collapses while
placement is active, but its pinned footer keeps the current step and **Stop chart edit** visible on
phones. The form returns after the final tap or Stop. Losing the fresh own-vessel position or heading
between taps stops placement and reports the failed input instead of leaving an apparently stuck
editor.

Radar placement cannot start while Measure, route editing, or Offline charts owns chart gestures.
Those tools cannot start while radar placement owns them. Ordinary chart selection, tide station
selection, point-of-interest selection, cluster zoom, and context actions are suppressed for the same
interval. Accepted and draft areas render with different line and fill emphasis in day, dusk, and
night-red themes.

The echo, range rings, guard zones, and no-transmit sectors all use the same effective heading and
range from the current spoke frame. Navigation true heading and the discovered radar range are
fallbacks only when the frame does not supply those values, and the echo follows the live effective
heading on every repaint rather than only when a new frame arrives, so the picture cannot lag a turn
between frames. A live range change invalidates area
geometry with the echo, so a sector cannot remain shorter or longer than the displayed radar picture.

Radar API values remain SI in state and writes. Meters follow the server's metric or imperial display
preference, radians display as degrees, and seconds display as durations. Converted slider bounds and
steps return to SI when committed. A manual write to an automatic control explicitly sends `auto: false`.

Writes are optimistic and serialized per radar and control. If another value is queued while a request
is active, Binnacle coalesces unsent values to the newest snapshot so an older request cannot reach the
radar after the desired final value. Polling stays excluded for the full request lifetime, then observes
a short echo grace period. The panel shows pending state and rejected writes, restores the exact prior
scalar or geometry entry after the final write fails, and explains when read-write access is required.
A pending scalar write never disables its widget: the queue accepts the newer value, so rapid tuning
stays possible on a slow link, while structured area saves and the power control stay blocked during
their in-flight write.
Every write rechecks static read-only state and the live allowed flag at the controller boundary.
A scalar or record-shaped Signal K delta merges into the stored entry, because a delta carries only
what changed and a replace would clear the allowed, auto, or geometry fields; only a /controls
hydration replaces entries whole. The selected radar's deltas also write back into its discovery
entry, so switching away and back seeds live control state.
Dotted radar and control ids reconcile from Signal K deltas without being mistaken for nested
controls, and closing the radar controller stops its capability polling.

The Signal K single-control route and some providers each unwrap or wrap `body.value`, which can nest
a structured value and lose its required wire shape. Structured writes therefore use the standard
bulk-control Radar API route with one control map. The server passes that map to the provider's bulk
write unchanged, so all area fields arrive together. Binnacle does not call a Mayara-specific route.

## Night-red behavior

Every radar echo, Doppler accent, trail, sweep, ring, label, area fill, and area line has zero green
and blue in night-red. Special returns and radar areas remain distinguishable through red intensity,
alpha, line weight, and dash patterns, never through a blue or green pixel.

## Verification

Focused tests cover Radar API parsing, bounded geometry, relative and cross-origin URLs, token handling,
protobuf decoding, spoke integration, pending-frame state, buffer recycling, serialized control
writes, whole-entry rollback, control-delta merging, stream resync on reconciled power changes,
backoff-owned reconnects, live permission changes, provider removal, heading math, WebGL setup,
theme tables, range geometry, vector overlays, and synthetic radar frames. The Playwright smoke suite
verifies both the unavailable Radar menu path on a stock server and a provider-backed discovery,
control hydration, identity, status, transmit confirmation, guarded radar switching and menu
dismissal, direct overlay-settings transition from a collapsed disclosure, slider path, 320 px area
forms, no-transmit confirmation, and exact zone, sector, and rectangle bulk-control payloads. Focused
coverage also pins complete zone-tap pairing, bounded provider angles, capped tessellation,
frame-owned heading and range, pure-red area colors, delegated marker gating, stale-input failure
reporting, external editor cleanup, and persistent footer behavior while a phone panel body is
collapsed.

Native zone and stationary rectangle SI round trips were verified against the Mayara 3.7.0 built-in
emulator. The checks include fresh values with omitted enabled state, capability bounds, signed and
fractional rectangle coordinates, both zone angles and distances, and the returned enabled state. The
sector shape and sibling-field request are matched to Mayara 3.7.0's authoritative native capability,
server, and control UI contract. The generic Mayara emulator does not expose a no-transmit sector.
These are provider-emulator and provider-source evidence, not a claim that every radar model or actual
radar hardware has been tested.

For provider development, use the current Mayara emulator or a captured binary fixture and run:

```bash
npx vitest run src/features/marine-radar
npm run verify:browser
```
