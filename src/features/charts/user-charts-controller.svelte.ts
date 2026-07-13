import { untrack } from 'svelte';
import type { UserChartSource, UserCharts } from '$entities/user-charts';
import { userChartToSignalK } from '$entities/user-charts';
import type { Theme } from '$shared/ui';
import type { UserChartRegistrar } from '$widgets/chart-canvas';
import { deleteChart, putChart } from './charts-client';

export interface UserChartsControllerDeps {
  origin: string;
  getToken: () => string | undefined;
  canWrite: () => boolean;
  onSyncError?: (message: string) => void;
  userCharts: UserCharts;
  recolorMap: (theme: Theme) => void;
  // A getter, not a value: the theme changes over the session, and a chart registered at night
  // must recolor to the night palette, not a construction-time snapshot.
  getTheme: () => Theme;
}

export function createUserChartsController(deps: UserChartsControllerDeps) {
  const { origin, userCharts } = deps;

  let userChartRegistrar = $state<UserChartRegistrar | undefined>();
  const registeredUserCharts = new Set<string>();
  let lastSyncKey: string | undefined;

  function reportSyncError(message: string): void {
    deps.onSyncError?.(message);
  }

  function syncUrlChartToServer(source: UserChartSource): void {
    if (!deps.canWrite()) return;
    const token = deps.getToken();
    void putChart(origin, token, userChartToSignalK(source, source.origin.url)).then((ok) => {
      if (!ok) {
        console.warn(`User chart "${source.id}" did not sync to the server.`);
        reportSyncError('Chart saved on this device, but server sync failed.');
      }
    });
  }

  function dropRegisteredUserChart(id: string): void {
    if (!registeredUserCharts.delete(id)) return;
    userChartRegistrar?.unregister(id);
  }

  function deleteUserChartFromServer(id: string): void {
    if (!deps.canWrite()) return;
    const token = deps.getToken();
    void deleteChart(origin, token, id).then((ok) => {
      if (!ok) reportSyncError('Chart removed on this device, but its server copy may remain.');
    });
  }

  // Re-sync restored URL charts when access resolves or credentials change. `untrack` keeps source
  // additions on their explicit callbacks, avoiding duplicate puts for every local list mutation.
  $effect(() => {
    const canWrite = deps.canWrite();
    const token = deps.getToken();
    const key = `${canWrite}:${token ?? ''}`;
    if (key === lastSyncKey) return;
    lastSyncKey = key;
    if (!canWrite) return;
    for (const source of untrack(() => userCharts.sources)) syncUrlChartToServer(source);
  });

  async function addUserChartOverlay(
    source: UserChartSource,
    registrar: UserChartRegistrar,
  ): Promise<void> {
    try {
      await registrar.register(userChartToSignalK(source, source.origin.url));
    } catch (error) {
      console.error('User chart overlay failed to register', error);
      registeredUserCharts.delete(source.id);
      return;
    }
    if (!registeredUserCharts.has(source.id)) {
      registrar.unregister(source.id);
      return;
    }
    deps.recolorMap(deps.getTheme());
  }

  $effect(() => {
    const registrar = userChartRegistrar;
    const sources = userCharts.sources;
    if (!registrar) return;
    const wanted = new Set(sources.map((source) => source.id));
    for (const id of registeredUserCharts) {
      if (!wanted.has(id)) dropRegisteredUserChart(id);
    }
    for (const source of sources) {
      if (registeredUserCharts.has(source.id)) continue;
      registeredUserCharts.add(source.id);
      void addUserChartOverlay(source, registrar);
    }
  });

  function onUserChartsReady(registrar: UserChartRegistrar): void {
    userChartRegistrar = registrar;
  }

  return {
    onUserChartsReady,
    syncUrlChartToServer,
    dropRegisteredUserChart,
    deleteUserChartFromServer,
  };
}
