import { untrack } from 'svelte';
import type { UserChartSource, UserCharts } from '$entities/user-charts';
import {
  shouldShareUserChart,
  userChartNeedsServerDelete,
  userChartToSignalK,
} from '$entities/user-charts';
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
  const mountedUserCharts = new Map<string, UserChartRegistrar>();
  const overlayAttempts = new Map<string, { token: symbol; registrar: UserChartRegistrar }>();
  type ServerIntent =
    | {
        type: 'put';
        source: UserChartSource;
        token: string | undefined;
        failureMessage?: string;
        onSuccess?: () => void;
      }
    | {
        type: 'delete';
        token: string | undefined;
        failureMessage?: string;
        onSuccess?: () => void;
      };
  const pendingServerIntents = new Map<string, ServerIntent>();
  const serverWorkers = new Map<string, Promise<void>>();
  let lastSyncKey: string | undefined;

  function reportSyncError(message: string): void {
    deps.onSyncError?.(message);
  }

  function queueServerIntent(id: string, intent: ServerIntent): void {
    pendingServerIntents.set(id, intent);
    ensureServerWorker(id);
  }

  function ensureServerWorker(id: string): void {
    if (serverWorkers.has(id)) return;
    const worker = drainServerIntents(id).finally(() => {
      if (serverWorkers.get(id) === worker) serverWorkers.delete(id);
      // An intent can arrive after the drain loop observes an empty queue but before this finally
      // callback runs. Start a successor instead of leaving that last intent stranded.
      if (pendingServerIntents.has(id)) ensureServerWorker(id);
    });
    serverWorkers.set(id, worker);
  }

  async function drainServerIntents(id: string): Promise<void> {
    for (;;) {
      const intent = pendingServerIntents.get(id);
      if (!intent) return;
      pendingServerIntents.delete(id);
      let ok = false;
      try {
        ok =
          intent.type === 'put'
            ? await putChart(
                origin,
                intent.token,
                userChartToSignalK(intent.source, intent.source.origin.url),
              )
            : await deleteChart(origin, intent.token, id);
      } catch {
        ok = false;
      }
      // A newer intent already supersedes this outcome. Only the final desired server state should
      // surface an error, and the loop still executes that newer PUT or DELETE in order.
      const superseded = pendingServerIntents.has(id);
      if (ok && !superseded) intent.onSuccess?.();
      if (!ok && !superseded) {
        if (intent.type === 'put') {
          console.warn(`User chart "${id}" did not sync to the server.`);
          reportSyncError(
            intent.failureMessage ?? 'Chart saved on this device, but server sync failed.',
          );
        } else {
          reportSyncError(
            intent.failureMessage ??
              'Chart removed on this device, but its server copy may remain.',
          );
        }
      }
    }
  }

  function syncUrlChartToServer(source: UserChartSource): void {
    if (!shouldShareUserChart(source) || !deps.canWrite()) return;
    queueServerIntent(source.id, { type: 'put', source, token: deps.getToken() });
  }

  function dropRegisteredUserChart(id: string): void {
    const attempt = overlayAttempts.get(id);
    if (attempt) {
      overlayAttempts.delete(id);
      attempt.registrar.unregister(id);
    }
    const mountedRegistrar = mountedUserCharts.get(id);
    if (mountedRegistrar) {
      mountedUserCharts.delete(id);
      if (mountedRegistrar !== attempt?.registrar) mountedRegistrar.unregister(id);
    }
  }

  function deleteUserChartFromServer(source: UserChartSource): void {
    if (!userChartNeedsServerDelete(source) || !deps.canWrite()) return;
    queueServerIntent(source.id, { type: 'delete', token: deps.getToken() });
  }

  async function replaceUserChartOverlay(
    previous: UserChartSource,
    replacement: UserChartSource,
  ): Promise<void> {
    if (previous.id !== replacement.id) throw new Error('Chart identifiers do not match.');
    const registrar = userChartRegistrar;
    if (!registrar || mountedUserCharts.get(previous.id) !== registrar) return;
    await registrar.replace(userChartToSignalK(replacement, replacement.origin.url));
    mountedUserCharts.set(replacement.id, registrar);
    deps.recolorMap(deps.getTheme());
  }

  function handleUserChartTransition(
    previous: UserChartSource,
    replacement: UserChartSource,
  ): void {
    if (!deps.canWrite()) return;
    if (shouldShareUserChart(replacement)) {
      queueServerIntent(replacement.id, {
        type: 'put',
        source: replacement,
        token: deps.getToken(),
        failureMessage:
          'Chart saved on this device, but the Signal K server still has the previous source.',
      });
      return;
    }
    if (!userChartNeedsServerDelete(previous)) return;
    queueServerIntent(replacement.id, {
      type: 'delete',
      token: deps.getToken(),
      failureMessage:
        'Chart saved on this device, but its previous Signal K server copy may remain.',
      onSuccess: () => userCharts.markServerClean(replacement.id),
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
    token: symbol,
  ): Promise<void> {
    try {
      await registrar.register(userChartToSignalK(source, source.origin.url));
    } catch (error) {
      if (overlayAttempts.get(source.id)?.token !== token) return;
      overlayAttempts.delete(source.id);
      console.error('User chart overlay failed to register', error);
      return;
    }
    const current = overlayAttempts.get(source.id);
    if (
      current?.token !== token ||
      current.registrar !== registrar ||
      userChartRegistrar !== registrar
    ) {
      // Do not let a stale completion unregister a newer same-id attempt on the same manager. The
      // manager's cancellation token cleans the old add before starting its replacement. With no
      // replacement, unregister remains the final safety cleanup.
      const newerUsesRegistrar =
        overlayAttempts.get(source.id)?.registrar === registrar ||
        mountedUserCharts.get(source.id) === registrar;
      if (!newerUsesRegistrar) registrar.unregister(source.id);
      return;
    }
    overlayAttempts.delete(source.id);
    mountedUserCharts.set(source.id, registrar);
    deps.recolorMap(deps.getTheme());
  }

  function reconcileUserChartOverlays(): void {
    const registrar = userChartRegistrar;
    const sources = userCharts.sources;
    if (!registrar) return;
    const wanted = new Set(sources.map((source) => source.id));
    for (const id of new Set([...mountedUserCharts.keys(), ...overlayAttempts.keys()])) {
      if (!wanted.has(id)) dropRegisteredUserChart(id);
    }
    for (const source of sources) {
      if (mountedUserCharts.has(source.id) || overlayAttempts.has(source.id)) continue;
      const token = Symbol(source.id);
      overlayAttempts.set(source.id, { token, registrar });
      void addUserChartOverlay(source, registrar, token);
    }
  }

  $effect(() => {
    reconcileUserChartOverlays();
  });

  function onUserChartsReady(registrar: UserChartRegistrar): void {
    if (userChartRegistrar && userChartRegistrar !== registrar) {
      for (const id of new Set([...mountedUserCharts.keys(), ...overlayAttempts.keys()])) {
        dropRegisteredUserChart(id);
      }
    }
    userChartRegistrar = registrar;
    // The registrar arrives from the map after startup. Reconcile immediately as well as reactively
    // so registration does not depend on a later state invalidation.
    reconcileUserChartOverlays();
  }

  return {
    onUserChartsReady,
    syncUrlChartToServer,
    dropRegisteredUserChart,
    deleteUserChartFromServer,
    replaceUserChartOverlay,
    handleUserChartTransition,
  };
}
