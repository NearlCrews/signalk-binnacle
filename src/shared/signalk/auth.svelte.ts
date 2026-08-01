import { isRecord, withTimeout } from '$shared/lib';
import { binnacleStorageKey } from '$shared/persistence';
import { createPersistedCodec, PersistedValue } from '$shared/settings';
import { jsonOr } from './resource';

export type AuthStatus = 'unknown' | 'unsecured' | 'authenticated' | 'requesting' | 'denied';

// The result of a finished read/write upgrade that did not grant the token: the admin refused it
// ('declined'), the request landed but was never answered before it expired or the poll budget ran
// out ('unanswered', so it may still be sitting in the admin's Access Requests list), or the POST
// never reached the server ('unreachable'). Drives the read-only banner's follow-up copy and its
// retry cue; undefined means no upgrade has failed since the last attempt or grant.
export type UpgradeOutcome = 'declined' | 'unanswered' | 'unreachable';

interface AuthIdentity {
  clientId: string;
  token: string | null;
}

function isSafeStoredText(value: string, maxLength: number): boolean {
  if (value.length === 0 || value.length > maxLength) return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return false;
  }
  return true;
}

function isAuthIdentity(value: unknown): value is AuthIdentity {
  return (
    isRecord(value) &&
    typeof value.clientId === 'string' &&
    isSafeStoredText(value.clientId, 128) &&
    (value.token === null ||
      (typeof value.token === 'string' && isSafeStoredText(value.token, 16_384)))
  );
}

const authIdentityCodec = createPersistedCodec(isAuthIdentity);

interface AuthOptions {
  fetch?: typeof fetch;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  schedule?: (run: () => void, ms: number) => unknown;
  cancelSchedule?: (handle: unknown) => void;
  pollMs?: number;
}

const STORAGE_KEY = binnacleStorageKey('signalkAuth');
const PROBE_PATH = '/signalk/v1/api/vessels/self';
const REQUEST_PATH = '/signalk/v1/access/requests';
// The client description the server shows in its access-request list, single-sourced so the read-only
// and the read/write request agree on the app name.
const CLIENT_DESCRIPTION = 'Binnacle Chartplotter';
// Stop polling an unanswered access request (or retrying a POST that keeps failing in
// transit) after this many attempts (about 10 min at the default 3 s interval) so a
// never-approved request is not an unbounded loop.
const MAX_POLL_ATTEMPTS = 200;

// A short, recognizable client id (binnacle-<8 hex>) so the Signal K access-requests list shows a
// name the user recognizes, not a bare UUID. crypto.randomUUID needs a secure context, so fall
// back to a random hex string where it is absent.
function newClientId(): string {
  const short =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.floor(Math.random() * 0xffffffff)
          .toString(16)
          .padStart(8, '0');
  return `binnacle-${short}`;
}

// One bounded access-request poll loop: owns the poll href, the attempt counter, and the scheduled
// flag for a single flow, so the initial-access and read/write-upgrade flows share one cadence instead
// of two parallel copies. schedule() books the next tick after pollMs unless the loop is already
// scheduled, is inactive (isActive), or has reached MAX_POLL_ATTEMPTS (then onExhausted fires). Each
// flow supplies only its active check, its exhausted handler, and the task to run per tick.
class AccessRequestPoll {
  href?: string;
  #attempts = 0;
  #scheduled = false;
  #generation = 0;
  #handle: unknown;
  #schedule: (run: () => void, ms: number) => unknown;
  #cancelSchedule: (handle: unknown) => void;
  #pollMs: number;
  #isActive: () => boolean;
  #onExhausted: () => void;

  constructor(
    schedule: (run: () => void, ms: number) => unknown,
    cancelSchedule: (handle: unknown) => void,
    pollMs: number,
    isActive: () => boolean,
    onExhausted: () => void,
  ) {
    this.#schedule = schedule;
    this.#cancelSchedule = cancelSchedule;
    this.#pollMs = pollMs;
    this.#isActive = isActive;
    this.#onExhausted = onExhausted;
  }

  // Restart the attempt budget once a fresh request lands, so an approval that arrives after an earlier
  // stalled request still has the full window.
  reset(): void {
    this.#attempts = 0;
  }

