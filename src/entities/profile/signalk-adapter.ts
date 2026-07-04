import { isRecord } from '$shared/lib';
import { fetchAuthedJson, postResource } from '$shared/signalk';
import type { ProfilesState } from './profile-types';
import type { AsyncProfileAdapter } from './profiles-store.svelte';

// The SignalK applicationData store, keyed by appId and data-format version. The version segment is
// the document schema version (1.0.0), a constant independent of the app's package version. POSTing
// to the bare URL (no trailing key path) replaces the whole document, which is the ProfilesState.
const APP_DATA_URL = (base: string) =>
  `${base}/signalk/v1/applicationData/user/signalk-binnacle/1.0.0`;

// Persists the profiles document to the SignalK server's per-user applicationData store, so profiles
// follow a logged-in user across devices. Every call degrades silently: a load failure resolves
// undefined and a save failure resolves false, so the store keeps its local cache rather than throw.
export class SignalKProfileAdapter implements AsyncProfileAdapter {
  #base: string;
  #token: () => string | undefined;

  // The token is injected as a getter, not a value: it rotates mid-session when the user approves
  // a read-write upgrade, and a captured value would keep 401ing with the stale read-only token.
  constructor(base: string, token: () => string | undefined) {
    this.#base = base;
    this.#token = token;
  }

  async load(): Promise<ProfilesState | undefined> {
    const body = await fetchAuthedJson<unknown>(APP_DATA_URL(this.#base), this.#token());
    // undefined means the store is unavailable (any non-2xx such as 401 unauthenticated or 405
    // security off, a network failure, or an unparseable body): tell the caller to stay local and
    // not attempt a write that would also fail, distinct from the reachable-but-empty case below.
    if (body === undefined) return undefined;
    // A reachable but empty store answers with {} and a 200, so a missing profiles array is an empty
    // state, not an unavailable one: returning it lets the store seed the server from the local cache.
    if (!isRecord(body) || !Array.isArray(body.profiles)) {
      return { profiles: [], activeId: undefined, defaultId: undefined };
    }
    return body as unknown as ProfilesState;
  }

  async save(state: ProfilesState): Promise<boolean> {
    return postResource(APP_DATA_URL(this.#base), this.#token(), state);
  }
}
