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
});
