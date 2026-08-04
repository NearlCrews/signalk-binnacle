import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { AuthController } from '$shared/signalk';
import LayersPanel from './LayersPanel.svelte';
import type { LayersView } from './layers-view.svelte';

const view = { items: [] } as unknown as LayersView;

function auth(writeBlocked: boolean, upgrading = false): AuthController {
  return { writeBlocked, upgrading, requestWriteAccess: vi.fn() } as unknown as AuthController;
}

function renderPanel(authController: AuthController): string {
  return render(LayersPanel, {
    props: { view, auth: authController, onClose: vi.fn() },
  }).body;
}

describe('LayersPanel write access', () => {
  it('offers the read/write request beside the chart-sharing block', () => {
    const body = renderPanel(auth(true));

    expect(body).toContain('Read/write access is needed to share them');
    expect(body).toContain('Request read/write access');
  });

  it('rests the request control while a request is outstanding', () => {
    expect(renderPanel(auth(true, true))).toMatch(/<button[^>]+disabled[^>]*>\s*Requesting access/);
  });

  it('leaves the note out while writes are allowed', () => {
    expect(renderPanel(auth(false))).not.toContain('Request read/write access');
  });
});
