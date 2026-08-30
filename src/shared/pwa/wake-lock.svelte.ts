// Holds a screen wake lock while an armed watch wants the display alive: a locked phone kills
// audio and visuals together, the one gap the worker-timer background design does not cover.
// The API exists only in a secure context, so over plain HTTP this reports unsupported and the
// caller surfaces the degrade instead of silently doing nothing.
export type WakeLockState = 'unsupported' | 'idle' | 'held' | 'failed';

interface WakeLockDeps {
  // Reactive: true while any armed watch or active alarm wants the screen held awake.
  wanted: () => boolean;
  // Injected for tests; defaults to the browser API.
  request?: () => Promise<WakeLockSentinel>;
  supported?: boolean;
}

export function createWakeLockHolder(deps: WakeLockDeps) {
  const supported = deps.supported ?? (typeof navigator !== 'undefined' && 'wakeLock' in navigator);
  let state = $state<WakeLockState>(supported ? 'idle' : 'unsupported');
  let sentinel: WakeLockSentinel | undefined;
  let generation = 0;
  let disposed = false;

  const request = deps.request ?? (() => navigator.wakeLock.request('screen'));

  async function acquire(mine: number): Promise<void> {
    try {
      const lock = await request();
      if (disposed || mine !== generation || !deps.wanted()) {
        void Promise.resolve(lock.release()).catch(() => undefined);
        return;
      }
      sentinel = lock;
      state = 'held';
      // The browser releases the lock itself when the page hides or the battery saver kicks in;
      // the visibility handler re-acquires on return, so held must not read as permanent.
      lock.addEventListener(
        'release',
        () => {
          if (disposed || mine !== generation) return;
          sentinel = undefined;
          if (state === 'held') state = 'idle';
        },
        { once: true },
      );
    } catch {
      if (disposed || mine !== generation) return;
      // Refused (battery saver, platform policy): sticky until the want or visibility next
      // changes, so a denied request is visible rather than retried in a loop.
      state = 'failed';
    }
  }

  function releaseHeld(): void {
    generation += 1;
    const held = sentinel;
    sentinel = undefined;
    if (held) void Promise.resolve(held.release()).catch(() => undefined);
    if (state !== 'unsupported') state = 'idle';
  }

  function sync(): void {
    if (!supported || disposed) return;
    const want = deps.wanted();
    if (want && sentinel === undefined && document.visibilityState === 'visible') {
      void acquire(++generation);
    } else if (!want && sentinel !== undefined) {
      releaseHeld();
    }
  }

  $effect(() => {
    deps.wanted();
    sync();
  });

  const onVisibility = () => sync();
  if (supported && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
  }

  return {
    get state(): WakeLockState {
      return state;
    },
    dispose(): void {
      if (supported && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      releaseHeld();
      disposed = true;
    },
  };
}