  cancel(): void {
    this.#generation += 1;
    if (this.#scheduled && this.#handle !== undefined) this.#cancelSchedule(this.#handle);
    this.#scheduled = false;
    this.#handle = undefined;
  }

  schedule(task: () => void): void {
    if (this.#scheduled || !this.#isActive()) return;
    if (this.#attempts >= MAX_POLL_ATTEMPTS) {
      this.#onExhausted();
      return;
    }
    this.#attempts += 1;
    this.#scheduled = true;
    const generation = this.#generation;
    const handle = this.#schedule(() => {
      if (generation !== this.#generation) return;
      this.#scheduled = false;
      this.#handle = undefined;
      if (!this.#isActive()) return;
      task();
    }, this.#pollMs);
    if (generation === this.#generation && this.#scheduled) this.#handle = handle;
  }
}

export class AuthController {
  status = $state<AuthStatus>('unknown');
  token = $state<string | null>(null);
  // True once an authenticated session has had a write refused (401/403): the granted token is
  // read-only. A later successful write clears it. Drives the read-only banner and its upgrade action.
  writeBlocked = $state(false);
  // True while a read/write upgrade request is pending admin approval. The existing read token stays
  // live throughout, so the chart keeps updating while the navigator waits for the new grant.
  upgrading = $state(false);
  // Set when a read/write upgrade finishes without granting the token, so the banner can tell a
  // declined request, an unanswered one, and an unreachable server apart and offer a retry rather
  // than silently reverting.
  upgradeOutcome = $state<UpgradeOutcome | undefined>();

  #base: string;
  #fetch: typeof fetch;
  #schedule: (run: () => void, ms: number) => unknown;
  #cancelSchedule: (handle: unknown) => void;
  #pollMs: number;
  #identity: PersistedValue<AuthIdentity>;
  #identityGeneration = 0;
  #stopped = false;
  #checking = false;
  #watching = false;
  // Reactive: today every write is paired with a reactive sibling (upgrading, upgradeOutcome) so
  // the banner happens to update, but a later path that changes one without the other would leave
  // the banner naming a stale request id.
  #upgradeClientId = $state<string | undefined>();
  // One poll loop per flow: the initial access request and the read/write upgrade. Each owns its href,
  // attempt budget, and scheduled flag; the shared driver keeps the cadence identical across both.
  #accessPoll: AccessRequestPoll;
  #upgradePoll: AccessRequestPoll;

  constructor(base: string, opts: AuthOptions = {}) {
    this.#base = base;
    this.#fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.#schedule = opts.schedule ?? ((run, ms) => setTimeout(run, ms));
    this.#cancelSchedule =
      opts.cancelSchedule ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.#pollMs = opts.pollMs ?? 3000;
    // The initial-access poll stays live until a token is granted; exhausting its budget denies the
    // request. It does not gate on an href, so a POST that failed in transit can retry on the cadence
    // before any href exists.
    this.#accessPoll = new AccessRequestPoll(
      this.#schedule,
      this.#cancelSchedule,
      this.#pollMs,
      () => !this.#stopped && this.status !== 'authenticated',
      () => {
        this.status = 'denied';
      },
    );
    // The upgrade poll runs only while an upgrade href is in flight; exhausting its budget ends the
    // upgrade and leaves the live read token in place.
    this.#upgradePoll = new AccessRequestPoll(
      this.#schedule,
      this.#cancelSchedule,
      this.#pollMs,
      () => !this.#stopped && this.#upgradePoll.href !== undefined,
      // Exhausting the budget means the request was never answered, not that the server was
      // unreachable: it may still sit in the admin's Access Requests list. End the upgrade as
      // unanswered so the banner says so and offers a retry instead of silently reverting.
      () => this.#endUpgrade('unanswered'),
    );
    this.#identity = new PersistedValue<AuthIdentity>(
      STORAGE_KEY,
      { clientId: newClientId(), token: null },
      opts.storage,
      authIdentityCodec,
    );
    // Persist a first-run identity, and upgrade a legacy bare-UUID clientId to the recognizable
    // binnacle- form (keeping any token), so the access-requests list shows a known name.
    const stored = this.#identity.value;
    const clientId = stored.clientId.startsWith('binnacle-') ? stored.clientId : newClientId();
    if (!this.#identity.fromStorage || clientId !== stored.clientId) {
      this.#identity.set({ clientId, token: stored.token });
    }
    this.token = this.#identity.value.token;
  }

  get clientId(): string {
    return this.#identity.value.clientId;
  }

  // The client id of a pending read/write upgrade request, so the banner names the request the admin
  // actually sees (a fresh id), not the old persisted one. Undefined when no upgrade is in flight.
  get upgradeClientId(): string | undefined {
    return this.#upgradeClientId;
  }

  async probe(): Promise<void> {
    if (this.#stopped) return;
    let identityGeneration = this.#identityGeneration;
    // A stored token is the source of truth: the WebSocket stream needs it, and a
    // working token means the server is secured and we are good. Check it first.
    const stored = this.#identity.value.token;
    if (stored) {
      // credentials: 'omit' so a live session cookie cannot authorize this probe and
      // mask a stale token; the token alone must prove access (it is what the stream uses).
      const authed = await this.#safeFetch(`${this.#base}${PROBE_PATH}`, {
        headers: { Authorization: `Bearer ${stored}` },
        credentials: 'omit',
      });
      if (this.#stopped || identityGeneration !== this.#identityGeneration) return;
      if (authed?.ok) {
        this.token = stored;
        this.status = 'authenticated';
        return;
      }
      // A transport failure proves nothing about the token: clearing it here would wipe an
      // admin-approved token on a flaky boat network. Keep it, skip the anonymous probe (it
      // would also fail and could mislabel the server), and let a later probe retry.
      if (!authed) return;
      // Likewise a non-auth error (a 500, a proxy hiccup) is not a rejection of the token.
      if (authed.status !== 401 && authed.status !== 403) return;
      // Only a definite rejection invalidates the stored token.
      this.#applyIdentity({ ...this.#identity.value, token: null }, true);
      identityGeneration = this.#identityGeneration;
    }
    // Probe anonymously WITHOUT credentials. A browser session cookie would
    // otherwise make a secured server look unsecured, and the WebSocket stream
    // (which the cookie does not authenticate) would then connect tokenless and
    // receive no data. `credentials: 'omit'` forces a true anonymous check.
    const anon = await this.#safeFetch(`${this.#base}${PROBE_PATH}`, { credentials: 'omit' });
    if (this.#stopped || identityGeneration !== this.#identityGeneration) return;
    if (anon?.ok) {
      this.status = 'unsecured';
      return;
    }
    await this.requestAccess();
  }

  // POST an access request for a client id, requesting readwrite up front so the admin's approval UI
  // defaults to it rather than the server's readonly fallback (Binnacle writes routes, waypoints,
  // tracks, course, alarms, and radar controls; a readonly grant 401s every one). `ok` is false for
  // a transport or non-success response, so the caller can retry; `href` is the granted poll URL.
  // Only a successful response without a usable href is malformed. Anonymous (credentials omitted):
  // the request is keyed by clientId and href, never a cookie.
  async #postAccessRequest(
    clientId: string,
    description: string,
  ): Promise<{ ok: boolean; href?: string }> {
    const res = await this.#safeFetch(`${this.#base}${REQUEST_PATH}`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, description, permissions: 'readwrite' }),
    });
    if (!res?.ok) return { ok: false };
    const body = await jsonOr<Record<string, unknown>>(res, {});
    return { ok: true, href: typeof body.href === 'string' ? body.href : undefined };
  }

  // Poll a pending access-request href once. 'gone' = the request expired or was cleared (404/410),
  // 'pending' = not yet answered or a transient error, 'denied' = completed but not approved, and an
  // object carries the approved token. Shared by the initial flow and the read/write upgrade flow.
  async #pollAccessRequest(
    href: string,
  ): Promise<'gone' | 'pending' | 'denied' | { token: string }> {
    const res = await this.#safeFetch(`${this.#base}${href}`, { credentials: 'omit' });
    if (res && (res.status === 404 || res.status === 410)) return 'gone';
    if (!res?.ok) return 'pending';
    const body = await jsonOr<Record<string, unknown>>(res, {});
    if (body.state !== 'COMPLETED') return 'pending';
    const request = (body.accessRequest ?? {}) as { permission?: string; token?: string };
    if (
      request.permission === 'APPROVED' &&
      typeof request.token === 'string' &&
      isSafeStoredText(request.token, 16_384)
    ) {
      return { token: request.token };
    }
    return 'denied';
  }

  async requestAccess(): Promise<void> {
    if (this.#stopped) return;
    const identityGeneration = this.#identityGeneration;
    const clientId = this.clientId;
    this.status = 'requesting';
    const { ok, href } = await this.#postAccessRequest(clientId, CLIENT_DESCRIPTION);
    if (
      this.#stopped ||
      identityGeneration !== this.#identityGeneration ||
      clientId !== this.clientId
    )
      return;
    if (!ok) {
      // A failed POST (offline at startup) must not strand the request at 'requesting' forever: re-issue
      // it on the poll cadence, bounded by the attempt counter, which resets once a POST lands.
      this.#accessPoll.schedule(() => void this.requestAccess());
      return;
    }
    this.#accessPoll.reset();
    this.#accessPoll.href = href;
    if (!href) {
      this.status = 'denied';
      return;
    }
    this.#accessPoll.schedule(() => void this.checkRequest());
  }

  async checkRequest(): Promise<void> {
    // Skip if a check is already in flight: a tab return fires focus and visibilitychange together,
    // and a manual recheck can overlap the scheduled poll, so one guard avoids duplicate fetches.
    const href = this.#accessPoll.href;
    if (this.#stopped || this.#checking || !href || this.status === 'authenticated') return;
    this.#checking = true;
    const identityGeneration = this.#identityGeneration;
    try {
      const result = await this.#pollAccessRequest(href);
      if (
        this.#stopped ||
        identityGeneration !== this.#identityGeneration ||
        href !== this.#accessPoll.href
      )
        return;
      // Another tab may have adopted a token (via the storage event) while the poll was in
      // flight; every branch below would clobber the authenticated state, so bail out first.
      // Widened read: the entry guard narrowed this.status, and control-flow analysis cannot
      // see the cross-await mutation #onStorage makes.
      if ((this.status as AuthStatus) === 'authenticated') return;
      if (result === 'gone') {
        // The request expired or was cleared server-side; start a fresh one rather than poll a dead
        // href forever (which left the first tab stuck until the user opened a new one).
        await this.requestAccess();
      } else if (result === 'pending') {
        this.#accessPoll.schedule(() => void this.checkRequest());
      } else if (result === 'denied') {
        this.status = 'denied';
      } else {
        this.#applyIdentity({ ...this.#identity.value, token: result.token }, true);
      }
    } finally {
      this.#checking = false;
    }
  }

  // Watch the environment so an approval is noticed without a reload: re-check the pending request
  // when the tab regains focus (background tabs throttle the poll timer, so an approval made while
  // away is otherwise missed until the next delayed poll), and adopt a token approved in another tab
  // via the storage event. Owned here so the storage format and request lifecycle stay encapsulated;
  // call once after construction, and stop() tears it down.
  watch(): void {
    if (this.#watching || typeof window === 'undefined') return;
    this.#watching = true;
    window.addEventListener('focus', this.#onFocus);
    window.addEventListener('storage', this.#onStorage);
    if (typeof document !== 'undefined')
      document.addEventListener('visibilitychange', this.#onFocus);
  }

  recheck(): void {
    if (this.#stopped) return;
    if (this.status === 'requesting') void this.checkRequest();
    if (this.upgrading) void this.checkUpgrade();
  }

  adoptToken(token: string): void {
    if (this.#stopped || !isSafeStoredText(token, 16_384)) return;
    this.#applyIdentity({ ...this.#identity.value, token }, true);
  }

  // Forget only Binnacle's device identity and token. Signal K owns server-side revocation, and the
  // browser's administrator cookie is a separate session, so neither is implied by this local action.
  forgetDeviceCredentials(persistReplacement = true): void {
    this.#applyIdentity({ clientId: newClientId(), token: null }, persistReplacement);
  }

  // Record a write outcome observed through sendJson. An authenticated session whose write is refused
  // (401/403) holds a read-only token; a 2xx write proves write access and clears the flag (so the
  // banner disappears once an upgraded token takes effect). Reads and an unsecured server never set it.
  reportWriteOutcome(ok: boolean, status: number): void {
    if (this.status !== 'authenticated') return;
    if (ok) {
      this.writeBlocked = false;
      // A write now succeeds, so any lingering "upgrade failed" banner from an earlier attempt is
      // stale: clear it along with the read-only flag.
      this.upgradeOutcome = undefined;
    } else if (status === 401 || status === 403) this.writeBlocked = true;
  }

  // Request a fresh read/write token when the current one is read-only. A new clientId is used so the
  // admin sees a new request to approve (re-requesting the same clientId would just re-return the
  // existing read grant). The current read token stays live until the new one is approved, so the chart
  // keeps updating; on approval the new identity is adopted wholesale.
  async requestWriteAccess(): Promise<void> {
    if (this.#stopped || this.upgrading) return;
    // A fresh attempt supersedes any prior failure, so drop the outcome banner before starting.
    this.upgradeOutcome = undefined;
    // Set the upgrade client id before the reactive flag so the banner names it on first render.
    this.#upgradePoll.reset();
    this.#upgradeClientId = newClientId();
    const upgradeClientId = this.#upgradeClientId;
    const identityGeneration = this.#identityGeneration;
    this.upgrading = true;
    const { ok, href } = await this.#postAccessRequest(
      upgradeClientId,
      `${CLIENT_DESCRIPTION} (read/write)`,
    );
    if (
      this.#stopped ||
      identityGeneration !== this.#identityGeneration ||
      this.#upgradeClientId !== upgradeClientId ||
      !this.upgrading
    )
      return;
    this.#upgradePoll.href = href;
    if (!ok || !href) {
      // The POST failed in transit or came back without a usable href, so the request never landed.
      this.#endUpgrade('unreachable');
      return;
    }
    this.#upgradePoll.schedule(() => void this.checkUpgrade());
  }

  async checkUpgrade(): Promise<void> {
    const href = this.#upgradePoll.href;
    if (this.#stopped || !href) return;
    const identityGeneration = this.#identityGeneration;
    const upgradeClientId = this.#upgradeClientId;
    const result = await this.#pollAccessRequest(href);
    if (
      this.#stopped ||
      identityGeneration !== this.#identityGeneration ||
      href !== this.#upgradePoll.href ||
      upgradeClientId !== this.#upgradeClientId
    )
      return;
    if (result === 'pending') {
      this.#upgradePoll.schedule(() => void this.checkUpgrade());
      return;
    }
    // On approval adopt the new read/write identity wholesale (which ends the upgrade and clears the
    // outcome), leaving the live read token in place until then so the chart keeps updating.
    if (typeof result === 'object' && this.#upgradeClientId) {
      this.#applyIdentity({ clientId: this.#upgradeClientId, token: result.token }, true);
      return;
    }
    // The admin refused it ('denied'), or the request expired or vanished without an answer
    // ('gone'); either way the read-only token stays. The server answered in both cases, so
    // neither is 'unreachable'. Record which so the banner explains it and offers a retry.
    this.#endUpgrade(result === 'denied' ? 'declined' : 'unanswered');
  }

  stop(): void {
    this.#stopped = true;
    this.#accessPoll.cancel();
    this.#endUpgrade();
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', this.#onFocus);
      window.removeEventListener('storage', this.#onStorage);
    }
    if (typeof document !== 'undefined')
      document.removeEventListener('visibilitychange', this.#onFocus);
  }

  #onFocus = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    this.recheck();
  };

  #onStorage = (event: StorageEvent): void => {
    if (event.key !== STORAGE_KEY) return;
    // A storage event with a null newValue is the cross-tab fallback for privacy erasure in browsers
    // without BroadcastChannel. Drop the runtime token without recreating the just-removed record.
    if (event.newValue === null) {
      this.forgetDeviceCredentials(false);
      return;
    }
    try {
      const decoded = authIdentityCodec.decode(JSON.parse(event.newValue));
      if (decoded.state === 'valid') this.#applyIdentity(decoded.value, false);
    } catch {
      // Ignore a malformed storage payload.
    }
  };

  #endUpgrade(outcome?: UpgradeOutcome): void {
    this.#upgradePoll.cancel();
    this.upgrading = false;
    this.#upgradePoll.href = undefined;
    this.#upgradeClientId = undefined;
    // Only a genuine failure sets an outcome; teardown and a fresh grant end the upgrade silently.
    if (outcome) this.upgradeOutcome = outcome;
  }

  #applyIdentity(identity: AuthIdentity, persist: boolean): void {
    this.#identityGeneration += 1;
    if (persist) this.#identity.set(identity);
    else this.#identity.value = identity;
    this.token = identity.token;
    this.status = identity.token === null ? 'unknown' : 'authenticated';
    this.writeBlocked = false;
    this.upgradeOutcome = undefined;
    this.#accessPoll.cancel();
    this.#accessPoll.href = undefined;
    this.#endUpgrade();
  }

  async #safeFetch(url: string, init?: RequestInit): Promise<Response | undefined> {
    try {
      return await this.#fetch(url, withTimeout(init));
    } catch {
      return undefined;
    }
  }
}
