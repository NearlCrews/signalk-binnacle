import { isRecord, isUnsafeProviderKey } from '$shared/lib';
import { deleteResource, fetchAuthedJsonOutcome, jsonOr, sendJson } from './resource';
import { isRaisedNotificationValue, NOTIFICATIONS_PREFIX, type NotificationState } from './types';

// Thin client for the server's v2 Notifications API (signalk-server src/api/notifications).
// Raising returns a server-assigned uuid notification id; silence, acknowledge, update, and
// clear all address that id (the routes uuid-validate it, so there is no path-addressed form).
// Every call degrades to a bounded failure result and never throws.
const NOTIFICATIONS_API = '/signalk/v2/api/notifications';

export interface RaiseNotificationOptions {
  state: NotificationState;
  message: string;
  // Path to file the notification under, in either the canonical 'notifications.'-prefixed form or
  // the bare form; postNotification strips the prefix the wire format re-adds. Defaults to
  // notifications.{id} when omitted.
  path?: string;
  // Append the assigned id to the path, so repeated raises do not collide.
  idInPath?: boolean;
  includePosition?: boolean;
  includeCreatedAt?: boolean;
  data?: Record<string, unknown>;
}

export interface UpdateNotificationOptions {
  state?: NotificationState;
  message?: string;
  data?: Record<string, unknown>;
}

function postJson(
  url: string,
  token: string | undefined,
  body?: unknown,
): Promise<Response | undefined> {
  return sendJson(url, token, 'POST', body);
}

async function idFrom(response: Response | undefined): Promise<string | undefined> {
  if (!response?.ok) return undefined;
  const body = await jsonOr<{ id?: unknown }>(response, {});
  return typeof body.id === 'string' ? body.id : undefined;
}

// Raise a new notification; the response carries the assigned id the caller needs for every
// follow-up (update, silence, acknowledge, clear).
export async function postNotification(
  base: string,
  token: string | undefined,
  options: RaiseNotificationOptions,
): Promise<string | undefined> {
  // The v2 raise wants the bare path; the server re-adds the 'notifications.' prefix when filing.
  // Normalizing here keeps the wire quirk out of every caller, so they pass the canonical path.
  const body = options.path?.startsWith(NOTIFICATIONS_PREFIX)
    ? { ...options, path: options.path.slice(NOTIFICATIONS_PREFIX.length) }
    : options;
  return idFrom(await postJson(`${base}${NOTIFICATIONS_API}`, token, body));
}

// The three ways an update lands: applied; the server no longer knows the id (a restart reaped
// it, so a fresh raise is right); or the transport failed (a fresh raise would also fail, and
// could orphan a still-raised duplicate once the link returns).
export type UpdateNotificationResult = 'updated' | 'missing' | 'failed';
export type NotificationActionResult = 'completed' | 'unsupported' | 'failed';

function notificationActionResult(response: Response | undefined): NotificationActionResult {
  if (!response) return 'failed';
  if (response.ok) return 'completed';
  return response.status === 501 ? 'unsupported' : 'failed';
}

// Update a raised notification in place (state, message, or data). A state change resets the
// server-side silenced and acknowledged flags.
export async function updateNotification(
  base: string,
  token: string | undefined,
  id: string,
  options: UpdateNotificationOptions,
): Promise<UpdateNotificationResult> {
  const response = await sendJson(`${base}${NOTIFICATIONS_API}/${id}`, token, 'PUT', options);
  if (!response) return 'failed';
  if (response.ok) return 'updated';
  // The server answers 400 "Notification not found!" for an unknown or reaped id, so only 400
  // warrants a re-raise; an auth refusal or absent API keeps the id and the caller's v1 delta
  // fallback carries the change.
  return response.status === 400 ? 'missing' : 'failed';
}

// Clear a notification: the server sets its state to normal and emits the final delta
// (DELETE removes nothing immediately; a cleaner reaps normal-state entries later).
export async function resolveNotification(
  base: string,
  token: string | undefined,
  id: string,
): Promise<boolean> {
  return deleteResource(`${base}${NOTIFICATIONS_API}/${id}`, token);
}

export async function silenceNotification(
  base: string,
  token: string | undefined,
  id: string,
): Promise<NotificationActionResult> {
  const response = await postJson(`${base}${NOTIFICATIONS_API}/${id}/silence`, token);
  return notificationActionResult(response);
}

export async function acknowledgeNotification(
  base: string,
  token: string | undefined,
  id: string,
): Promise<NotificationActionResult> {
  const response = await postJson(`${base}${NOTIFICATIONS_API}/${id}/acknowledge`, token);
  return notificationActionResult(response);
}

// The v1 REST snapshot of the self notifications tree, for reconciling the store's mirror after a
// reconnect. Bounds on the walk keep a hostile or broken tree from recursing or collecting without
// limit; both sit comfortably above any well-formed server.
const NOTIFICATIONS_SNAPSHOT_PATH = '/signalk/v1/api/vessels/self/notifications';
const MAX_SNAPSHOT_DEPTH = 12;
const MAX_SNAPSHOT_PATHS = 5_000;

// Fetch the currently raised notification paths ('notifications.'-prefixed, matching the store
// mirror's keys). A 404 is a server with no notifications branch at all, which is a real empty set;
// only a transport or server failure resolves undefined, so the caller can leave its mirror
// untouched rather than clear live alarms on a flaky link.
export async function fetchRaisedNotificationPaths(
  base: string,
  token: string | undefined,
): Promise<ReadonlySet<string> | undefined> {
  const outcome = await fetchAuthedJsonOutcome<unknown>(
    `${base}${NOTIFICATIONS_SNAPSHOT_PATH}`,
    token,
  );
  if (outcome.state === 'failed') return undefined;
  const paths = new Set<string>();
  if (outcome.state === 'ok') collectRaisedPaths(outcome.value, '', paths, 0);
  // A snapshot that hit the collection cap is not the full raised set, and reconciling deletions
  // against a partial set could drop live alarms, so it reads as a failed fetch instead.
  if (paths.size >= MAX_SNAPSHOT_PATHS) return undefined;
  return paths;
}

// A node carrying `value` is a leaf in the v1 full-model tree; every other key is a path segment.
// Segment guards mirror the resource-id hygiene in asKeyedObject: a dotted, oversized, or
// control-bearing key cannot produce a well-formed mirror path, so its subtree is skipped.
function collectRaisedPaths(node: unknown, prefix: string, out: Set<string>, depth: number): void {
  if (!isRecord(node) || depth > MAX_SNAPSHOT_DEPTH || out.size >= MAX_SNAPSHOT_PATHS) return;
  if (Object.hasOwn(node, 'value')) {
    if (prefix.length > 0 && isRaisedNotificationValue(node.value)) {
      out.add(`${NOTIFICATIONS_PREFIX}${prefix}`);
    }
    return;
  }
  for (const [key, child] of Object.entries(node)) {
    if (isUnsafeProviderKey(key) || key.includes('.')) continue;
    collectRaisedPaths(child, prefix.length > 0 ? `${prefix}.${key}` : key, out, depth + 1);
  }
}

// The server's MOB convenience route: raises an emergency at notifications.mob.{id} with
// position and createdAt included.
export async function postMobNotification(
  base: string,
  token: string | undefined,
  message?: string,
): Promise<string | undefined> {
  const body = message === undefined ? {} : { message };
  return idFrom(await postJson(`${base}${NOTIFICATIONS_API}/mob`, token, body));
}
