import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { CompanionState } from '$features/prewarm';
import ChartLockerStatus from './ChartLockerStatus.svelte';

const noop = (): void => {};

function body(props: {
  present: boolean;
  state: CompanionState;
  cacheBytes: number | null;
}): string {
  return render(ChartLockerStatus, {
    props: {
      ...props,
      accessUrl: 'http://localhost/admin/#/login?redirect=%2Fsignalk-binnacle%2F',
      onOpen: noop,
      onRetry: noop,
    },
  }).body;
}

describe('ChartLockerStatus', () => {
  it('renders nothing when Chart Locker is absent', () => {
    const html = body({ present: false, state: 'serving', cacheBytes: 4096 });
    expect(html).not.toContain('Charts:');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<a');
  });

  it('shows every state with truthful text and a distinct glyph', () => {
    for (const [state, glyph, value, action] of [
      ['checking', 'lucide-loader-circle', 'checking', 'retry Chart Locker access'],
      ['serving', 'lucide-check', 'cache ready', 'open offline charts'],
      ['needs-login', 'lucide-key-round', 'sign in', 'open Signal K administrator sign-in'],
      ['needs-admin', 'lucide-shield-alert', 'admin needed', 'open Signal K administrator sign-in'],
      ['access-error', 'lucide-shield-x', 'access error', 'retry Chart Locker access'],
      ['offline', 'lucide-unplug', 'unavailable', 'open offline charts'],
      ['error', 'lucide-triangle-alert', 'error', 'open offline charts'],
    ] as const) {
      const html = body({ present: true, state, cacheBytes: null });
      expect(html).toContain('Charts:');
      expect(html).toContain(glyph);
      expect(html).toContain(`>${value}</span>`);
      expect(html).toContain(`aria-label="Offline charts, ${value}, ${action}"`);
    }
  });

  it('applies warning and error modifiers to the matching states', () => {
    for (const state of ['needs-login', 'needs-admin', 'access-error'] as const) {
      expect(body({ present: true, state, cacheBytes: null })).toContain('cl--access');
    }

    expect(body({ present: true, state: 'offline', cacheBytes: null })).toContain('cl--offline');
    expect(body({ present: true, state: 'error', cacheBytes: null })).toContain('cl--error');
    expect(body({ present: true, state: 'serving', cacheBytes: null })).not.toContain('cl--access');
  });

  it('shows the cache figure only after a successful Chart Locker response', () => {
    const serving = body({ present: true, state: 'serving', cacheBytes: 4096 });
    expect(serving).toContain('title="Offline charts: online, cache 4.0 KB"');
    expect(serving).toContain('>4.0 KB</span>');

    const refused = body({ present: true, state: 'access-error', cacheBytes: 4096 });
    expect(refused).toContain('Signal K reports an administrator session');
    expect(refused).not.toContain('4.0 KB');
  });

  it('uses same-window Signal K login only for signed-out or non-admin sessions', () => {
    for (const state of ['needs-login', 'needs-admin'] as const) {
      const html = body({ present: true, state, cacheBytes: null });
      expect(html).toContain('<a');
      expect(html).toContain(
        'href="http://localhost/admin/#/login?redirect=%2Fsignalk-binnacle%2F"',
      );
      expect(html).not.toContain('target="_blank"');
    }

    const refused = body({ present: true, state: 'access-error', cacheBytes: null });
    expect(refused).toContain('<button');
    expect(refused).not.toContain('<a');
    expect(refused).toContain('retry Chart Locker access');
  });
});
