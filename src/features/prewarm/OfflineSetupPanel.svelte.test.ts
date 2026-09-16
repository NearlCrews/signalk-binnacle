import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import OfflineSetupPanel from './OfflineSetupPanel.svelte';
import type { OfflineSetupState } from './offline-setup';

function body(state: OfflineSetupState): string {
  return render(OfflineSetupPanel, {
    props: {
      state,
      accessUrl: 'https://boat.test/admin/',
      onRetry: vi.fn(),
      onClose: vi.fn(),
    },
  }).body;
}

describe('Persistent offline chart setup', () => {
  it.each(['checking', 'absent', 'access-refused', 'unreachable', 'chart-loading'] as const)(
    'keeps guidance and recovery available for %s',
    (state) => {
      const html = body(state);
      expect(html).toContain('Offline chart setup');
      expect(html).toContain('Retry offline chart setup');
      expect(html).toContain('Open Signal K administration');
      expect(html).toContain('no cache status certifies safe navigation');
    },
  );

  it('does not confuse refusal or unreachability with absence', () => {
    expect(body('absent')).toContain('install signalk-chart-locker');
    expect(body('access-refused')).toContain('A refusal does not prove the plugin is missing');
    expect(body('unreachable')).toContain('installation and saved-chart status are unknown');
    expect(body('unreachable')).not.toContain('install signalk-chart-locker');
  });
});
