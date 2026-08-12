import { hasControlCharacters, readBoundedJson, withTimeout } from '$shared/lib';
import { adminSessionInit } from './resource.js';

export type AdminSessionState = 'admin' | 'non-admin' | 'signed-out' | 'unknown';

// Whether a server-supplied string is a same-origin absolute path, safe to concatenate onto the
// server origin. A protocol-relative "//host" or a backslash would escape to another origin once a
// browser normalizes it, and a control character can split a header or a URL. Exported because the
// access-request poll concatenates a server-supplied href the same way this redirect does.
export function isSameOriginPath(path: string): boolean {
  return (
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.includes('\\') &&
    !hasControlCharacters(path)
  );
}

function safeReturnPath(path: string): string {
  // Bouncing the login form back to itself would loop the navigator through login forever.
  return isSameOriginPath(path) && !path.startsWith('/admin/#/login') ? path : '/signalk-binnacle/';
}

// Signal K's administrator UI owns the login form. Its redirect contract must return to an in-scope
// webapp URL so an installed PWA completes authentication in its own browsing context instead of
// relying on a separate tab's cookie jar and a focus event.
export function adminLoginUrl(origin: string, returnPath: string): string {
  const redirect = encodeURIComponent(safeReturnPath(returnPath));
  return `${origin}/admin/#/login?redirect=${redirect}`;
}

// Ask Signal K what the current browser cookie represents. Chart Locker's 401 or 403 alone cannot
// distinguish a signed-out browser, a non-admin user, or an administrator session rejected at the
// plugin boundary. Unknown is deliberately separate from signed-out so a failed status check never
// tells an authenticated navigator to sign in again without evidence.
export async function fetchAdminSessionState(
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AdminSessionState> {
  try {
    const response = await fetchImpl(
      `${origin}/skServer/loginStatus`,
      withTimeout(adminSessionInit()),
    );
    if (!response.ok) return 'unknown';
    const body = await readBoundedJson<{ status?: unknown; userLevel?: unknown }>(response);
    if (body.status === 'loggedOut' || body.status === 'notLoggedIn') return 'signed-out';
    if (body.status !== 'loggedIn') return 'unknown';
    if (body.userLevel === 'admin') return 'admin';
    return typeof body.userLevel === 'string' ? 'non-admin' : 'unknown';
  } catch {
    return 'unknown';
  }
}
