# History sources

Binnacle keeps the History API request defaults compatible with older Signal K servers. Ordinary
Playback, track history, and Data trends requests do not send `sourcePolicy`.

Signal K server 2.32.0 supports the optional `sourcePolicy=all` query. It returns separate columns
for each source, with `$source` in each column descriptor. It does not select a preferred sensor.
An explicit source reference on an individual path remains a source filter.

The shared history client accepts `sourcePolicy: 'all'`, validates and retains column source
identities, and distinguishes columns by path, aggregate, and source. Column lookup can take an
explicit source. Without one, ambiguous source-split columns are unavailable rather than selected
by response order. Playback therefore cannot silently switch between two GPS columns. Data trends
and historical instrument discovery also reject ambiguous columns instead of mixing sensors.

This is protocol support, not a new sensor-selection setting. Keep requests on the default policy
unless the caller can choose and display one source for the accepted series. Supporting a source
selector later requires provider compatibility checks and an explicit, visible source choice.

The released contract is defined in the
[Signal K history types](https://github.com/SignalK/signalk-server/blob/v2.32.0/packages/server-api/src/history.ts).
