import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import DisplaySettings from './DisplaySettings.svelte';
import type { DisplaySettingsController } from './display-settings.svelte';

function fakeController(
  overrides: Partial<DisplaySettingsController> = {},
): DisplaySettingsController {
  return {
    dim: 0,
    setDim: vi.fn(),
    autoTheme: false,
    setAutoTheme: vi.fn(),
    autoThemeSuspended: false,
    recommendedTheme: undefined,
    textScale: 100,
    setTextScale: vi.fn(),
    ...overrides,
  } as unknown as DisplaySettingsController;
}

function renderSettings(overrides: Partial<DisplaySettingsController> = {}): string {
  return render(DisplaySettings, { props: { controller: fakeController(overrides) } }).body;
}

describe('DisplaySettings', () => {
  it('renders the three sections with their caps headings', () => {
    const body = renderSettings();
    expect(body).toContain('Screen dim');
    expect(body).toContain('Automatic theme');
    expect(body).toContain('Text size');
  });

  it('shows the dim slider with its live percent readout', () => {
    const body = renderSettings({ dim: 0.4 });
    expect(body).toContain('class="range"');
    expect(body).toContain('aria-valuetext="40%"');
    expect(body).toContain('>40%</span>');
    expect(body).toContain('never reaches');
  });

  it('marks the active auto-theme segment and explains the manual hold', () => {
    const off = renderSettings();
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain('pauses auto until the next');
    expect(off).not.toContain('Paused for your theme choice');

    const suspended = renderSettings({ autoTheme: true, autoThemeSuspended: true });
    expect(suspended).toContain('Paused for your theme choice. Auto resumes at the next');
  });

  it('renders the four text-scale steps with the active one lit', () => {
    const body = renderSettings({ textScale: 120 });
    for (const scale of [100, 110, 120, 130]) expect(body).toContain(`${scale}%`);
    expect(body).toContain('touch targets included');
  });
});
