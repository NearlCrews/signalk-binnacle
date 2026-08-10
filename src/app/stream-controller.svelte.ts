import { withPromiseTimeout } from '$shared/lib';
import type { OnlineStatus } from '$shared/pwa';
import {
  ALL_VESSELS_CONTEXT,
  type ConnectionPhase,
  isConnectionDown,
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
  // Fires on every transition to the open phase with whether this is the session's first open
  // and the current token. This is the one edge tied to the socket actually delivering, so it
  // owns the whole connect-and-reconnect refresh story: a pre-open hydrate would race a
  // still-booting server, and a reconnect-only hook would miss the first open. The firstOpen
  // flag lets replay logic that must wait for the reconnect reconcile on later opens still run
  // immediately on the first.
  onOpen: (firstOpen: boolean, token: string | undefined) => void;
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
  { path: SK_PATHS.depthBelowKeel, policy: 'instant' as const, minPeriod: 1000 },
  { path: SK_PATHS.depthBelowSurface, policy: 'instant' as const, minPeriod: 1000 },
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

// A raw Comlink await against a worker that dies mid-call never settles, so an unbounded await
// would latch `connecting` and block every later connect and reconnect for the session. Generous
// against a busy Pi: these calls are message round-trips, not network waits.
const WORKER_CALL_TIMEOUT_MS = 10_000;

function boundedWorkerCall<T>(call: Promise<T>): Promise<T> {
  return withPromiseTimeout(call, WORKER_CALL_TIMEOUT_MS, 'Signal K worker call timed out');
}

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
  // The token baked into the worker's stream URL, so the token effect below pushes only real
  // changes down. Seeded from the current value: connect() reads the live getter itself, so the
  // effect owes nothing until the token actually changes.
  let streamToken = deps.token();

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
    streamToken = token;
    deps.onToken(token);
    try {
      await boundedWorkerCall(deps.client.connect(streamUrl(token), deps.onFrame));
      await boundedWorkerCall(deps.client.raw.subscribe(SUBSCRIPTIONS));
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
    // A token that changed during the awaits opened this socket on the old grant. The token
    // effect already pushed the new URL to the worker (its reconnect arm was blocked by the
    // connecting latch), so all that is missing is the reopen.
    if (!disposed && currentAttempt === attempt && connected && deps.token() !== token) {
      void reconnectClient();
    }
  }

  async function reconnectClient(): Promise<void> {
    if (connecting || disposed) return;
    connecting = true;
    error = false;
    // The same generation guard connect() carries: onWorkerFailure bumps the attempt and
    // releases the latch while this call may still be outstanding, and its stale rejection
    // (reachable through the bounded timeout) must not error a session a newer attempt healed,
    // nor release a latch that newer attempt owns.
    const currentAttempt = ++attempt;
    try {
      await boundedWorkerCall(deps.client.reconnect());
    } catch (cause) {
      if (disposed || currentAttempt !== attempt) return;
      console.error('Signal K stream failed to reconnect', cause);
      connected = false;
      error = true;
    } finally {
      if (currentAttempt === attempt) connecting = false;
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
    const down = isConnectionDown(phase);
    if (online && !wasOnline && down && !error) void reconnectClient();
    wasOnline = online;
  });

  // A changed token (a read/write upgrade, a cross-tab adoption) must reach the worker's stored
  // stream URL, or every later reconnect reopens with the stale grant: an unauthenticated socket on
  // a secured server opens but delivers nothing, so the badge would read Connected while data
  // silently stops. The live socket is left alone; a stream already down reconnects now so it picks
  // the new credentials up immediately.
  $effect(() => {
    const token = deps.token();
    if (disposed || token === streamToken) return;
    streamToken = token;
    deps.onToken(token);
    void boundedWorkerCall(deps.client.raw.setUrl(streamUrl(token))).catch((cause) => {
      // The push is lost against a dying worker; onWorkerFailure's restart rebuilds the URL from
      // the live getter, so this only needs to be observable, not retried.
      console.warn('Signal K worker did not accept the new stream URL', cause);
    });
    if (isConnectionDown(deps.store.connection.phase)) reconnect();
  });

  $effect(() => {
    const phase = deps.store.connection.phase;
    const opened = phase === 'open' && lastConnectionPhase !== 'open';
    const firstOpen = opened && !everOpen;
    lastConnectionPhase = phase;
    if (phase === 'open') everOpen = true;
    if (opened) {
      // A live open frame proves the worker and socket are healthy. Worker.onerror also fires for
      // non-fatal uncaught exceptions, and that spurious onWorkerFailure must not leave the
      // session latched in the error state (auto-reconnect disabled) while data flows: the
      // synthesized closed frame it emits guarantees this open transition follows.
      error = false;
      connected = true;
      deps.onOpen(firstOpen, deps.token());
    }
  });

  return {
    retry,
    reconnect,
    // The worker died after connect (reported by the client's onerror path), so any in-flight
    // Comlink call will never settle. Invalidate it, release the connecting latch, and enter the
    // error state whose retry restarts the worker; plain reconnect would talk to a corpse.
    onWorkerFailure(): void {
      if (disposed) return;
      attempt += 1;
      connecting = false;
      connected = false;
      error = true;
    },
    dispose(): void {
      disposed = true;
      attempt += 1;
    },
    get error() {
      return error;
    },
  };
}
