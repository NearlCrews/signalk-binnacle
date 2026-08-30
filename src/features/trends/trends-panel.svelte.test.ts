import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { InstrumentTrendDescriptor } from '$entities/instrument-trend';
import { TrendSessionRecorder } from './session-recorder.svelte';
import TrendCharts from './TrendCharts.svelte';
import TrendsCustomize from './TrendsCustomize.svelte';
import TrendsPanel from './TrendsPanel.svelte';
import type { TrendItem, TrendsController } from './trends-controller.svelte';

function descriptor(id: string, label = id): InstrumentTrendDescriptor {
  return {
    id,
    label,
    description: `${label} description`,
    category: 'navigation',
    candidates: [
      {
        path: `path.${id}`,
        minPeriodMs: 1000,
        staleAfterMs: 10_000,
      },
    ],
    aggregate: 'average',
    display: 'count',
    metricPrecision: 0,
    imperialPrecision: 0,
  };
}

function item(definition: InstrumentTrendDescriptor): TrendItem {
  return {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    category: definition.category,
    descriptor: definition,
    unavailable: false,
    historicalOnly: false,
    hasLiveReport: true,
  };
}

function controller(overrides: Partial<TrendsController> = {}): TrendsController {
  const depth = descriptor('depth', 'Depth');
  const selected = overrides.selected ?? [item(depth)];
  return {
    open: true,
    selectedIds: selected.map((entry) => entry.id),
    selected,
    catalog: selected,
    charts: selected,
    focusedId: undefined,
    focusedTransient: false,
    discovering: false,
    loading: false,
    history: undefined,
    historyState: 'idle',
    providerState: 'absent',
    hasProvider: false,
    recorder: new TrendSessionRecorder(),
    toggle: () => {},
    reorder: () => {},
    setFocus: () => true,
    setOpen: () => {},
    refreshCatalog: () => {},
    refreshHistory: () => {},
    sessionSeries: () => ({ times: [], values: [] }),
    resubscribe: () => {},
    dispose: () => {},
    ...overrides,
  };
}

