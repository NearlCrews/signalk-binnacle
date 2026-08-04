import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { UnitsStore } from '$entities/units';
import HistoryStrip from './HistoryStrip.svelte';
import type { loadTimeTravelHistory, TimeTravelData } from './time-travel-client';
import { createTimeTravelController } from './time-travel-controller.svelte';
import { timeTravelPreset } from './time-travel-presets';

const provider = { ids: ['provider-a'] };

function data(rangeId: '24h' | '7d' = '24h'): TimeTravelData {
  const from = Date.UTC(2026, 6, 27, 12);
  const to = from + timeTravelPreset(rangeId).durationSeconds * 1000;
  return {
    provider: 'provider-a',
    preset: timeTravelPreset(rangeId),
    from,
    to,
    samples: [
      { t: from, lon: -82.7, lat: 27.7, depth: 3, windApparent: 5, pressure: 101_325 },
      { t: to, lon: -82.6, lat: 27.8, depth: 4, windApparent: 6, pressure: 101_200 },
    ],
  };
}

function makeController(
  load: typeof loadTimeTravelHistory,
  reducedMotion = false,
): ReturnType<typeof createTimeTravelController> {
  return createTimeTravelController(
    'http://example.test',
    () => undefined,
    () => provider,
    {
      load,
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
      getDocument: () => undefined,
      getMotionSource: () => ({
        matches: reducedMotion,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    },
  );
}

function strip(controller: ReturnType<typeof createTimeTravelController>): string {
  return render(HistoryStrip, {
    props: {
      controller,
      units: { mode: 'metric' } as UnitsStore,
      onExit: vi.fn(),
    },
  }).body.replaceAll(/\s+/g, ' ');
}

describe('HistoryStrip', () => {
  it('renders bounded ranges, playback controls, a full date, and provider attribution', async () => {
    const controller = makeController(
      vi.fn<typeof loadTimeTravelHistory>().mockResolvedValue(data()),
    );
    await controller.enter();

    const body = strip(controller);

    expect(body).toContain('aria-label="Time travel"');
    expect(body).toContain('>1 h</button>');
    expect(body).toContain('>6 h</button>');
    expect(body).toContain('>24 h</button>');
    expect(body).toContain('>7 d</button>');
    expect(body).toContain('aria-label="Play history"');
    expect(body).toContain('Playback speed');
    expect(body).toContain('>Slow</button>');
    expect(body).toContain('>Normal</button>');
    expect(body).toContain('>Fast</button>');
    expect(body).toContain('aria-label="Slow playback, 0.5 times real time"');
    expect(body).toContain('aria-label="Fast playback, 2 times real time"');
    expect(body).toContain('2026');
    expect(body).toContain('Source: <span class="num">provider-a</span>');
    controller.dispose();
  });

  it('explains reduced motion and disables automatic playback controls', async () => {
    const controller = makeController(
      vi.fn<typeof loadTimeTravelHistory>().mockResolvedValue(data()),
      true,
    );
    await controller.enter();

    const body = strip(controller);

    expect(body).toContain('Automatic playback is off because reduced motion is enabled.');
    expect(body).toMatch(/aria-label="Play history" aria-describedby="[^"]+" disabled/);
    expect(body).toMatch(/aria-pressed="true"[^>]*disabled[^>]*>Normal/);
    controller.dispose();
  });

  it('links every reduced-motion-disabled control to the one explanation', async () => {
    const controller = makeController(
      vi.fn<typeof loadTimeTravelHistory>().mockResolvedValue(data()),
      true,
    );
    await controller.enter();

    const body = strip(controller);
    const described = /aria-label="Play history" aria-describedby="([^"]+)"/.exec(body)?.[1];

    expect(described).toBeDefined();
    // The explanation paragraph carries that id, and the speed group points at the same one.
    expect(body).toContain(`id="${described}"`);
    expect([...body.matchAll(new RegExp(`aria-describedby="${described}"`, 'g'))]).toHaveLength(2);
    controller.dispose();
  });

  it('names the jump-to-newest control for what it does, not for live data', async () => {
    const controller = makeController(
      vi.fn<typeof loadTimeTravelHistory>().mockResolvedValue(data()),
    );
    await controller.enter();

    const body = strip(controller);

    expect(body).toContain('>Latest</button>');
    expect(body).not.toContain('>Now</button>');
    controller.dispose();
  });

  it('keeps the accepted range visible and names a failed requested range', async () => {
    const load = vi
      .fn<typeof loadTimeTravelHistory>()
      .mockResolvedValueOnce(data())
      .mockResolvedValueOnce(undefined);
    const controller = makeController(load);
    await controller.enter();
    await controller.setRange('7d');

    const body = strip(controller);

    expect(body).toContain('role="alert"');
    expect(body).toContain('Could not load 7 days. Showing 24 hours.');
    expect(body).toContain('Source: <span class="num">provider-a</span>');
    controller.dispose();
  });

  it('disables automatic playback when only one accepted sample exists', async () => {
    const oneSample = data();
    oneSample.samples = [oneSample.samples[0]];
    oneSample.to = oneSample.from;
    const controller = makeController(
      vi.fn<typeof loadTimeTravelHistory>().mockResolvedValue(oneSample),
    );
    await controller.enter();

    const body = strip(controller);

    expect(body).toMatch(/aria-label="Play history" disabled/);
    controller.dispose();
  });
});
