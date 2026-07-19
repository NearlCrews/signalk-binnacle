import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type UserChartSource, UserCharts } from '$entities/user-charts';
import type { UserChartRegistrar } from '$widgets/chart-canvas';
import * as chartsClient from './charts-client';
import { createUserChartsController } from './user-charts-controller.svelte';

vi.mock('./charts-client', () => ({
  deleteChart: vi.fn(),
  putChart: vi.fn(),
}));

function source(url: string, shareWithServer?: boolean): UserChartSource {
  return {
    id: 'chart-1',
    name: 'Harbor chart',
    kind: 'vector',
    origin: { type: 'url', url },
    ...(shareWithServer === undefined ? {} : { shareWithServer }),
  };
}

function setup() {
  let canWrite = false;
  const controller = createUserChartsController({
    origin: 'http://signalk.local',
    getToken: () => 'token',
    canWrite: () => canWrite,
    userCharts: new UserCharts([], () => {}),
    recolorMap: vi.fn(),
    getTheme: () => 'day',
  });
  canWrite = true;
  return controller;
}

describe('createUserChartsController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(chartsClient.putChart).mockResolvedValue(true);
    vi.mocked(chartsClient.deleteChart).mockResolvedValue(true);
  });

  it('does not send a local-only signed URL to the Signal K server', () => {
    const controller = setup();

    controller.syncUrlChartToServer(
      source('https://charts.example/chart.pmtiles?access_token=secret'),
    );

    expect(chartsClient.putChart).not.toHaveBeenCalled();
  });

  it('syncs ordinary URLs and signed URLs the user explicitly chose to share', async () => {
    const controller = setup();

    controller.syncUrlChartToServer(source('https://charts.example/public.pmtiles'));
    controller.syncUrlChartToServer(
      source('https://charts.example/signed.pmtiles?signature=secret', true),
    );

    await vi.waitFor(() => expect(chartsClient.putChart).toHaveBeenCalledTimes(2));
  });

  it('removes a legacy server copy by opaque id without disclosing its local-only URL', () => {
    const controller = setup();
    const chart = {
      ...source('https://charts.example/chart.pmtiles?access_token=secret', false),
      serverCleanupRequired: true,
    };

    controller.deleteUserChartFromServer(chart);

    expect(chartsClient.deleteChart).toHaveBeenCalledWith(
      'http://signalk.local',
      'token',
      chart.id,
    );
    expect(chartsClient.deleteChart).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringContaining('access_token'),
    );
  });

  it('does not delete a local-only chart that never had a server copy', () => {
    const controller = setup();

    controller.deleteUserChartFromServer(
      source('https://charts.example/chart.pmtiles?access_token=secret', false),
    );

    expect(chartsClient.deleteChart).not.toHaveBeenCalled();
  });

  it('deletes an explicitly shared chart from the server', () => {
    const controller = setup();
    const chart = source('https://charts.example/public.pmtiles', true);

    controller.deleteUserChartFromServer(chart);

    expect(chartsClient.deleteChart).toHaveBeenCalledWith(
      'http://signalk.local',
      'token',
      chart.id,
    );
  });

  it('serializes a delete after an in-flight put so removal remains the final server state', async () => {
    let finishPut = (_ok: boolean) => {};
    vi.mocked(chartsClient.putChart).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishPut = resolve;
        }),
    );
    const controller = setup();
    const chart = source('https://charts.example/public.pmtiles', true);

    controller.syncUrlChartToServer(chart);
    controller.deleteUserChartFromServer(chart);

    expect(chartsClient.putChart).toHaveBeenCalledTimes(1);
    expect(chartsClient.deleteChart).not.toHaveBeenCalled();
    finishPut(true);
    await vi.waitFor(() => expect(chartsClient.deleteChart).toHaveBeenCalledTimes(1));
    expect(vi.mocked(chartsClient.putChart).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(chartsClient.deleteChart).mock.invocationCallOrder[0],
    );
  });

  it('collapses queued renames so the newest chart descriptor is written last', async () => {
    let finishFirstPut = (_ok: boolean) => {};
    vi.mocked(chartsClient.putChart).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishFirstPut = resolve;
        }),
    );
    const controller = setup();
    const oldChart = source('https://charts.example/public.pmtiles', true);
    const renamed = { ...oldChart, name: 'Newest name' };

    controller.syncUrlChartToServer(oldChart);
    controller.syncUrlChartToServer({ ...oldChart, name: 'Intermediate name' });
    controller.syncUrlChartToServer(renamed);

    expect(chartsClient.putChart).toHaveBeenCalledTimes(1);
    finishFirstPut(true);
    await vi.waitFor(() => expect(chartsClient.putChart).toHaveBeenCalledTimes(2));
    expect(vi.mocked(chartsClient.putChart).mock.calls[1][2].name).toBe('Newest name');
  });

  it('ignores a stale overlay completion after a same-id rename starts a replacement', async () => {
    let controller!: ReturnType<typeof createUserChartsController>;
    const chart = source('https://charts.example/public.pmtiles', false);
    const charts = new UserCharts(
      [chart],
      () => {},
      undefined,
      undefined,
      (renamed) => controller.dropRegisteredUserChart(renamed.id),
    );
    const recolorMap = vi.fn();
    controller = createUserChartsController({
      origin: 'http://signalk.local',
      getToken: () => undefined,
      canWrite: () => false,
      userCharts: charts,
      recolorMap,
      getTheme: () => 'day',
    });
    let finishFirstRegistration = () => {};
    const register = vi
      .fn<UserChartRegistrar['register']>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishFirstRegistration = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const unregister = vi.fn<UserChartRegistrar['unregister']>();
    const registrar = { register, unregister };
    controller.onUserChartsReady(registrar);
    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(1));

    charts.rename(chart.id, 'Renamed chart');
    controller.onUserChartsReady(registrar);
    await tick();
    expect(register).toHaveBeenCalledTimes(2);
    expect(unregister).toHaveBeenCalledTimes(1);

    finishFirstRegistration();
    await tick();
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(recolorMap).toHaveBeenCalledTimes(1);
  });
});
