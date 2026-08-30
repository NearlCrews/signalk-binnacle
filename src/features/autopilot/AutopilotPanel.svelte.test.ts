import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { AuthController } from '$shared/signalk';
import AutopilotPanel from './AutopilotPanel.svelte';
import type { AutopilotController } from './autopilot-controller.svelte';

function fakeController(overrides: Partial<AutopilotController> = {}): AutopilotController {
  return {
    rehydrate: vi.fn(async () => undefined),
    selectDevice: vi.fn(),
    engage: vi.fn(async () => undefined),
    disengage: vi.fn(async () => undefined),
    setMode: vi.fn(async () => undefined),
    adjustTarget: vi.fn(),
    tack: vi.fn(async () => undefined),
    gybe: vi.fn(async () => undefined),
    clearCommandError: vi.fn(),
    dispose: vi.fn(),
    availability: 'available',
    absentReason: 'no-provider',
    devices: [{ id: 'pypilot', provider: 'pypilot-autopilot-provider', isDefault: true }],
    selectedId: 'pypilot',
    pilotState: 'auto',
    mode: 'compass',
    target: 1.5,
    engaged: true,
    modes: ['compass', 'gps', 'wind'],
    availableActionIds: new Set(['tack']),
    chip: { kind: 'engaged', mode: 'compass', targetRad: 1.5, windMode: false },
    hydrating: false,
    busy: false,
    adjustBusy: false,
    pendingCommand: undefined,
    commandError: null,
    ...overrides,
  } as AutopilotController;
}

function fakeAuth(overrides: Partial<Record<string, unknown>> = {}): AuthController {
  return {
    writeBlocked: false,
    upgrading: false,
    upgradeOutcome: undefined,
    requestWriteAccess: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as AuthController;
}

function renderPanel(controller: AutopilotController, auth: AuthController = fakeAuth()): string {
  return render(AutopilotPanel, {
    props: { controller, auth, onClose: vi.fn() },
  }).body.replaceAll(/\s+/g, ' ');
}

describe('AutopilotPanel', () => {
  it('teaches the provider path on the absent landing instead of a blank panel', () => {
    const html = renderPanel(fakeController({ availability: 'absent' }));
    expect(html).toContain('no autopilot provider is registered');
    expect(html).toContain('pypilot-autopilot-provider');
    expect(html).toContain('checks again automatically');
    expect(html).not.toContain('Engage autopilot');
  });

  it('names the missing v2 API when the server itself lacks it', () => {
    const html = renderPanel(fakeController({ availability: 'absent', absentReason: 'no-api' }));
    expect(html).toContain('version 2 Autopilot API');
  });

  it('keeps checking copy for the unresolved state', () => {
    expect(renderPanel(fakeController({ availability: 'unknown' }))).toContain(
      'Checking for an autopilot…',
    );
  });

  it('treats a transport failure as its own state with Retry and an honest trust warning', () => {
    const html = renderPanel(fakeController({ availability: 'unreachable' }));
    expect(html).toContain('could not be reached');
    expect(html).toContain('The pilot may still be steering');
    expect(html).toContain('Retry');
    expect(html).not.toContain('Engage autopilot');
  });

  it('asks for access in the shared vocabulary when reads are refused', () => {
    const html = renderPanel(fakeController({ availability: 'auth-required' }));
    expect(html).toContain('requires access approval');
    expect(html).toContain('Request read and write access');
  });

  it('offers Engage with the target nudges disabled on standby, each state named', () => {
    const html = renderPanel(
      fakeController({ engaged: false, pilotState: 'standby', chip: { kind: 'standby' } }),
    );
    expect(html).toContain('Engage autopilot');
    expect(html).not.toContain('Disengage autopilot');
    expect(html).toContain('on standby: hand steering');
    expect(html).toContain('Target changes need the pilot engaged.');
    // The four nudge buttons render but cannot fire while the pilot is not steering.
    expect(
      html.match(/aria-label="(Ten|One) degrees? to (port|starboard)" disabled/g),
    ).toHaveLength(4);
  });

  it('offers Disengage, live status, and enabled nudges while engaged', () => {
    const html = renderPanel(fakeController());
    expect(html).toContain('Disengage autopilot');
    expect(html).not.toContain('Engage autopilot');
    expect(html).toContain('engaged and steering');
    expect(html).toContain('Compass');
    expect(html).toContain('086');
    expect(html).toContain('Tack port');
    expect(html).not.toContain('Gybe port');
    expect(html).not.toMatch(/aria-label="Ten degrees to port" disabled/);
  });

  it('blocks commands and explains the fix when the display is read-only', () => {
    const html = renderPanel(fakeController(), fakeAuth({ writeBlocked: true }));
    expect(html).toContain('read-only access, so autopilot commands are blocked');
    expect(html).toContain('Request read and write access');
    // The disengage control renders but cannot fire.
    expect(html).toContain('disabled="">Disengage autopilot');
  });

  it('renders the steering-mode choice from the provider options with the active mode lit', () => {
    const html = renderPanel(fakeController());
    expect(html).toContain('Steering mode');
    expect(html).toContain('Compass');
    // A three-letter mode name renders as the acronym it is.
    expect(html).toContain('GPS');
    expect(html).toContain('Wind');
    expect(html).toContain('aria-pressed="true"');
  });

  it('shows a device picker only when several pilots are registered', () => {
    expect(renderPanel(fakeController())).not.toContain('Command this pilot');
    const html = renderPanel(
      fakeController({
        devices: [
          { id: 'pypilot', provider: 'a', isDefault: true },
          { id: 'backup', provider: 'b', isDefault: false },
        ],
      }),
    );
    expect(html).toContain('Command this pilot');
    expect(html).toContain('pypilot (default)');
    expect(html).toContain('backup');
  });

  it('carries the advisory safety line in every state', () => {
    for (const availability of ['absent', 'unreachable', 'available'] as const) {
      expect(renderPanel(fakeController({ availability }))).toContain(
        'The helm remains responsible',
      );
    }
  });

  it('surfaces a command failure as an alert', () => {
    const html = renderPanel(
      fakeController({ commandError: 'Could not reach the autopilot to engage it.' }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Could not reach the autopilot to engage it.');
  });
});
