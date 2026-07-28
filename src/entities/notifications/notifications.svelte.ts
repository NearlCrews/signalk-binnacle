import { hasControlCharacters, isRecord } from '$shared/lib';
import {
  notificationState,
  type RaisedNotificationState,
  type SignalKStore,
} from '$shared/signalk';

// Sort rank for the raised grades; lower is more severe. Doubles as the membership test:
// a state outside this table (normal, nominal, or junk) is not an active alert. Keyed by
// RaisedNotificationState so the table provably covers every raised grade and nothing else.
const SEVERITY_RANK: Record<RaisedNotificationState, number> = {
  emergency: 0,
  alarm: 1,
  warn: 2,
  alert: 3,
};

export const MAX_ACTIVE_NOTIFICATIONS = 500;
const MAX_NOTIFICATION_PATH_LENGTH = 512;
const MAX_NOTIFICATION_MESSAGE_LENGTH = 2_048;
const MAX_NOTIFICATION_ID_LENGTH = 512;
const MAX_NOTIFICATION_TIMESTAMP_LENGTH = 128;

function cleanString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || hasControlCharacters(trimmed)) return undefined;
  return trimmed;
}

// The Signal K notification delivery methods (server-api), the only values method carries.
type NotificationMethod = 'visual' | 'sound';

export interface ActiveNotification {
  path: string;
  state: RaisedNotificationState;
  message: string;
  // The delivery methods the producer asked for, or undefined when the value carried no usable
  // method field. Absent and explicitly empty are different answers: a producer that never said
  // anything leaves the audible default to the consumer, while an explicit [] or ['visual'] is a
  // deliberate request to stay quiet.
  method?: NotificationMethod[];
  // The store's quiet-to-sounding counter for this path. A consumer re-articulates an alarm on an
  // increase, so a second raise of an already-sounding condition is heard.
  activation: number;
  // ISO 8601, from the value's createdAt when the producer included it.
  timestamp?: string;
  // The v2 notification id the server stamps on the value; absent on pre-2.28 servers,
  // and required for the REST silence, acknowledge, and clear routes.
  id?: string;
  silenced?: boolean;
  acknowledged?: boolean;
  canSilence?: boolean;
  canAcknowledge?: boolean;
}

const boolField = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

// Every malformed shape resolves to undefined, which consumers read as the audible default. An
// array carrying only unrecognized entries (['audio']) is malformed, not a request for silence:
// treating it as an explicit empty list would quietly mute a real alarm. Only a genuinely empty
// array is the producer asking for no delivery method at all.
function parseMethods(value: unknown): NotificationMethod[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.length === 0) return [];
  const known = value.filter((m): m is NotificationMethod => m === 'visual' || m === 'sound');
  return known.length > 0 ? known : undefined;
}

function parseNotification(
  path: string,
  value: unknown,
  activation: number,
): ActiveNotification | undefined {
  if (!isRecord(value)) return undefined;
  const safePath = cleanString(path, MAX_NOTIFICATION_PATH_LENGTH);
  if (!safePath) return undefined;
  const raw = value;
  const state = notificationState(value);
  // Object.hasOwn, not `in`: a junk state like 'constructor' must not match the prototype.
  if (state === undefined || !Object.hasOwn(SEVERITY_RANK, state)) return undefined;
  const method = parseMethods(raw.method);
  const status = isRecord(raw.status) ? raw.status : {};
  const message = cleanString(raw.message, MAX_NOTIFICATION_MESSAGE_LENGTH) ?? '';
  return {
    path: safePath,
    state: state as RaisedNotificationState,
    message,
    method,
    activation,
    timestamp: cleanString(raw.createdAt, MAX_NOTIFICATION_TIMESTAMP_LENGTH),
    id: cleanString(raw.id, MAX_NOTIFICATION_ID_LENGTH),
    silenced: boolField(status.silenced),
    acknowledged: boolField(status.acknowledged),
    canSilence: boolField(status.canSilence),
    canAcknowledge: boolField(status.canAcknowledge),
  };
}

// Wraps the SignalKStore notifications mirror the way AisTargets wraps aisTargets: a memoized
// severity-sorted list of the raised notifications, rebuilt only when the mirror version moves.
export class NotificationsStore {
  #store: SignalKStore;
  #cache: ActiveNotification[] | undefined;
  #cacheVersion = -1;

  constructor(store: SignalKStore) {
    this.#store = store;
  }

  // Reading this in a reactive context takes a dependency on notification changes; list()
  // reads it too, so a $derived around list() re-runs when the mirror moves.
  get version(): number {
    return this.#store.notificationsVersion;
  }

  list(): ActiveNotification[] {
    const version = this.#store.notificationsVersion;
    if (this.#cache && this.#cacheVersion === version) return this.#cache;
    const out: ActiveNotification[] = [];
    for (const [path, value] of this.#store.notifications) {
      const parsed = parseNotification(path, value, this.#store.cell(path).activation);
      if (parsed) out.push(parsed);
    }
    out.sort(
      (a, b) => SEVERITY_RANK[a.state] - SEVERITY_RANK[b.state] || a.path.localeCompare(b.path),
    );
    this.#cache = out.slice(0, MAX_ACTIVE_NOTIFICATIONS);
    this.#cacheVersion = version;
    return this.#cache;
  }
}
