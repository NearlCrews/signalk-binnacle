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

  it('names the declined device id and what a fresh request does', () => {
    const body = render(AuthBanner, {
      props: {
        auth: {
          status: 'denied',
          clientId: 'binnacle-9f3a21bc',
          upgrading: false,
          writeBlocked: false,
        } as AuthController,
        requestsUrl: 'http://boat.local/admin/#/security/access-requests',
      },
    }).body;
    expect(body).toContain('binnacle-9f3a21bc');
    expect(body).toContain('new device ID');
    expect(body).toContain('Access Requests');
    expect(body).toContain('Request again');
  });

  it('explains an unreachable initial request without claiming a denial, keeping the device id', () => {
    const body = render(AuthBanner, {
      props: {
        auth: {
          status: 'denied',
          accessOutcome: 'unreachable',
          clientId: 'binnacle-9f3a21bc',
          upgrading: false,
          writeBlocked: false,
        } as AuthController,
        requestsUrl: 'http://boat.local/admin/#/security/access-requests',
      },
    }).body;
    expect(body).toContain('Could not reach the Signal K server');
    expect(body).toContain('Try again');
    expect(body).toContain('binnacle-9f3a21bc');
    expect(body).not.toContain('declined access');
    expect(body).not.toContain('new device ID');
  });

  it('explains an unanswered initial request as still waiting, not refused', () => {
    const body = render(AuthBanner, {
      props: {
        auth: {
          status: 'denied',
          accessOutcome: 'unanswered',
          clientId: 'binnacle-9f3a21bc',
          upgrading: false,
          writeBlocked: false,
        } as AuthController,
        requestsUrl: 'http://boat.local/admin/#/security/access-requests',
      },
    }).body;
    expect(body).toContain('was not approved in time');
    expect(body).toContain('Try again');
    expect(body).not.toContain('declined access');
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
