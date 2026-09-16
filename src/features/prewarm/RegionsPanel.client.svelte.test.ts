import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RegionsPanel from './RegionsPanel.svelte';

const rectangle = vi.hoisted(() => ({
  start: vi.fn(),
  set: vi.fn(),
  clear: vi.fn(),
  destroy: vi.fn(),
  onFinish: vi.fn(),
}));
vi.mock('./regions-draw.js', () => ({ createRegionRectangle: () => rectangle }));
vi.mock('./regions-client.js', () => ({
  createRegionsClient: () => ({
    getConfig: async () => ({
      enabled: false,
      radiusMeters: 3704,
      moveThresholdMeters: 1852,
      intervalSecs: 60,
      baseZoom: 12,
      sources: ['seamark'],
    }),
    getRegions: async () => [],
    getCacheStats: async () => ({
      rows: 0,
      bytes: 0,
      cap: 1_000_000_000,
      regionsFreeBytes: 1_000_000_000,
      perSourceAvgBytes: {},
    }),
  }),
}));
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.clearAllMocks();
});

function openBuilder() {
  const target = document.createElement('div');
  document.body.append(target);
  const onClose = vi.fn();
  const component = mount(RegionsPanel, {
    target,
    props: {
      adminAccess: true,
      accessState: 'serving',
      accessUrl: 'https://boat.test/admin/',
      companionBase: 'https://boat.test/plugins/signalk-chart-locker',
      map: {
        getBounds: () => ({
          getWest: () => -1,
          getSouth: () => -1,
          getEast: () => 1,
          getNorth: () => 1,
        }),
      } as never,
      units: { mode: 'metric' } as never,
      insecureTransport: false,
      pwaStatus: 'active',
      onClose,
      onOpenCharts: vi.fn(),
      onRetryAccess: vi.fn(),
    },
  });
  cleanups.push(() => {
    void unmount(component);
    target.remove();
  });
  flushSync();
  function click(label: string) {
    const button = [...target.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!button) throw new Error(`Missing button: ${label}`);
    button.click();
    flushSync();
  }
  click('Save a chart area');
  return { target, onClose, click };
}

describe('Offline area input alternatives', () => {
  it('selects a first area through an ordinary button and exposes bounded coordinate adjustment', () => {
    const t = openBuilder();
    t.click('Use current chart view');
    expect(rectangle.start).not.toHaveBeenCalled();
    expect(rectangle.set).toHaveBeenCalledWith([-1, -1, 1, 1]);
    expect(t.target.textContent).toContain('Adjust area coordinates');
    const west = t.target.querySelector<HTMLInputElement>(
      'input[aria-label="West longitude in °"]',
    );
    expect(west?.min).toBe('-180');
    expect(west?.max).toBe('180');
    expect(t.target.textContent).toContain('2. Choose charts and detail');
  });

  it('cancels placement on Escape before dismissing the whole workflow', () => {
    const t = openBuilder();
    t.click('Draw on the chart');
    expect(t.target.textContent).toContain('Cancel selection');
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    flushSync();
    expect(t.onClose).not.toHaveBeenCalled();
    expect(t.target.textContent).toContain('Use current chart view');
    expect(t.target.textContent).not.toContain('Cancel selection');
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(t.onClose).toHaveBeenCalledOnce();
  });
});
