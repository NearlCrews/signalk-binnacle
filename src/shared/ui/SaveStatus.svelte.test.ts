import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import SaveStatus from './SaveStatus.svelte';

describe('save recovery copy', () => {
  it('uses the shared Retry action label after a failed save', () => {
    const body = render(SaveStatus, {
      props: { state: 'error', errorMessage: 'Not saved.', onRetry: vi.fn() },
    }).body;
    expect(body).toContain('Retry');
    expect(body).not.toContain('Try again');
  });
});
