import { fetchJsonOrUndefined, isRecord } from '$shared/lib';

export function serverOrigin(): string {
  return `${location.protocol}//${location.host}`;
}

// The discovery document's advertised v1 stream endpoint (GET /signalk). A server mounted behind
// a reverse proxy or on a nonstandard port advertises where the stream actually lives, so the
// client asks first and derives from location only when discovery fails (a proxy that does not
// forward /signalk, a flaky link at connect time). The advertised scheme is normalized to ws or
// wss; a plain ws endpoint under an https page is upgraded to wss, since the browser would block
// the insecure socket anyway and a TLS-terminating proxy answers on wss.
export async function discoverStreamUrl(fetchFn?: typeof fetch): Promise<string | undefined> {
  const doc = await fetchJsonOrUndefined<unknown>(`${serverOrigin()}/signalk`, undefined, fetchFn);
  if (!isRecord(doc) || !isRecord(doc.endpoints)) return undefined;
  const v1 = doc.endpoints.v1;
  const advertised = isRecord(v1) ? v1['signalk-ws'] : undefined;
  if (typeof advertised !== 'string' || !advertised) return undefined;
  try {
    const url = new URL(advertised, serverOrigin());
    const scheme = { 'ws:': 'ws:', 'wss:': 'wss:', 'http:': 'ws:', 'https:': 'wss:' }[url.protocol];
    if (!scheme) return undefined;
    url.protocol = location.protocol === 'https:' && scheme === 'ws:' ? 'wss:' : scheme;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function isInsecureTransportOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:') return false;
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, '');
    const isLocalhost = hostname === 'localhost' || hostname.endsWith('.localhost');
    const isIpv4Loopback = /^127(?:\.\d{1,3}){3}$/u.test(hostname);
    return !isLocalhost && !isIpv4Loopback && hostname !== '[::1]';
  } catch {
    return false;
  }
}

// Append one `key=value` query parameter to a URL, choosing `?` or `&` by whether the URL already
// carries a query. The value is percent-encoded; the key is assumed already safe. Shared by the token
// and subscribe parameters so the separator choice lives in one place.
export function appendQuery(url: string, key: string, value: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;
}

// Append the device token as a query parameter, the only header-free form a browser WebSocket handshake
// can carry that this server actually authenticates (the subprotocol form does not: see the note below).
// Shared by the delta stream and the radar spoke stream so the idiom lives in one place.
export function appendToken(url: string, token: string): string {
  return appendQuery(url, 'token', token);
}

// The stream URL, optionally carrying the auth token as a query parameter.
//
// Security note (token in URL): browsers cannot set an Authorization header on a
// WebSocket handshake, so the token must travel another way. The two header-free
// options are a query parameter and the WebSocket subprotocol
// (new WebSocket(url, ['Bearer', token])). We tested both against a live Signal K
// server (2.28): the subprotocol form opens the socket but the server does NOT
// authenticate from it (zero data delivered), while the query parameter is the only
// form that actually streams data. So query-string auth is required here, not a
// preference. The exposure is bounded: this is a same-origin connection to the boat's
// own server over the LAN, the token is a device token scoped to the approved access, and the URL is
// not sent to any third party. To harden, serve Signal K over TLS (wss) so the URL is
// encrypted in transit, and keep the server's access logs off or scrubbed of `token`.
// The connection appends `subscribe=none` via appendQuery, so this only adds the token.
export function streamUrl(token?: string): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = `${scheme}//${location.host}/signalk/v1/stream`;
  return token ? appendToken(base, token) : base;
}
