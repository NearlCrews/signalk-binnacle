import { describe, expect, it, vi } from 'vitest';
import { adminLoginUrl, fetchAdminSessionState } from './admin-session';

const response = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('adminLoginUrl', () => {
  it('returns through the current in-scope webapp URL', () => {
    expect(adminLoginUrl('https://boat.local', '/signalk-binnacle/?panel=offline#saved')).toBe(
      'https://boat.local/admin/#/login?redirect=%2Fsignalk-binnacle%2F%3Fpanel%3Doffline%23saved',
    );
  });

  it('falls back when the return path is not a safe same-origin relative URL', () => {
    expect(adminLoginUrl('https://boat.local', '//elsewhere.test')).toBe(
      'https://boat.local/admin/#/login?redirect=%2Fsignalk-binnacle%2F',
    );
    expect(adminLoginUrl('https://boat.local', '/admin/#/login')).toBe(
      'https://boat.local/admin/#/login?redirect=%2Fsignalk-binnacle%2F',
    );
  });
});

describe('fetchAdminSessionState', () => {
  it.each([
    [{ status: 'loggedIn', userLevel: 'admin' }, 'admin'],
    [{ status: 'loggedIn', userLevel: 'readwrite' }, 'non-admin'],
    [{ status: 'notLoggedIn' }, 'signed-out'],
  ] as const)('maps %j to %s', async (body, expected) => {
    const fetchImpl = vi.fn(async () => response(body));
    await expect(fetchAdminSessionState('https://boat.local', fetchImpl)).resolves.toBe(expected);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://boat.local/skServer/loginStatus',
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
    );
  });

  it('returns unknown for a failed response, invalid JSON, or transport failure', async () => {
    await expect(
      fetchAdminSessionState(
        'https://boat.local',
        vi.fn(async () => response({}, 500)),
      ),
    ).resolves.toBe('unknown');
    await expect(
      fetchAdminSessionState(
        'https://boat.local',
        vi.fn(async () => new Response('not json', { status: 200 })),
      ),
    ).resolves.toBe('unknown');
    await expect(
      fetchAdminSessionState(
        'https://boat.local',
        vi.fn(async () => {
          throw new TypeError('offline');
        }),
      ),
    ).resolves.toBe('unknown');
  });
});