describe('Trends UI', () => {
  it('shows a profile-owned zero-selection state with a visible Customize action', () => {
    const ctrl = controller({ selectedIds: [], selected: [], charts: [], catalog: [] });
    const body = render(TrendsPanel, {
      props: {
        controller: ctrl,
        onRetryProvider: () => {},
        units: 'metric',
        theme: 'day',
        onClose: () => {},
      },
    }).body;
    expect(body).toContain('No trends are selected for this profile.');
    expect(body).toContain('Customize trends');
  });

  it('keeps a ninth option visible but disabled at the selection limit', () => {
    const definitions = Array.from({ length: 9 }, (_, index) =>
      descriptor(`trend-${index}`, `Trend ${index}`),
    );
    const selected = definitions.slice(0, 8).map(item);
    const ctrl = controller({
      selectedIds: selected.map((entry) => entry.id),
      selected,
      charts: selected,
      catalog: definitions.map(item),
    });
    const body = render(TrendsCustomize, { props: { controller: ctrl } }).body;
    expect(body).toContain('8 of 8 selected');
    expect(body).toContain('Trend 8');
    expect(body).toContain('Remove a trend before adding another.');
    expect(body).toMatch(/type="checkbox"[^>]*disabled/);
  });

  it('renders an unavailable saved selection with a removal control', () => {
    const unavailable: TrendItem = {
      id: 'future-sensor',
      label: 'Unavailable instrument · future-sensor',
      description: 'Unavailable',
      category: 'unavailable',
      unavailable: true,
      historicalOnly: false,
      hasLiveReport: false,
    };
    const body = render(TrendsCustomize, {
      props: {
        controller: controller({
          selectedIds: [unavailable.id],
          selected: [unavailable],
          charts: [unavailable],
          catalog: [],
        }),
      },
    }).body;
    expect(body).toContain('Unavailable instrument · future-sensor');
    expect(body).toContain('Unavailable on this server');
  });

  it('renders a keyboard and touch scrubber plus the five-value text summary', () => {
    const depth = descriptor('depth', 'A very long depth transducer label for a narrow phone');
    const depthItem = item(depth);
    const ctrl = controller({
      selectedIds: ['depth'],
      selected: [depthItem],
      charts: [depthItem],
      sessionSeries: () => ({
        times: [1, 2, 3],
        values: [4, 2, 6],
        path: 'path.depth',
      }),
    });
    const body = render(TrendCharts, {
      props: { controller: ctrl, units: 'metric', theme: 'night-red' },
    }).body;
    expect(body).toContain('type="range"');
    expect(body).toContain('aria-valuetext=');
    expect(body).toContain(
      'aria-label="Browse A very long depth transducer label for a narrow phone history"',
    );
    expect(body).toContain('Latest 6');
    expect(body).toContain('minimum 2');
    expect(body).toContain('maximum 6');
    expect(body).toContain('start 4');
    expect(body).toContain('end 6');
  });

  it('ties the scrubber readout to the scrubber it reports', () => {
    const depth = descriptor('depth', 'Depth');
    const depthItem = item(depth);
    const body = render(TrendCharts, {
      props: {
        controller: controller({
          selectedIds: ['depth'],
          selected: [depthItem],
          charts: [depthItem],
          sessionSeries: () => ({ times: [1, 2, 3], values: [4, 2, 6], path: 'path.depth' }),
        }),
        units: 'metric',
        theme: 'day',
      },
    }).body;

    const inputId = /<input id="([^"]+)"/.exec(body)?.[1];
    expect(inputId).toBeDefined();
    expect(body).toContain(`<output for="${inputId}"`);
  });

  it('names each available category list with its own heading', () => {
    const wind = descriptor('wind-speed', 'Wind speed');
    const body = render(TrendsCustomize, {
      props: {
        controller: controller({
          selectedIds: [],
          selected: [],
          charts: [],
          catalog: [item({ ...wind, category: 'wind' })],
        }),
      },
    }).body;

    const headingId = /<h4[^>]*id="([^"]+)"/.exec(body)?.[1];
    expect(headingId).toBeDefined();
    expect(body).toContain(`aria-labelledby="${headingId}"`);
  });

  it('annotates a chart with the verdict, both extremes, and the net change', () => {
    const depthItem = item(descriptor('depth', 'Depth'));
    const body = render(TrendCharts, {
      props: {
        controller: controller({
          selectedIds: ['depth'],
          selected: [depthItem],
          charts: [depthItem],
          // The count kind calls out both extremes; net +2 clears its noise floor of 1.
          sessionSeries: () => ({ times: [1, 2, 3], values: [4, 2, 6], path: 'path.depth' }),
        }),
        units: 'metric',
        theme: 'day',
      },
    }).body;
    expect(body).toContain('Rising · low 2 · high 6 · net +2');
  });

  it('annotates a min-danger kind with only its low extreme, in display units', () => {
    const depthItem = item({
      ...descriptor('depth', 'Depth'),
      display: 'depth',
      metricPrecision: 1,
    });
    const body = render(TrendCharts, {
      props: {
        controller: controller({
          selectedIds: ['depth'],
          selected: [depthItem],
          charts: [depthItem],
          sessionSeries: () => ({ times: [1, 2, 3], values: [4, 2, 6], path: 'path.depth' }),
        }),
        units: 'metric',
        theme: 'day',
      },
    }).body;
    expect(body).toContain('Rising · low 2.0 m · net +2.0 m');
    expect(body).not.toContain('high 6.0 m');
  });

  it('reads a change inside the noise floor as steady with an unsigned zero net', () => {
    const depthItem = item(descriptor('depth', 'Depth'));
    const body = render(TrendCharts, {
      props: {
        controller: controller({
          selectedIds: ['depth'],
          selected: [depthItem],
          charts: [depthItem],
          sessionSeries: () => ({ times: [1, 2, 3], values: [4, 2, 4.2], path: 'path.depth' }),
        }),
        units: 'metric',
        theme: 'day',
      },
    }).body;
    expect(body).toContain('Steady · low 2 · high 4 · net 0');
  });

  it('states when an unselected focused trend starts its shorter session window', () => {
    const depth = descriptor('depth', 'Depth');
    const depthItem = item(depth);
    const body = render(TrendCharts, {
      props: {
        controller: controller({
          selectedIds: [],
          selected: [],
          charts: [depthItem],
          focusedId: 'depth',
          focusedTransient: true,
        }),
        units: 'metric',
        theme: 'day',
      },
    }).body;
    expect(body).toContain('Focused session started when this trend opened. No samples yet.');
  });

  it('prioritizes the current provider-check failure over a stale history status', () => {
    const body = render(TrendsPanel, {
      props: {
        controller: controller({
          providerState: 'failed',
          historyState: 'partial',
          history: {
            state: 'partial',
            series: new Map([
              [
                'depth',
                {
                  times: [1],
                  values: [4],
                  provider: 'qdb',
                  path: 'path.depth',
                },
              ],
            ]),
            answeredProviders: ['qdb'],
            failedProviders: [],
          },
        }),
        onRetryProvider: () => {},
        units: 'metric',
        theme: 'day',
        onClose: () => {},
      },
    }).body;
    expect(body).toContain(
      'Could not check for a history provider. Accepted history remains visible.',
    );
    expect(body).not.toContain('Some history providers or columns could not be read.');
  });
});
