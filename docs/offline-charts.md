# Offline charts

Offline charts lets a navigator save chart coverage before leaving internet access. Treat every saved
area as planning support, not as proof that a passage is safe. Before departure, verify the intended
area, included charts, completion state, and update date. Loss of internet access and loss of the boat's
Signal K connection are different conditions: server-managed charts still need the boat server to be
reachable.

## Set up Chart Locker

1. Install `signalk-chart-locker` from the Signal K App Store.
2. Start the plugin.
3. Open Binnacle and choose **Offline charts**.

Binnacle keeps Offline charts visible when Chart Locker is absent or unavailable. The menu item
distinguishes a missing plugin, refused access, and an unreachable service so it can explain whether
Chart Locker needs to be installed, started, or accessed through an administrator session.

Saved areas are not the only thing Chart Locker serves. When it is installed and ready, Binnacle also
routes its reference raster overlays (bathymetry, boundaries, infrastructure, protected areas, and
seamarks) through the plugin's tile proxy, so those layers share the boat's one cache instead of each
device fetching them from the internet separately. When Chart Locker is absent, every overlay keeps
its direct upstream URL and a standalone install is unchanged. Time-dynamic sources such as weather
radar are never proxied or pre-warmed: a stored weather frame is wrong before anyone sails into it.

## Administrator access

Chart Locker protects its management API with Signal K's administrator session. This is separate from
Binnacle's ordinary device access request and its read and write access.

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
2. Choose **Use current chart view**, or draw a rectangle over the planned passage.
3. Review the included charts and choose Overview, Coastal, or Harbor detail.
4. Check the estimated download against available saved-area storage.
5. Name the area and start the download.
6. Wait for **Saved, works offline**, then verify coverage and the update date.

The current-view option works without dragging. After setting an area, **Adjust area coordinates**
provides west, south, east, and north bounds in decimal degrees. A west longitude greater than the
east longitude selects an area across the antimeridian. Latitude bounds are limited to 85 degrees
north or south for the supported map projection.

On a phone, the panel collapses while drawing so the chart receives the gesture. **Cancel selection**
or Escape leaves draw mode. Finishing a draw without dragging selects nothing.

Step 3 lists the charts that actually cover the drawn area, with the specialist layers grouped last
under **Advanced layers**: the coarse worldwide bathymetry, the second US depth layer, and the
jurisdiction, protected-area, and seabed-infrastructure sets. Weather and ocean overlays are never
offered here. They expire in minutes to hours, so storing them for a passage would spend the area's
byte budget on tiles that are wrong before anyone reads them.

The initial selection includes a primary chart where one covers the area, navigation marks, and the
base map. Review **Customize included charts**: an unchecked chart is not included in this saved
area. The base map supplies land, roads, and place names, not nautical chart coverage.

If Chart Locker accepts a download but loses the immediate job response, Binnacle keeps the area in
**Starting download** while Chart Locker recovers the job by area identifier. A temporary status
failure does not start a second download. Use **Retry status** on the saved-area card to resume
polling.

Saved-area cards distinguish a completed download from **Storage full, some left out**, **Could not
finish**, and **Out of date, download again**. Progress includes tile counts, bytes, skipped empty
tiles, and errors. A failed list request is not an empty library; **Retry saved areas** reloads it
without starting a download.

Chart Locker can retain a saved definition after one of its chart sources is removed. Binnacle marks
that source unavailable and preserves any already cached coverage. **Download again** stays disabled
because it would repeat a request Chart Locker cannot fulfill. Use **Adjust a copy** to choose current
charts, save the replacement, verify it, then delete the older area.

## Check a route's coverage

Open a saved route's passage plan, then choose **Offline charts**. Select a corridor setting of 1, 5,
or 10 nautical miles and the required Overview, Coastal, or Harbor detail, then select **Check route
coverage**. This does not activate the route or change the boat's course.

The check samples the route and both corridor edges against ready saved areas, their included chart
sources, catalog coverage, and zoom detail. **Complete** means those samples have matching saved
coverage. **Partial** identifies missing coverage or insufficient detail and highlights gaps on the
chart. **Unknown** means there is not enough information to check, such as an unavailable saved-area
list or a route with fewer than two points.

This is a sampling check, not a tile-by-tile verification, chart-edition check, or navigation safety
certificate. Narrow gaps can fall between samples, and a catalog source covering a point does not
establish that it is an appropriate nautical chart. Inspect the actual charts and saved-area dates.
Changing the checked route, its geometry, saved areas, or relevant catalog data invalidates the result.
The watch handoff includes a result only while its identity and saved-area metadata can be revalidated,
the service is reachable, and the check is no more than 24 hours old. Otherwise it says the route was
not checked this session rather than reusing an unverified result.

## Automatic caching and storage

Automatic caching keeps selected charts near the moving boat. It is a rolling convenience cache, not
a substitute for a saved and verified passage area.

