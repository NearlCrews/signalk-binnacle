import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACK_NOTE_MS,
  COMPANION_REFRESH_MS,
  createCompanionAiController,
} from './companion-ai-controller.svelte';
import type { CompanionReport, CompanionReportsResult, RunAnalyzerAck } from './companion-client';

function report(analyzerId: string, timestampMs: number | undefined, state = 'nominal') {
  return { analyzerId, message: `${analyzerId} report`, state, timestampMs } as CompanionReport;
}

function controllerWith(overrides: {
  fetchReports?: (origin: string, token: string | undefined) => Promise<CompanionReportsResult>;
  run?: (origin: string, token: string | undefined, analyzerId: string) => Promise<RunAnalyzerAck>;
}) {
  return createCompanionAiController({
    origin: () => 'http://sk',
    token: () => 'tok',
    fetchReports: overrides.fetchReports ?? (async () => ({ state: 'ok', reports: [] })),
    run: overrides.run ?? (async () => ({ kind: 'completed' })),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('companion AI controller', () => {
  it('hydrates newest first and reports availability', async () => {
    const controller = controllerWith({
      fetchReports: async () => ({
        state: 'ok',
        reports: [report('aging', 1_000), report('drift', undefined), report('health', 5_000)],
      }),
    });
    await controller.refresh();
    expect(controller.availability).toBe('available');
    expect(controller.reports.map((entry) => entry.analyzerId)).toEqual([
      'health',
      'aging',
      'drift',
    ]);
  });

  it('clears reports on a real absent branch but retains them through a failure', async () => {
    let answer: CompanionReportsResult = { state: 'ok', reports: [report('health', 1_000)] };
    const controller = controllerWith({ fetchReports: async () => answer });
    await controller.refresh();
    expect(controller.reports).toHaveLength(1);

    answer = { state: 'unavailable' };
    await controller.refresh();
    expect(controller.availability).toBe('unavailable');
    expect(controller.reports).toHaveLength(1);

    answer = { state: 'absent' };
    await controller.refresh();
    expect(controller.availability).toBe('absent');
    expect(controller.reports).toHaveLength(0);
  });

  it('lets the latest refresh win over a slower earlier one', async () => {
    let resolveFirst: ((result: CompanionReportsResult) => void) | undefined;
    const answers: Array<Promise<CompanionReportsResult>> = [
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
      Promise.resolve({ state: 'ok', reports: [report('drift', 2_000)] }),
    ];
    let call = 0;
    const controller = controllerWith({
      fetchReports: () => answers[call++] ?? Promise.resolve({ state: 'unavailable' }),
    });
    const first = controller.refresh();
    await controller.refresh();
    resolveFirst?.({ state: 'ok', reports: [report('stale', 1_000)] });
    await first;
    expect(controller.reports.map((entry) => entry.analyzerId)).toEqual(['drift']);
  });

  it('polls on the cadence between start and stop', async () => {
    const fetchReports = vi.fn(
      async (): Promise<CompanionReportsResult> => ({ state: 'ok', reports: [] }),
    );
    const controller = controllerWith({ fetchReports });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchReports).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(COMPANION_REFRESH_MS);
    expect(fetchReports).toHaveBeenCalledTimes(2);
    controller.stop();
    await vi.advanceTimersByTimeAsync(COMPANION_REFRESH_MS * 3);
    expect(fetchReports).toHaveBeenCalledTimes(2);
  });

  it('serializes run-now per analyzer and surfaces the ack as a timed note', async () => {
    let resolveRun: ((ack: RunAnalyzerAck) => void) | undefined;
    const run = vi.fn(
      (): Promise<RunAnalyzerAck> =>
        new Promise((resolve) => {
          resolveRun = resolve;
        }),
    );
    const controller = controllerWith({ run });
    const running = controller.runNow('health');
    expect(controller.busyAnalyzerIds.has('health')).toBe(true);
    void controller.runNow('health');
    expect(run).toHaveBeenCalledTimes(1);

    resolveRun?.({ kind: 'refused', message: 'daily call budget exhausted' });
    await running;
    expect(controller.busyAnalyzerIds.has('health')).toBe(false);
    expect(controller.ackNoteFor('health')).toBe(
      'The server declined the run: daily call budget exhausted.',
    );
    await vi.advanceTimersByTimeAsync(ACK_NOTE_MS);
    expect(controller.ackNoteFor('health')).toBeUndefined();
  });

  it('refreshes after a synchronously completed run so a fresh report lands now', async () => {
    const fetchReports = vi.fn(
      async (): Promise<CompanionReportsResult> => ({ state: 'ok', reports: [] }),
    );
    const controller = controllerWith({
      fetchReports,
      run: async () => ({ kind: 'completed', message: 'nothing to report' }),
    });
    await controller.runNow('forecast');
    expect(controller.ackNoteFor('forecast')).toBe('Run complete: nothing to report.');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchReports).toHaveBeenCalledTimes(1);
  });

  it('does not refresh after a pending run; the cadence picks the report up instead', async () => {
    const fetchReports = vi.fn(
      async (): Promise<CompanionReportsResult> => ({ state: 'ok', reports: [] }),
    );
    const controller = controllerWith({ fetchReports, run: async () => ({ kind: 'started' }) });
    await controller.runNow('forecast');
    expect(controller.ackNoteFor('forecast')).toBe(
      'Run started. The report updates here when it completes.',
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchReports).not.toHaveBeenCalled();
  });
});
