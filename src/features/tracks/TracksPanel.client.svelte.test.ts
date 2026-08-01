import { type ComponentProps, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackRecorder } from '$entities/track';
import { PersistedValue } from '$shared/settings';
import type { AuthController } from '$shared/signalk';
import TracksPanel from './TracksPanel.svelte';

const mounted: Array<() => void> = [];

// Two connected points: enough for a drawable track, which is what enables Save.
const points = [
  { lat: 1, lon: 1, t: 0, sog: 1 },
  { lat: 1.001, lon: 1, t: 10_000, sog: 1 },
];

function mountPanel(onSave: (name: string) => Promise<boolean>) {
  const target = document.createElement('div');
  document.body.append(target);
  const recorder = {
    points,
    paused: false,
    stats: { distanceMeters: 100, durationSeconds: 10, avgSog: 1, maxSog: 1 },
    pause: vi.fn(),
    resume: vi.fn(),
    clear: vi.fn(),
  } as unknown as TrackRecorder;
  const props: ComponentProps<typeof TracksPanel> = {
    auth: { writeBlocked: false } as AuthController,
    recorder,
    settings: new PersistedValue('tracks-panel-client-test', {
      intervalSeconds: 10,
      minMeters: 10,
      colorMode: 'speed' as const,
    }),
    saved: [],
    shown: new Set<string>(),
    loadState: 'ready',
    provisioning: 'provisioned',
    busy: false,
    routeBusy: false,
    persistenceDegraded: false,
    onRetry: vi.fn(),
    onSave,
    onSaveAsRoute: vi.fn(async () => true),
    onTrackHome: vi.fn(),
    onDelete: vi.fn(),
    onToggleSaved: vi.fn(),
    onExport: vi.fn(),
    onClose: vi.fn(),
  };
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(TracksPanel, { target, props });
  });
  mounted.push(() => {
    void unmount(component);
    target.remove();
  });
  const click = (label: string): void => {
    const button = [...target.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!button) throw new Error(`no button labeled ${label}`);
    button.click();
    flushSync();
  };
  const nameInput = (): HTMLInputElement | null =>
    target.querySelector<HTMLInputElement>('.name-entry input');
  const submitName = (value: string): void => {
    const input = nameInput();
    if (!input) throw new Error('the name form is not open');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    target.querySelector<HTMLFormElement>('.name-entry')?.requestSubmit();
    flushSync();
  };
  return { target, click, nameInput, submitName };
}

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
});

describe('TracksPanel save naming', () => {
  it('keeps the name form and the entered name when the save fails', async () => {
    let settle!: (saved: boolean) => void;
    const onSave = vi.fn(() => new Promise<boolean>((resolve) => (settle = resolve)));
    const panel = mountPanel(onSave);

    panel.click('Save');
    panel.submitName('Bahamas crossing');
    expect(onSave).toHaveBeenCalledWith('Bahamas crossing');
    // In flight: the form stays put and its controls are inert, so a second submit cannot start
    // another write against the same entry.
    expect(panel.nameInput()?.disabled).toBe(true);

    settle(false);
    await Promise.resolve();
    flushSync();
    // The failure itself is reported on the app-wide toast. What must survive here is the name, so
    // the navigator can retry without retyping it.
    expect(panel.nameInput()?.value).toBe('Bahamas crossing');
  });

  it('closes the name form once the save is accepted', async () => {
    const onSave = vi.fn(async () => true);
    const panel = mountPanel(onSave);

    panel.click('Save');
    panel.submitName('Passage');
    await Promise.resolve();
    flushSync();
    expect(panel.nameInput()).toBeNull();
  });

  it('ignores a second submit while the first write is still in flight', async () => {
    let settle!: (saved: boolean) => void;
    const onSave = vi.fn(() => new Promise<boolean>((resolve) => (settle = resolve)));
    const panel = mountPanel(onSave);

    panel.click('Save');
    panel.submitName('One');
    panel.target.querySelector<HTMLFormElement>('.name-entry')?.requestSubmit();
    flushSync();
    expect(onSave).toHaveBeenCalledOnce();

    settle(true);
    await Promise.resolve();
    flushSync();
  });
});
