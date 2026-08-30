import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import DisplayPanel from './DisplayPanel.svelte';
import type { DisplaySettingsController } from './display-settings.svelte';

const controller = {
  dim: 0,
  setDim: vi.fn(),
  autoTheme: false,
  setAutoTheme: vi.fn(),
  autoThemeSuspended: false,
  recommendedTheme: undefined,
  textScale: 100,
  setTextScale: vi.fn(),
} as unknown as DisplaySettingsController;

describe('DisplayPanel', () => {
  it('renders the panel shell, teach line, and settings sections', () => {
    const body = render(DisplayPanel, {
      props: { controller, onClose: vi.fn(), onBack: vi.fn() },
    }).body;
    expect(body).toContain('Display');
    expect(body).toContain('Close display panel');
    expect(body).toContain('Dim the screen for night watches');
    expect(body).toContain('Screen dim');
    expect(body).toContain('Automatic theme');
    expect(body).toContain('Text size');
  });
});
