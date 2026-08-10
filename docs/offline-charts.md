# Offline charts

Offline charts lets a navigator save chart coverage before leaving internet access. Treat every saved
area as planning support, not as proof that a passage is safe. Before departure, verify the intended
area, included charts, completion state, and update date.

## Set up Chart Locker

1. Install `signalk-chart-locker` from the Signal K App Store.
2. Start the plugin.
3. Open Binnacle and choose **Offline charts**.

Binnacle keeps Offline charts visible when Chart Locker is absent or unavailable. The menu item
distinguishes a missing plugin, refused access, and an unreachable service so it can explain whether
Chart Locker needs to be installed, started, or accessed through an administrator session.

## Administrator access

Chart Locker protects its management API with Signal K's administrator session. This is separate from
Binnacle's ordinary device access request and its read/write token.

When the header says **Charts: sign in**:

1. Select the status. Binnacle opens the Signal K administrator sign-in page in the current window.
2. Sign in as a Signal K administrator.
3. Signal K redirects back to the current Binnacle route, which retries Chart Locker.

Keeping login in the same window is important for installed PWA sessions. The Signal K page and
Binnacle must also use the same origin, including protocol, hostname, and port. For example, signing
in at `http://boat.local:3000` does not provide a cookie to Binnacle opened at
`http://192.168.1.20:3000`.

The access states mean different things:

- **Sign in:** Signal K reports that this browser session is signed out.
- **Admin needed:** Signal K reports a signed-in user without administrator rights.
- **Access error:** Signal K reports an administrator session, but Chart Locker refused the request.
  Select the status or the panel action to retry. If it persists, restart Chart Locker and confirm
  that the installed version registers its chart read routes with Signal K's `readonly` access scope.
- **Unavailable:** Chart Locker did not respond after repeated attempts.
- **Error:** Chart Locker returned a server failure or malformed status data.

Binnacle checks `/skServer/loginStatus` before choosing an access message. It sends the browser's
administrator session to Chart Locker management routes with credentials included and does not attach
the Binnacle device bearer token because that token can mask a valid administrator cookie on secured
servers. The lightweight installation probe uses the same administrator session and never attaches
the Binnacle device bearer token unless that read-only request receives 401 or 403. In that case it
retries only the readiness route with the device token. Management routes remain administrator-session
only. A not-ready response still identifies Chart Locker as installed, while the status remains
explicit about service readiness.

Browser PMTiles reads are accepted only when the server honors the requested byte range and returns a
matching `Content-Range` and body length. A short response is accepted only at the declared end of the
archive. A strong ETag, or a `Last-Modified` value paired with the declared archive size, also verifies
that cached blocks belong to the same archive version. When a successful header read has no validator,
Binnacle purges older blocks before storing the fresh header so bytes from different archive versions
cannot be mixed. Failed, rejected, retried, and superseded PMTiles reads cancel their response streams,
and query values are redacted from status and error text. The service worker does not cache Signal K
API responses or PMTiles range responses; PMTiles blocks use their dedicated IndexedDB store.

## Save an area

1. Choose **Save a chart area**.
2. Draw a rectangle over the planned passage.
3. Review the included charts and choose Overview, Coastal, or Harbor detail.
4. Check the estimated download against available saved-area storage.
5. Name the area and start the download.
6. Wait for **Saved, works offline**, then verify coverage and the update date.

On a phone, the panel collapses while drawing so the chart receives the gesture. Finishing a draw
without dragging selects nothing rather than covering the whole world, which is what a zero-area
rectangle used to mean.

Step 3 lists the charts that actually cover the drawn area, with the specialist layers grouped last
under **Advanced layers**: the coarse worldwide bathymetry, the second US depth layer, and the
jurisdiction, protected-area, and seabed-infrastructure sets. Weather and ocean overlays are never
offered here. They expire in minutes to hours, so storing them for a passage would spend the area's
byte budget on tiles that are wrong before anyone reads them.

If Chart Locker accepts a download but loses the immediate job response, Binnacle keeps the area in
**Starting download** while Chart Locker recovers the job by area identifier. A temporary status
failure does not start a second download. Use **Retry status** on the saved-area card to resume
polling.

