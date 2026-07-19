import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type UserChartSource, UserCharts } from '$entities/user-charts';
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

  it('syncs ordinary URLs and signed URLs the user explicitly chose to share', () => {
    const controller = setup();

    controller.syncUrlChartToServer(source('https://charts.example/public.pmtiles'));
    controller.syncUrlChartToServer(
      source('https://charts.example/signed.pmtiles?signature=secret', true),
    );

    expect(chartsClient.putChart).toHaveBeenCalledTimes(2);
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
});
