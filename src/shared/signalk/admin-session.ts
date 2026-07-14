import { withTimeout } from '$shared/lib';
import { adminSessionInit } from './resource.js';

export type AdminSessionState = 'admin' | 'non-admin' | 'signed-out' | 'unknown';

function safeReturnPath(path: string): string {
  const hasControlCharacter = [...path].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
  if (
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.includes('\\') &&
    !hasControlCharacter &&
    !path.startsWith('/admin/#/login')
  ) {
    return path;
  }
  return '/signalk-binnacle/';
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
    const body = (await response.json()) as { status?: unknown; userLevel?: unknown };
    if (body.status !== 'loggedIn') return 'signed-out';
    return body.userLevel === 'admin' ? 'admin' : 'non-admin';
  } catch {
    return 'unknown';
  }
}