Chart Locker can retain a saved definition after one of its chart sources is removed. Binnacle marks
that source unavailable and preserves any already cached coverage. **Download again** stays disabled
because it would repeat a request Chart Locker cannot fulfill. Use **Adjust a copy** to choose current
charts, save the replacement, verify it, then delete the older area.

## Automatic caching and storage

Automatic caching keeps selected charts near the moving boat. It is a rolling convenience cache, not
a substitute for a saved and verified passage area.

Binnacle validates and clamps settings to Chart Locker's current management contract: up to 64 chart
sources, zoom levels from 0 through 24, a nearby-cache radius and movement threshold up to 100 km,
and an update interval from 60 seconds through 24 hours. Stored values remain in meters and seconds;
the panel converts distance only at the display boundary.

The Storage view separates saved-area, recently viewed, and automatic-caching use. Clearing recently
viewed charts does not delete saved areas. Setting changes show saving and saved feedback. If a save
fails, the panel keeps the latest choice visible and offers Retry. Rapid changes are serialized so an
older response cannot replace the newest setting.

## HTTPS and the browser cache

Binnacle caches in two independent layers, and only one of them depends on how the browser reaches
the server.

Chart Locker's saved areas and automatic caching run on the Signal K server. They work over the
boat's ordinary Signal K connection, so they never require HTTPS. Inside the browser, the PMTiles
blocks, the weather forecast, tides, chart notes, and vessel conditions are stored in IndexedDB,
which is not secure-context gated either. Over plain HTTP a reload still replays the last data, and
previously viewed PMTiles charts still render offline.

The second layer is the service worker, which caches ordinary byte assets: the base map, tiles
served by a plugin, and the streaming overlays. Browsers expose the service worker and cache-storage
APIs only in a secure context, meaning HTTPS or `http://localhost`. The Signal K server serves
Binnacle over plain HTTP on the local network by default, so that layer stays inert there and every
live function degrades cleanly to online-only. The Offline charts landing page says so directly when
the page was loaded over plain HTTP, and it likewise shows a notice when the browser rejected the
server certificate, since both conditions leave the browser cache off.

There are two good ways to add HTTPS to Signal K:

- The [signalk-ssl](https://www.npmjs.com/package/signalk-ssl) plugin
  ([source](https://github.com/dirkwa/signalk-ssl)), which generates a local certificate authority,
  issues the server certificate, and distributes the root to your devices by QR code. The Signal K
  server's built-in SSL settings (Server, then Settings, then SSL) are a bare-bones alternative.
- [Tailscale](https://tailscale.com), which adds remote access and publicly trusted certificates,
  with no trust-store step at all. See
  [Accessing Signal K remotely with Tailscale](https://gist.github.com/NearlCrews/3f7af717fec853a80e7de1063940382e)
  for a quick start.

HTTPS alone is not enough: the browser must also **trust** the certificate. A self-signed
certificate, including one the signalk-ssl plugin generates, is not trusted by default, and browsers
refuse to register a service worker from an origin whose certificate they do not trust even after
the certificate warning is clicked through. The symptom is a page that loads normally while offline
caching never activates: the Offline charts landing page shows a certificate notice, and the console
logs an informational line saying offline caching is off because the browser does not trust the
server certificate. The fix is environmental, not a Binnacle setting: install the
certificate authority's root, the QR code or `.pem` file the plugin provides, into the browser or
operating system trust store, mark it trusted, then reload over HTTPS. The service worker then
registers, and the base map and chart tiles cache for offline use.

## Status meanings

- **Cached amount:** Chart Locker is responding, and the header reports current cache use.
- **Sign in:** The browser is signed out of Signal K.
- **Admin needed:** The current Signal K user is not an administrator.
- **Access error:** Signal K reports an administrator session, but Chart Locker refused it.
- **Unavailable:** Chart Locker did not respond after repeated attempts.
- **Error:** Chart Locker returned a server failure or malformed status data.

The header reports service and cache state only. It never certifies that a particular passage is
complete.
