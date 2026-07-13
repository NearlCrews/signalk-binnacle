import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { CompanionState } from '$features/prewarm';
import ChartLockerStatus from './ChartLockerStatus.svelte';

// Renders the pill to an SSR HTML string (the suite runs in the node environment, no DOM), enough to
// pin its presence, the per-state glyph and text, the warning modifier classes, the cache figure, and
// the state-appropriate action target.
function body(props: {
  present: boolean;
  state: CompanionState;
  cacheBytes: number | null;
  onOpen: () => void;
}): string {
  return render(ChartLockerStatus, {
    props: { ...props, accessUrl: 'http://localhost/admin/#/login' },
  }).body;
}

const noop = (): void => {};

describe('ChartLockerStatus', () => {
  it('renders nothing when the companion is not present', () => {
    const html = body({ present: false, state: 'serving', cacheBytes: 4096, onOpen: noop });
    expect(html).not.toContain('Offline:');
    expect(html).not.toContain('<button');
  });

  it('shows every state as visible text plus a distinct glyph', () => {
    for (const [state, glyph, value] of [
      ['serving', 'lucide-check', 'cache ready'],
      ['needs-auth', 'lucide-key-round', 'admin sign-in'],
      ['offline', 'lucide-unplug', 'unavailable'],
      ['error', 'lucide-triangle-alert', 'error'],
    ] as const) {
      const html = body({ present: true, state, cacheBytes: null, onOpen: noop });
      expect(html).toContain('Offline:');
      expect(html).toContain(glyph);
      expect(html).toContain(`>${value}</span>`);
      const action =
        state === 'needs-auth' ? 'open Signal K administrator sign-in' : 'open offline charts';
      expect(html).toContain(`aria-label="Offline charts, ${value}, ${action}"`);
    }
  });

  it('applies the offline and error modifier class only in those states', () => {
    const offline = body({ present: true, state: 'offline', cacheBytes: null, onOpen: noop });
    expect(offline).toContain('cl--offline');
    expect(offline).not.toContain('cl--error');

    const error = body({ present: true, state: 'error', cacheBytes: null, onOpen: noop });
    expect(error).toContain('cl--error');
    expect(error).not.toContain('cl--offline');

    for (const state of ['serving', 'needs-auth'] as const) {
      const html = body({ present: true, state, cacheBytes: 4096, onOpen: noop });
      expect(html).not.toContain('cl--offline');
      expect(html).not.toContain('cl--error');
    }
  });

  it('shows the cache figure visibly instead of hiding it in a pointer-only tooltip', () => {
    const serving = body({ present: true, state: 'serving', cacheBytes: 4096, onOpen: noop });
    expect(serving).toContain('title="Offline charts: online, cache 4.0 KB"');
    expect(serving).toContain('>4.0 KB</span>');
    // needs-auth cannot read the size, so no byte figure appears at all.
    const needsAuth = body({ present: true, state: 'needs-auth', cacheBytes: 4096, onOpen: noop });
    expect(needsAuth).toContain('sign in to Signal K as an administrator, then return to Binnacle');
    expect(needsAuth).not.toContain('4.0 KB');
  });

  it('opens the panel for ordinary states and Signal K sign-in for access-needed', () => {
    const present = body({ present: true, state: 'serving', cacheBytes: null, onOpen: noop });
    expect(present).toContain('<button');
    expect(present).toContain('aria-label="Offline charts, cache ready, open offline charts"');

    const needsAuth = body({ present: true, state: 'needs-auth', cacheBytes: null, onOpen: noop });
    expect(needsAuth).not.toContain('<button');
    expect(needsAuth).toContain('cl--access');
    expect(needsAuth).toContain('href="http://localhost/admin/#/login"');
    expect(needsAuth).toContain('target="_blank"');
    expect(needsAuth).toContain(
      'aria-label="Offline charts, admin sign-in, open Signal K administrator sign-in"',
    );

    const absent = body({ present: false, state: 'serving', cacheBytes: null, onOpen: noop });
    expect(absent).not.toContain('<button');
    expect(absent).not.toContain('<a');
  });
});
