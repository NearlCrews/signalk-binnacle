# Security Policy

## Supported Versions

We actively support the following versions with security updates:

Only the latest published version receives security fixes. Upgrade before reporting or validating a
security issue so the result reflects the supported code.

## Reporting a Vulnerability

We take the security of Binnacle seriously. If you discover a security
vulnerability, please follow these guidelines.

### How to Report

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please report them via one of these methods:

1. **GitHub Security Advisory**: Use the [GitHub Security Advisory](https://github.com/NearlCrews/signalk-binnacle/security/advisories/new) feature (preferred).
2. **GitHub Issues**: For non-sensitive security concerns, open an [issue](https://github.com/NearlCrews/signalk-binnacle/issues).

### What to Include

Please include the following information in your report:

- **Description** of the vulnerability
- **Steps to reproduce** the issue
- **Potential impact** of the vulnerability
- **Suggested fix** (if you have one)
- **Your contact information** for follow-up

### Response Timeline

- **Initial Response**: within 48 hours of report
- **Status Update**: within 7 days with a preliminary assessment
- **Fix Timeline**: depends on severity, typically within 30 days

## Security Best Practices

When using this webapp:

1. **Keep Updated**: always use the latest version.
2. **Network Security**: ensure your Signal K server is properly secured, and
   prefer HTTPS (see the README's Offline charts, Chart Locker, and SSL section).
3. **Access Control**: approve Binnacle's access request deliberately in the
   Signal K admin UI, and limit access to the admin interface.
4. **Trust Stores**: when using a self-signed certificate, install its root
   into your device trust store rather than clicking through warnings.
5. **Monitor Logs**: watch for unusual activity in the Signal K logs.

## Dependency Security

This project uses:

- Separate runtime and full dependency audits for vulnerability scanning
- Automated dependency updates via Dependabot for security patches

Run both dependency audits:

```bash
npm run audit:runtime
npm run audit:full
```

The installed webapp serves prebuilt assets and has no server-side runtime dependencies. Libraries
bundled into its browser code are development dependencies, so a clean runtime-only audit does not
establish that the shipped browser code is free of known dependency vulnerabilities. The full audit
also covers those libraries and the build and test tools.

## Data Handling

Binnacle runs entirely in the browser and is served by your Signal K server.
It authenticates to that server with an access token you approve, stored in
the browser's local storage for that origin only. Saved routes, tracks, and waypoints go to your own
Signal K server. Profiles stay on this device and sync through Signal K when account access is
available; an unsecured server or failed sync can leave them local-only. The active, unsaved track
stays in IndexedDB for that browser origin until it is saved or discarded. If IndexedDB is
unavailable, it remains only in memory, and the Tracks panel warns that a reload will lose it.
A saved track contains the trail geometry, name, distance, and
timespan, which can reveal vessel movement and location history to anyone with access to that resource.
Waypoint names, descriptions, and coordinates can likewise reveal sensitive locations to anyone with
access to the waypoint collection. Measure points remain only in page memory and are cleared when the
tool ends or the page reloads.
Saved offline-area rectangles, automatic cache settings, and installed chart overrides go only to
your own Signal K server and its Chart Locker plugin.

The Profiles panel can forget Binnacle's local Signal K token or erase all local Binnacle settings,
profiles, caches, IndexedDB data, service-worker registration, and credentials from the current
browser. It clears only an explicit Binnacle ownership inventory, not all storage for the Signal K
origin. It does not revoke the device in Signal K, sign out an administrator session, or delete any
server resource. Full erasure is blocked during active safety and unsaved navigation workflows.

For map and weather data it calls public services including OpenFreeMap, Open-Meteo, RainViewer,
NOAA, EMODnet, GEBCO, NASA GIBS, OpenSeaMap, Open Waters' Seascape, and the VLIZ Marine
Regions service. Enabled online layers disclose the viewed tile area to their providers. Weather
and tide requests disclose the viewed, selected, or vessel coordinates needed for the requested
conditions. Providers also receive ordinary network metadata such as the public IP address and user
agent. Binnacle does not intentionally send a Signal K access token to a cross-origin provider.

User-added chart URLs are fetched by the browser. Choosing to share a chart sends its full URL,
including query values, to the Signal K server so other authorized clients can discover it. Keep
private provider credentials out of shared URLs.

Background weather warnings are an exception to panel-driven requests. With a fresh vessel fix,
Binnacle checks the detected Signal K weather provider and can fall back to NOAA's `api.weather.gov`
point alerts even when the Weather panel and layers are closed. The fallback sends vessel latitude
and longitude rounded to four decimal places. Checks normally repeat about every ten minutes, with
additional requests after area or provider changes and retries after failures. There is no in-app
opt-out for this background check. If this position disclosure is unacceptable, restrict external
requests with browser or network policy; closing panels alone does not prevent it. Such restrictions
also remove external warning coverage and may make other online data unavailable.

With the optional OpenRouter Companion plugin, Run now asks that server-side plugin to send its
configured vessel telemetry through OpenRouter to the selected model provider and may spend shared
paid credits. Refresh reports only reads saved reports and does not trigger an analysis. The
plugin's configuration controls its scheduled analyses, telemetry selection, credentials, and model;
closing Binnacle does not disable those server-side tasks.

Marine radar discovery and controls use the Signal K server origin. A provider-reported spoke-stream
URL is resolved relative to that origin, and the Signal K token is appended only when the resolved
stream remains same-origin. A cross-origin radar stream receives ordinary connection metadata and the
radar data request, but never the Signal K token. Prefer HTTPS with `wss:` radar streams. Browsers block
an insecure `ws:` radar stream from an HTTPS Binnacle page as mixed content.

Saving an offline area asks Chart Locker to download tiles from the selected public chart providers,
so those providers receive the selected area and requested zoom levels through ordinary tile requests.

External links in point-of-interest details are length-bounded and scheme-checked (`http:` and
`https:` only), and structured note content renders as text, never injected HTML. Provider note and
waypoint collections, fields, coordinates, and detail arrays are validated and bounded before they
reach the chart or UI. Valid note viewport results may be cached in IndexedDB for offline reuse.
Changing credentials invalidates the session cache and pending provider work.

Server-provided symbol catalogs accept only bounded, same-origin SVG paths. Symbol responses require
the SVG media type, a bounded body, and passive markup without scripts, embedded active content,
external references, event handlers, or imported CSS. The production page also applies a content
security policy that limits scripts, workers, objects, connections, and embedded resources.

The HTML policy cannot enforce `frame-ancestors`, because browsers ignore that directive in a meta
policy. Deployments exposed beyond a trusted vessel network should send this HTTP response header
from Signal K or its reverse proxy to prevent other sites from framing Binnacle:

```text
Content-Security-Policy: frame-ancestors 'none'
```

## Signal K Security

This webapp operates within the Signal K server environment. Please also refer
to the [Signal K documentation](https://demo.signalk.org/documentation/) and Signal
K server security best practices.

## Marine Safety Notice

This webapp is designed for marine navigation systems. While we strive for
security and reliability:

- **Not for Safety-Critical Use**: this software should not be relied upon as
  the sole means of navigation.
- **Professional Equipment**: always maintain certified navigation equipment.
- **Regular Verification**: chart overlays, weather, and points of interest
  come from third-party sources and are provided "as is"; verify all
  navigation data against official sources.
- **Test Thoroughly**: test in non-critical conditions before relying on this
  webapp.

## Disclosure Policy

- We will coordinate disclosure timing with the reporter.
- Public disclosure will occur after a fix is available.
- Credit will be given to reporters (if desired).
- A security advisory will be published on GitHub.
