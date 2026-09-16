import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import SetupChecklist from './SetupChecklist.svelte';

function renderChecklist(overrides: Record<string, unknown> = {}): string {
  return render(SetupChecklist, {
    props: {
      chartOn: false,
      gpsSeen: false,
      writeAllowed: false,
      audioState: 'blocked',
      savedDataProvisioned: undefined,
      onOpenLayers: vi.fn(),
      onRequestWrite: vi.fn(),
      onEnableSound: vi.fn(),
      ...overrides,
    },
  }).body;
}

describe('SetupChecklist', () => {
  it('lists each stall with one action that reuses an existing surface', () => {
    const body = renderChecklist();
    expect(body).toContain('Get set up');
    expect(body).toContain('Open Layers and charts');
    expect(body).toContain('Request read and write access');
    expect(body).toContain('Enable alarm sound now');
    // A row with no in-app action states the fix in prose instead of offering a dead button.
    expect(body).toContain('Data Browser of the Signal K server admin UI');
  });

  it('marks a finished row done and drops its action', () => {
    const body = renderChecklist({ chartOn: true });
    expect(body).toContain('Turn on a nautical chart (done)');
    expect(body).not.toContain('Open Layers and charts');
  });

  it('hides once the durable rows pass, and never flickers on the session rows', () => {
    const durableDone = { chartOn: true, writeAllowed: true, savedDataProvisioned: true };
    expect(renderChecklist(durableDone)).not.toContain('Get set up');
    // GPS and alarm sound reset every load, so they must not decide visibility on a set-up boat.
    expect(renderChecklist({ ...durableDone, gpsSeen: true, audioState: 'ready' })).not.toContain(
      'Get set up',
    );
    expect(renderChecklist({ gpsSeen: true, audioState: 'ready' })).toContain('Get set up');
  });

  it('surfaces the HTTPS row and keeps the checklist visible over plain HTTP', () => {
    const durableDone = { chartOn: true, writeAllowed: true, savedDataProvisioned: true };
    const insecure = renderChecklist({ ...durableDone, secureContext: false });
    expect(insecure).toContain('Get set up');
    expect(insecure).toContain('Serve over HTTPS for browser offline caching');
    expect(insecure).toContain('the browser disables offline caching');
    const secure = renderChecklist({ secureContext: true });
    expect(secure).toContain('Serve over HTTPS for browser offline caching (done)');
  });

  it('keeps the storage row neutral while the provider probe has not answered', () => {
    expect(renderChecklist({ chartOn: true, writeAllowed: true })).toContain('Get set up');
    expect(renderChecklist()).toContain('Checking whether this server stores routes');
    expect(renderChecklist({ savedDataProvisioned: false })).toContain(
      'This server has no resources provider',
    );
  });

  it('distinguishes a historical fix from a current position', () => {
    const historical = renderChecklist({ gpsSeen: true });
    expect(historical).toContain('no current fix is available');
    expect(historical).not.toContain('See a GPS position (done)');
    expect(renderChecklist({ gpsSeen: true, gpsCurrent: true })).toContain(
      'See a GPS position (done)',
    );
  });

  it.each(['failed', 'unsupported'])('does not treat %s audio as ready', (audioState) => {
    const body = renderChecklist({ audioState });
    expect(body).not.toContain('Alarms can sound');
    expect(body).not.toContain('Enable alarm sound (done)');
  });
});
