import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import AccessRecoveryNote from './AccessRecoveryNote.svelte';
import type { AccessRecoveryState } from './access-recovery.js';

const accessUrl = '/admin/#/login?redirect=%2Fsignalk-binnacle%2F';
const noop = (): void => {};

function body(state: AccessRecoveryState): string {
  return render(AccessRecoveryNote, {
    props: {
      state,
      capability: 'manage offline charts',
      accessUrl,
      onRetry: noop,
    },
  }).body;
}

describe('AccessRecoveryNote', () => {
  it('offers same-window sign-in only when the Signal K session needs it', () => {
    expect(body('needs-login')).toContain(`href="${accessUrl}"`);
    expect(body('needs-admin')).toContain('Sign in as an administrator');
    expect(body('needs-login')).not.toContain('target="_blank"');
  });

  it('offers retry instead of sign-in when an administrator session was refused', () => {
    const html = body('access-error');
    expect(html).toContain('Signal K reports an administrator session');
    expect(html).toContain('Retry access');
    expect(html).not.toContain('<a');
  });

  it('keeps checking separate from signed-out and failure states', () => {
    const html = body('checking');
    expect(html).toContain('Checking Chart Locker administrator access');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('<button');
  });
});
