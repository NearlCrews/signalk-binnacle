import type { OnlineStatus } from '$shared/pwa';
import {
  ALL_VESSELS_CONTEXT,
  type ConnectionPhase,
  type Path,
  type SignalKClient,
  type SignalKStore,
  SK_PATHS,
  streamUrl,
} from '$shared/signalk';

interface StreamControllerDeps {
  client: SignalKClient;
  store: SignalKStore;
  net: OnlineStatus;
  accessResolved: () => boolean;
  token: () => string | undefined;
  onToken: (token: string | undefined) => void;
  onFrame: Parameters<SignalKClient['connect']>[1];
  onInitialSubscription: () => Promise<void>;
  onReconnect: (token: string | undefined) => void;
  onWorkerRestart?: () => void;
}

const SUBSCRIPTIONS = [
  { path: 'radars.*.controls.*' as Path, policy: 'instant' as const, minPeriod: 200 },
  { path: SK_PATHS.headingTrue, policy: 'instant' as const, minPeriod: 200 },
  { path: SK_PATHS.position, policy: 'instant' as const, minPeriod: 1000 },
  { path: SK_PATHS.courseOverGroundTrue, policy: 'instant' as const, minPeriod: 1000 },
  { path: SK_PATHS.speedOverGround, policy: 'instant' as const, minPeriod: 1000 },
  { path: SK_PATHS.courseNextPoint, policy: 'instant' as const, minPeriod: 1000 },
  { path: SK_PATHS.coursePreviousPoint, policy: 'instant' as const, minPeriod: 1000 },
  { path: SK_PATHS.courseActiveRoute, policy: 'instant' as const, minPeriod: 1000 },
  { path: SK_PATHS.courseArrivalCircle, policy: 'instant' as const, minPeriod: 1000 },
  { path: SK_PATHS.courseCalcValuesAll, policy: 'instant' as const, minPeriod: 1000 },
  { path: SK_PATHS.depthBelowTransducer, policy: 'instant' as const, minPeriod: 1000 },
  { path: SK_PATHS.windSpeedApparent, policy: 'instant' as const, minPeriod: 1000 },
  { path: SK_PATHS.outsidePressure, policy: 'instant' as const, minPeriod: 5000 },
  { path: SK_PATHS.anchorPosition, policy: 'instant' as const, minPeriod: 1000 },
  { path: SK_PATHS.anchorMaxRadius, policy: 'instant' as const, minPeriod: 1000 },
  { path: SK_PATHS.allNotifications, policy: 'instant' as const, minPeriod: 1000 },
  {
    path: SK_PATHS.position,
    context: ALL_VESSELS_CONTEXT,
    policy: 'fixed' as const,
    period: 5000,
  },
  {
    path: SK_PATHS.courseOverGroundTrue,
    context: ALL_VESSELS_CONTEXT,
    policy: 'fixed' as const,
    period: 5000,
  },
  {
    path: SK_PATHS.speedOverGround,
    context: ALL_VESSELS_CONTEXT,
    policy: 'fixed' as const,
    period: 5000,
  },
  {
    path: SK_PATHS.headingTrue,
    context: ALL_VESSELS_CONTEXT,
    policy: 'fixed' as const,
    period: 5000,
  },
  {
    path: SK_PATHS.name,
    context: ALL_VESSELS_CONTEXT,
    policy: 'fixed' as const,
    period: 5000,
  },
  {
    path: SK_PATHS.aisShipType,
    context: ALL_VESSELS_CONTEXT,
    policy: 'fixed' as const,
    period: 5000,
  },
  {
    path: SK_PATHS.closestApproach,
    context: ALL_VESSELS_CONTEXT,
    policy: 'fixed' as const,
    period: 5000,
  },
  {
    path: SK_PATHS.navigationState,
    context: ALL_VESSELS_CONTEXT,
    policy: 'fixed' as const,
    period: 5000,
  },
];

// Owns the Signal K worker connection, fixed subscriptions, reconnect hydration, and initial-failure
// recovery. Feature-specific refreshes stay injected, keeping this app-level controller below the
// composition root without making shared Signal K code import feature slices.
export function createStreamController(deps: StreamControllerDeps) {
  let connected = false;
  let connecting = false;
  let error = $state(false);
  let disposed = false;
  let attempt = 0;
  let everOpen = false;
  let lastConnectionPhase: ConnectionPhase | undefined;
  let wasOnline = deps.net.online;

  async function connect(restartWorker = false): Promise<void> {
    if (connecting || disposed || !deps.accessResolved()) return;
    connecting = true;
    error = false;
    const currentAttempt = ++attempt;
    if (restartWorker) {
      deps.client.restart();
      deps.onWorkerRestart?.();
    }
    const token = deps.token();
    deps.onToken(token);
    try {
      await deps.client.connect(streamUrl(token), deps.onFrame);
      await deps.client.raw.subscribe(SUBSCRIPTIONS);
      await deps.onInitialSubscription();
      if (disposed || currentAttempt !== attempt) return;
      connected = true;
    } catch (cause) {
      if (disposed || currentAttempt !== attempt) return;
      console.error('Signal K stream failed to connect', cause);
      connected = false;
      error = true;
    } finally {
      if (currentAttempt === attempt) connecting = false;
    }
  }

  async function reconnectClient(): Promise<void> {
    if (connecting || disposed) return;
    connecting = true;
    error = false;
    try {
      await deps.client.reconnect();
    } catch (cause) {
      if (disposed) return;
      console.error('Signal K stream failed to reconnect', cause);
      connected = false;
      error = true;
    } finally {
      connecting = false;
    }
  }

  function retry(): void {
    connected = false;
    error = false;
    void connect(true);
  }

  function reconnect(): void {
    if (error) retry();
    else void reconnectClient();
  }

  $effect(() => {
    if (!deps.accessResolved() || connected || connecting || error) return;
    void connect();
  });

  $effect(() => {
    const online = deps.net.online;
    const phase = deps.store.connection.phase;
    const down = phase === 'reconnecting' || phase === 'closed';
    if (online && !wasOnline && down && !error) void reconnectClient();
    wasOnline = online;
  });

  $effect(() => {
    const phase = deps.store.connection.phase;
    const reconnected = phase === 'open' && lastConnectionPhase !== 'open' && everOpen;
    lastConnectionPhase = phase;
    if (phase === 'open') everOpen = true;
    if (reconnected) deps.onReconnect(deps.token());
  });

  return {
    retry,
    reconnect,
    dispose(): void {
      disposed = true;
      attempt += 1;
    },
    get error() {
      return error;
    },
  };
}
