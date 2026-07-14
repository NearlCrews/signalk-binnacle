# Offline charts

Offline charts lets a navigator save chart coverage before leaving internet access. Treat every saved
area as planning support, not as proof that a passage is safe. Before departure, verify the intended
area, included charts, completion state, and update date.

## Set up Chart Locker

1. Install `signalk-chart-locker` from the Signal K App Store.
2. Start the plugin.
3. Open Binnacle and choose **Offline charts**.

Binnacle keeps Offline charts visible when Chart Locker is absent or unavailable. The menu item
explains whether the plugin needs to be installed, started, or accessed through an administrator
session.

## Administrator access

Chart Locker protects its management API with Signal K's administrator session. This is separate from
Binnacle's ordinary device access request and its read/write token.

When the header says **Offline: admin sign-in**:

1. Select the status. Binnacle opens the Signal K administrator sign-in page.
2. Sign in as a Signal K administrator in the same browser profile.
3. Return to the Binnacle tab. Binnacle retries Chart Locker immediately.

The Signal K page and Binnacle must use the same origin, including protocol, hostname, and port. For
example, signing in at `http://boat.local:3000` does not provide a cookie to Binnacle opened at
`http://192.168.1.20:3000`. Private browsing profiles and separate browser profiles also keep their
cookies separate.

If **admin sign-in** remains after returning:

- Confirm the Signal K administrator page shows an authenticated session.
- Open Binnacle from that same Signal K server address instead of another hostname or IP address.
- Confirm Chart Locker is running, then select the status link and return again.
- Reload Binnacle after correcting the server address or browser profile.

Binnacle sends the browser's same-origin administrator session to Chart Locker management routes. It
does not attach the Binnacle device bearer token because that token can mask a valid administrator
cookie on secured servers.

## Save an area

1. Choose **Save a chart area**.
2. Draw a rectangle over the planned passage.
3. Review the included charts and choose Overview, Coastal, or Harbor detail.
4. Check the estimated download against available saved-area storage.
5. Name the area and start the download.
6. Wait for **Saved, works offline**, then verify coverage and the update date.

On a phone, the panel collapses while drawing so the chart receives the gesture.

## Automatic caching and storage

Automatic caching keeps selected charts near the moving boat. It is a rolling convenience cache, not
a substitute for a saved and verified passage area.

The Storage view separates saved-area, recently viewed, and automatic-caching use. Clearing recently
viewed charts does not delete saved areas.

## Status meanings

- **Cached amount:** Chart Locker is responding, and the header reports current cache use.
- **Admin sign-in:** Signal K administrator authentication is required for management operations.
- **Unavailable:** Chart Locker did not respond after repeated attempts.
- **Error:** Chart Locker returned a server failure.

The header reports service and cache state only. It never certifies that a particular passage is
complete.
