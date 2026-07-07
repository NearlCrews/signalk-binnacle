import type { UserChartSource, UserCharts } from '$entities/user-charts';
import { userChartToSignalK } from '$entities/user-charts';
import type { Theme } from '$shared/ui';
import type { UserChartRegistrar } from '$widgets/chart-canvas';
import { deleteChart, putChart } from './charts-client';

export interface UserChartsControllerDeps {
  origin: string;
  getToken: () => string | undefined;
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

  function syncUrlChartToServer(source: UserChartSource): void {
    const token = deps.getToken();
    if (token) {
      void putChart(origin, token, userChartToSignalK(source, source.origin.url)).then((ok) => {
        if (!ok) console.warn(`User chart "${source.id}" did not sync to the server.`);
      });
    }
  }

  function dropRegisteredUserChart(id: string): void {
    if (!registeredUserCharts.delete(id)) return;
    userChartRegistrar?.unregister(id);
  }

  function deleteUserChartFromServer(id: string): void {
    const token = deps.getToken();
    if (token) void deleteChart(origin, token, id);
  }

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
