import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { CompanionState } from '$features/prewarm';
import ChartLockerStatus from './ChartLockerStatus.svelte';

// Renders the pill to an SSR HTML string (the suite runs in the node environment, no DOM), enough to
// pin its presence, the per-state glyph, the accessible word, the warning modifier classes, and that
// the cache figure stays in the hover title. The node environment cannot dispatch a real DOM click, so
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
    expect(html).not.toContain('Chart Locker');
    expect(html).not.toContain('<button');
  });

  it('shows the state as a glyph, with the word in the accessible name, plus a steady drive mark', () => {
    for (const [state, glyph, word] of [
      ['serving', 'lucide-check', 'online'],
      ['needs-auth', 'lucide-check', 'online'],
      ['offline', 'lucide-unplug', 'offline'],
      ['error', 'lucide-triangle-alert', 'error'],
    ] as const) {
      const html = body({ present: true, state, cacheBytes: null, onOpen: noop });
      // The brand label and its steady drive mark are always shown.
      expect(html).toContain('Chart Locker:');
      expect(html).toContain('lucide-hard-drive');
      // The state shows as its glyph, and the literal word stays in the accessible name only.
      expect(html).toContain(glyph);
      expect(html).toContain(`aria-label="Chart Locker ${word}, open offline charts"`);
      // The state word is never rendered as visible body text.
      expect(html).not.toContain(`>${word}</span>`);
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

  it('keeps the cache figure in the hover title, never in the visible pill', () => {
    const serving = body({ present: true, state: 'serving', cacheBytes: 4096, onOpen: noop });
    expect(serving).toContain('title="Offline charts: online, cache 4.0 KB"');
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
    expect(present).toContain('aria-label="Chart Locker online, open offline charts"');

    const absent = body({ present: false, state: 'serving', cacheBytes: null, onOpen: noop });
    expect(absent).not.toContain('<button');
  });
});
