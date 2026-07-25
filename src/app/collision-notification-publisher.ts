import type { SkNotification } from '$features/lookout';
import {
  postNotification,
  resolveNotification,
  type UpdateNotificationResult,
  updateNotification,
} from '$shared/signalk';

export interface CollisionNotificationPublisherDeps {
  origin: string;
  token: () => string | undefined;
  apiAvailable: () => boolean;
  publishDelta: (path: string, value: SkNotification) => void;
  post?: typeof postNotification;
  resolve?: typeof resolveNotification;
  update?: typeof updateNotification;
}

interface PendingNotification {
  path: string;
  value: SkNotification;
}

// Serializes collision notification mutations and coalesces queued assessments to the newest one.
// A clear therefore always runs after the raise or update it superseded, even on a slow server.
export function createCollisionNotificationPublisher(deps: CollisionNotificationPublisherDeps) {
  const post = deps.post ?? postNotification;
  const resolve = deps.resolve ?? resolveNotification;
  const update = deps.update ?? updateNotification;
  let alertId: string | undefined;
  let deltaActive = false;
  let pending: PendingNotification | undefined;
  let activeDrain: Promise<void> | undefined;
  let disposed = false;

  async function apply({ path, value }: PendingNotification): Promise<void> {
    if (!deps.apiAvailable()) {
      deps.publishDelta(path, value);
      deltaActive = value.state !== 'normal';
      return;
    }

    const token = deps.token();
    if (value.state === 'normal') {
      let resolved = true;
      if (alertId) {
        resolved = await resolve(deps.origin, token, alertId);
        if (disposed) return;
        if (resolved) alertId = undefined;
      }
      if (!resolved || deltaActive) deps.publishDelta(path, value);
      deltaActive = false;
      return;
    }

    if (alertId) {
      const result: UpdateNotificationResult = await update(deps.origin, token, alertId, {
        state: value.state,
        message: value.message,
      });
      if (disposed) return;
      if (result === 'updated') {
        deltaActive = false;
        return;
      }
      if (result === 'failed') {
        deps.publishDelta(path, value);
        deltaActive = true;
        return;
      }
      alertId = undefined;
    }

    const postedId = await post(deps.origin, token, {
      state: value.state,
      message: value.message,
      path: 'navigation.collision',
      includePosition: true,
      includeCreatedAt: true,
    });
    if (disposed) return;
    if (postedId) {
      alertId = postedId;
      deltaActive = false;
    } else {
      deps.publishDelta(path, value);
      deltaActive = true;
    }
  }

  async function drain(): Promise<void> {
    try {
      while (pending && !disposed) {
        const next = pending;
        pending = undefined;
        await apply(next);
      }
    } finally {
      // Clear the active marker in the drain's own continuation. This leaves no microtask window
      // where a new publication can attach to a completed promise while its work starts separately.
      const restart = pending && !disposed ? pending : undefined;
      activeDrain = undefined;
      if (restart) void publish(restart.path, restart.value);
    }
  }

  function publish(path: string, value: SkNotification): Promise<void> {
    if (disposed) return Promise.resolve();
    pending = { path, value };
    if (!activeDrain) activeDrain = drain();
    return activeDrain;
  }

  return {
    publish,
    dispose(): void {
      disposed = true;
      pending = undefined;
    },
    get alertId(): string | undefined {
      return alertId;
    },
  };
}
