import { NOTIFICATION_PATH, type SkNotification } from '$features/lookout';
import {
  isSoundingNotification,
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
  // A REST notification id we could not resolve because the API went away mid-flight. Cleared on the
  // next successful API interaction so the v2 notification object does not linger server-side.
  let orphanedAlertId: string | undefined;
  let deltaActive = false;
  let pending: PendingNotification | undefined;
  let activeDrain: Promise<void> | undefined;
  let disposed = false;

  // Resolve the active REST notification and clear its id on success. 'disposed' aborts the
  // caller; false means the server refused and the id survives for a later retry.
  async function resolveActiveAlert(token: string | undefined): Promise<'disposed' | boolean> {
    if (!alertId) return true;
    const resolved = await resolve(deps.origin, token, alertId);
    if (disposed) return 'disposed';
    if (resolved) alertId = undefined;
    return resolved;
  }

  // A successful REST write supersedes any outstanding non-normal v1 delta (a warn that escalated,
  // or an alarm carried by delta through an API outage). Retract it, or the ws-source value stays
  // pinned at the older grade after the later clear skips the delta path.
  function retractDelta(path: string, value: SkNotification): void {
    if (!deltaActive) return;
    deps.publishDelta(path, { ...value, state: 'normal' });
    deltaActive = false;
  }

  async function apply({ path, value }: PendingNotification): Promise<void> {
    if (!deps.apiAvailable()) {
      // The API is gone while a REST notification is still raised: we cannot resolve it now, so
      // remember it and clear it on the next successful API interaction, falling back to the delta.
      if (alertId) {
        orphanedAlertId = alertId;
        alertId = undefined;
      }
      deps.publishDelta(path, value);
      deltaActive = value.state !== 'normal';
      return;
    }

    const token = deps.token();

    // Clear a REST notification orphaned by an earlier outage now that the API answers again. Keep it
    // on failure so a later interaction retries rather than leaking the server-side object.
    if (orphanedAlertId) {
      const cleared = await resolve(deps.origin, token, orphanedAlertId);
      if (disposed) return;
      if (cleared) orphanedAlertId = undefined;
    }

    if (value.state === 'normal') {
      const resolved = await resolveActiveAlert(token);
      if (resolved === 'disposed') return;
      if (resolved !== true || deltaActive) deps.publishDelta(path, value);
      deltaActive = false;
      return;
    }

    // The server's v2 notifications raise hardcodes method [visual, sound] and ignores the
    // caller's method, so a warn (visual only) routed through REST would sound boat-wide. Only the
    // sounding grades (alarm, emergency) take REST; warn and below always publish the v1 delta,
    // which honors the method field. A REST alarm dropping to warn is resolved first so it does
    // not keep sounding server-side.
    if (!isSoundingNotification(value)) {
      if ((await resolveActiveAlert(token)) === 'disposed') return;
      deps.publishDelta(path, value);
      deltaActive = true;
      return;
    }

    if (alertId) {
      const result: UpdateNotificationResult = await update(deps.origin, token, alertId, {
        state: value.state,
        message: value.message,
      });
      if (disposed) return;
      if (result === 'updated') {
        retractDelta(path, value);
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
      path: NOTIFICATION_PATH,
      includePosition: true,
      includeCreatedAt: true,
    });
    if (disposed) return;
    if (postedId) {
      alertId = postedId;
      retractDelta(path, value);
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
      // Clear the active marker in the drain's own continuation. A publication that lands during the
      // final apply already set pending, so the loop above drains it before reaching here; one that
      // lands after this line finds no active drain and starts a fresh one. There is no await between
      // the loop's last pending check and this line, so no work slips through the gap. Clearing alone
      // is enough only because apply cannot reject: the notifications client and publishDelta are
      // contractually never-throw. If that contract ever changes, a pending item queued during a
      // throwing apply would need a restart here.
      activeDrain = undefined;
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
