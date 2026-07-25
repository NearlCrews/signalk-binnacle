import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { AuthController } from '$shared/signalk';
import AuthBanner from './AuthBanner.svelte';

describe('AuthBanner', () => {
  it('keeps the insecure transport warning visible after authentication', () => {
    const body = render(AuthBanner, {
      props: {
        auth: {
          status: 'authenticated',
          upgrading: false,
          writeBlocked: false,
        } as AuthController,
        requestsUrl: 'http://boat.local/admin/#/security/access-requests',
        insecureTransport: true,
      },
    }).body;
    expect(body).toContain('This connection is not encrypted.');
    expect(body).toContain('role="status"');
  });

  it('explains a declined write upgrade with a retry, over the generic read-only copy', () => {
    const body = render(AuthBanner, {
      props: {
        auth: {
          status: 'authenticated',
          upgrading: false,
          writeBlocked: true,
          upgradeOutcome: 'declined',
        } as AuthController,
        requestsUrl: 'http://boat.local/admin/#/security/access-requests',
      },
    }).body;
    expect(body).toContain('Write access was declined');
    expect(body).toContain('Request again');
    expect(body).not.toContain('Request read/write access');
  });

  it('explains an unanswered write upgrade without blaming connectivity', () => {
    const body = render(AuthBanner, {
      props: {
        auth: {
          status: 'authenticated',
          upgrading: false,
          writeBlocked: true,
          upgradeOutcome: 'unanswered',
        } as AuthController,
        requestsUrl: 'http://boat.local/admin/#/security/access-requests',
      },
    }).body;
    expect(body).toContain('was not approved in time');
    expect(body).toContain('Request again');
    expect(body).not.toContain('Could not reach the server');
  });

  it('explains an unreachable write upgrade with a retry', () => {
    const body = render(AuthBanner, {
      props: {
        auth: {
          status: 'authenticated',
          upgrading: false,
          writeBlocked: true,
          upgradeOutcome: 'unreachable',
        } as AuthController,
        requestsUrl: 'http://boat.local/admin/#/security/access-requests',
      },
    }).body;
    expect(body).toContain('Could not reach the server');
    expect(body).toContain('Try again');
    expect(body).not.toContain('Request read/write access');
  });
});
