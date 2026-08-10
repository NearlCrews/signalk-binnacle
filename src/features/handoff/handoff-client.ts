import {
  type HandoffSnapshot,
  isHandoffSnapshot,
  MAX_HANDOFF_SNAPSHOTS,
  newestHandoffs,
} from '$entities/handoff';
import { isRecord, readBoundedJson, withTimeout } from '$shared/lib';
import { authInit } from '$shared/signalk';

// The shared watch-handoff store: Signal K applicationData, GLOBAL scope, so every station and
// every user reads the same list (the oncoming watch is usually a different login). Deliberately
// not the notes resource: notes feed Find places and the POI overlay, and a handoff snapshot must
// never surface there. Each snapshot lives under its own uuid-suffixed top-level key, so two
// stations posting concurrently never touch the same path and there is no shared container whose
// initialization could race and wipe a sibling's write.

const APP_ID = 'signalk-binnacle';
const VERSION = '1.0.0';
const KEY_PREFIX = 'handoff-';
const MAX_RESPONSE_BYTES = 2_000_000;
// The shared document keeps a few more than the panel lists, so pruning is not racing every write.
const MAX_STORED = MAX_HANDOFF_SNAPSHOTS + 10;

const docUrl = (base: string) => `${base}/signalk/v1/applicationData/global/${APP_ID}/${VERSION}`;

function pointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

export type HandoffLoadResult =
  | { state: 'ok'; snapshots: HandoffSnapshot[] }
  | { state: 'unavailable' };

export interface HandoffClient {
  load(): Promise<HandoffLoadResult>;
  // True when the server accepted the snapshot. False covers everything else (offline, no
  // applicationData support, no write access); the caller keeps the draft and retries later.
  post(snapshot: HandoffSnapshot): Promise<boolean>;
  // Best-effort: remove the oldest stored snapshots beyond the retention bound. A failure is
  // ignored; another station or a later visit prunes instead.
  prune(snapshots: readonly HandoffSnapshot[]): Promise<void>;
}

export function createHandoffClient(
  base: string,
  token: () => string | undefined,
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
): HandoffClient {
  async function post(body: unknown): Promise<boolean> {
    try {
      const response = await fetchFn(
        docUrl(base),
        withTimeout(
          authInit(token(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
        ),
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  return {
    async load() {
      try {
        const response = await fetchFn(docUrl(base), withTimeout(authInit(token())));
        if (!response.ok) return { state: 'unavailable' };
        const body = await readBoundedJson<unknown>(response, MAX_RESPONSE_BYTES);
        if (!isRecord(body)) return { state: 'ok', snapshots: [] };
        const snapshots: HandoffSnapshot[] = [];
        for (const [key, value] of Object.entries(body)) {
          if (!key.startsWith(KEY_PREFIX)) continue;
          // One corrupt entry never takes the list down; it is simply not shown.
          if (isHandoffSnapshot(value)) snapshots.push(value);
        }
        // Newest first and bounded well above the retention limit, so the caller can both list
        // the newest and hand the full stored set to prune.
        return { state: 'ok', snapshots: newestHandoffs(snapshots, 200) };
      } catch {
        return { state: 'unavailable' };
      }
    },
    post(snapshot) {
      return post([
        {
          op: 'add',
          path: `/${pointerSegment(`${KEY_PREFIX}${snapshot.id}`)}`,
          value: snapshot,
        },
      ]);
    },
    async prune(snapshots) {
      if (snapshots.length <= MAX_STORED) return;
      const oldestFirst = [...snapshots].sort((a, b) => a.createdAt - b.createdAt);
      const excess = oldestFirst.slice(0, snapshots.length - MAX_STORED);
      await post(
        excess.map((snapshot) => ({
          op: 'remove',
          path: `/${pointerSegment(`${KEY_PREFIX}${snapshot.id}`)}`,
        })),
      );
    },
  };
}
