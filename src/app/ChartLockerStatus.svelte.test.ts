import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { CompanionState } from '$features/prewarm';
import ChartLockerStatus from './ChartLockerStatus.svelte';

// Renders the pill to an SSR HTML string (the suite runs in the node environment, no DOM), enough to
// pin its presence, the per-state glyph and text, the warning modifier classes, and the cache figure.
// The node environment cannot dispatch a real DOM click, so
// the onOpen wiring is verified structurally: the click target (the button) exists only when present,
// which is exactly the "fires only when present" guard, and no target renders when absent.
function body(props: {
  present: boolean;
  state: CompanionState;
  cacheBytes: number | null;
  onOpen: () => void;
}): string {
  return render(ChartLockerStatus, { props }).body;
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
      ['needs-auth', 'lucide-key-round', 'sign in'],
      ['offline', 'lucide-unplug', 'unavailable'],
      ['error', 'lucide-triangle-alert', 'error'],
    ] as const) {
      const html = body({ present: true, state, cacheBytes: null, onOpen: noop });
      expect(html).toContain('Offline:');
      expect(html).toContain(glyph);
      expect(html).toContain(`>${value}</span>`);
      expect(html).toContain(`aria-label="Offline charts, ${value}, open offline charts"`);
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
    expect(needsAuth).toContain('sign in to see cache size');
    expect(needsAuth).not.toContain('4.0 KB');
  });

  it('renders the onOpen click target only when present', () => {
    // The button carries the onOpen wiring, so it must exist only when present: absent means there is
    // no target for a click to fire onOpen from.
    const present = body({ present: true, state: 'serving', cacheBytes: null, onOpen: noop });
    expect(present).toContain('<button');
    expect(present).toContain('aria-label="Offline charts, cache ready, open offline charts"');

    const absent = body({ present: false, state: 'serving', cacheBytes: null, onOpen: noop });
    expect(absent).not.toContain('<button');
  });
});
