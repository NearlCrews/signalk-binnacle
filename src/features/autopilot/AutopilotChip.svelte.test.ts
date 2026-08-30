import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import AutopilotChip from './AutopilotChip.svelte';
import type { AutopilotChipState } from './autopilot-controller.svelte';

function renderChip(chip: AutopilotChipState): string {
  return render(AutopilotChip, { props: { chip, onOpen: vi.fn() } }).body.replaceAll(/\s+/g, ' ');
}

describe('AutopilotChip', () => {
  it('renders nothing while no autopilot has ever answered: chip absence is the degrade', () => {
    expect(renderChip({ kind: 'hidden' })).not.toContain('<button');
  });

  it('shows the engaged mode and a compass target in plain degrees, claiming no datum', () => {
    const html = renderChip({ kind: 'engaged', mode: 'compass', targetRad: 1.5, windMode: false });
    expect(html).toContain('AP');
    expect(html).toContain('Compass');
    expect(html).toContain('086°');
    // The API does not state whether a pilot's compass target is true or magnetic.
    expect(html).not.toContain('°T');
    expect(html).toContain('Autopilot is steering');
  });

  it('shows a wind target as a signed port or starboard angle', () => {
    const html = renderChip({ kind: 'engaged', mode: 'wind', targetRad: -0.5236, windMode: true });
    expect(html).toContain('P 30°');
  });

  it('says Steering when the pilot reports neither mode nor target', () => {
    const html = renderChip({ kind: 'engaged', mode: null, targetRad: null, windMode: false });
    expect(html).toContain('Steering');
  });

  it('shows standby quietly', () => {
    expect(renderChip({ kind: 'standby' })).toContain('Standby');
  });

  it('marks a vanished provider as unreachable in the warning voice, announced once', () => {
    const html = renderChip({ kind: 'lost' });
    expect(html).toContain('Unreachable');
    expect(html).toContain('sev-warning');
    expect(html).toContain('role="status"');
  });
});