The current automatic-caching policy must load successfully before its controls can be changed.
**Checking** and **Unavailable** are not the same as **Off**. If loading fails, use **Retry settings**;
Binnacle does not submit placeholder defaults over an unread server policy. If caching is enabled
without any selected charts, the panel explains that nothing is being saved.

Binnacle validates and clamps settings to Chart Locker's current management contract: up to 64 chart
sources, zoom levels from 0 through 24, a nearby-cache radius and movement threshold up to 100 km,
and an update interval from 60 seconds through 24 hours. Stored values remain in meters and seconds;
the panel converts distance only at the display boundary.

The Storage view separates saved-area, recently viewed, and automatic-caching use. Clearing recently
viewed charts does not delete saved areas. Setting changes show saving and saved feedback. If a save
fails, the panel keeps the latest choice visible and offers Retry. Rapid changes are serialized so an
older response cannot replace the newest setting.

**Retry storage** recovers a failed initial storage request. **Clear recently viewed** asks for
confirmation and preserves saved areas. The auto-clear interval accepts 0 through 365 days; 0 keeps
recently viewed charts until storage pressure clears them. These controls change Chart Locker's
shared server storage, not only this browser's cache.

## HTTPS and the browser cache

Binnacle separates server-managed chart storage from two kinds of browser cache.

Chart Locker's saved areas and automatic caching run on the Signal K server. They work over the
boat's ordinary Signal K connection, so they do not require HTTPS. Inside the browser, PMTiles blocks,
weather forecasts, tides, chart notes, and vessel conditions use IndexedDB, which is not
secure-context gated either. These stores can restore previously received data while the app is
running or after it loads again from a reachable server. Retained data is not necessarily current,
and cached PMTiles blocks cover only the ranges already received, not an entire chart archive.

The service worker caches the application shell and supported byte assets: the base map, tiles
served by a plugin, and streamed overlays. Browsers expose the service worker and cache-storage
APIs only in a secure context, meaning HTTPS or `http://localhost`. The Signal K server serves
Binnacle over plain HTTP on the local network by default, so that layer stays off there. IndexedDB
alone cannot guarantee that a closed browser can reopen Binnacle when the boat server is unreachable.
The Offline charts landing page explains the cache limitation when
the page was loaded over plain HTTP, and it likewise shows a notice when the browser rejected the
server certificate. Neither condition disables Chart Locker's server cache.

Browser storage is limited and can be cleared or evicted. Visit the required areas and zoom levels,
confirm the service worker is working where needed, and test the intended disconnected operation
before departure. Changing from HTTP to HTTPS, or changing the hostname or port, creates a different
browser origin with its own storage and sign-in context. Do not assume caches transfer with it.

There are two good ways to add HTTPS to Signal K:

- The [signalk-ssl](https://www.npmjs.com/package/signalk-ssl) plugin
  ([source](https://github.com/dirkwa/signalk-ssl)), which generates a local certificate authority,
  issues the server certificate, and distributes the root to your devices by QR code. The Signal K
  server's built-in SSL settings (Server, then Settings, then SSL) are a bare-bones alternative.
- [Tailscale HTTPS](https://tailscale.com/docs/how-to/set-up-https-certificates), which can provide
  publicly trusted certificates for a configured tailnet hostname. This avoids distributing a local
  certificate authority but still requires HTTPS configuration. See
  [Accessing Signal K remotely with Tailscale](https://gist.github.com/NearlCrews/3f7af717fec853a80e7de1063940382e)
  for a quick start.

HTTPS alone is not enough: the browser must also **trust** the certificate. A self-signed
certificate, including one the signalk-ssl plugin generates, is not trusted by default, and browsers
refuse to register a service worker from an origin whose certificate they do not trust even after
the certificate warning is clicked through. The symptom is a page that loads normally while offline
caching never activates: the Offline charts landing page shows a certificate notice, and the console
logs an informational line saying offline caching is off because the browser does not trust the
server certificate. The fix is environmental, not a Binnacle setting: obtain the certificate
authority's root using the plugin's QR code or certificate download. Install it in the browser or
operating system trust store, mark it trusted, then reload over HTTPS and check that offline caching
starts.

## Status meanings

- **Cached amount:** Chart Locker is responding, and the header reports current cache use.
- **Sign in:** The browser is signed out of Signal K.
- **Admin needed:** The current Signal K user is not an administrator.
- **Access error:** Signal K reports an administrator session, but Chart Locker refused it.
- **Unavailable:** Chart Locker did not respond after repeated attempts.
- **Error:** Chart Locker returned a server failure or malformed status data.

The header reports service and cache state only. It never certifies that a particular passage is
complete. Chart requests can reveal the requested area to external providers; caching is not a
network privacy switch. Open **Help**, then **Network privacy**, for the data-sharing
boundaries.
