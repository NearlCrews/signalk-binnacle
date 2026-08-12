import { isRecord, withTimeout } from '$shared/lib';
import { binnacleStorageKey } from '$shared/persistence';
import { createPersistedCodec, PersistedValue } from '$shared/settings';
import { isSameOriginPath } from './admin-session';
import { jsonOr } from './resource';

export type AuthStatus = 'unknown' | 'unsecured' | 'authenticated' | 'requesting' | 'denied';

// The result of a finished read/write upgrade that did not grant the token: the admin refused it
// ('declined'), the request landed but was never answered before it expired or the poll budget ran
// out ('unanswered', so it may still be sitting in the admin's Access Requests list), or the POST
// never reached the server ('unreachable'). Drives the read-only banner's follow-up copy and its
// retry cue; undefined means no upgrade has failed since the last attempt or grant. The initial
// access flow reuses the 'unanswered' and 'unreachable' members for its own exhaustion outcome
// (accessOutcome below), so both flows describe a non-refusal in one vocabulary.
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

// After the fast probe budget is spent (a server down longer than the ten-minute window), the
// startup probe degrades to this slow heartbeat instead of stopping. A fixed helm display gets no
// focus, visibility, or net-online event to trigger a recheck, so without it a stored-token shell
// that loaded during a server outage stays dead until a manual tap.
const PROBE_HEARTBEAT_MS = 60_000;

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
  // Why status is 'denied' when it is not an admin refusal: the initial access poll exhausted its
  // budget with the request still unanswered ('unanswered', it may sit in the admin's list yet) or
  // without ever reaching the server ('unreachable'). Undefined for a real refusal, so the banner
  // and requestAccess treat only a genuine denial as one; a retry after either non-refusal keeps
  // the same clientId so a pending server-side request or approval still counts.
  accessOutcome = $state<UpgradeOutcome | undefined>();

  #base: string;
  #fetch: typeof fetch;
  #schedule: (run: () => void, ms: number) => unknown;
  #cancelSchedule: (handle: unknown) => void;
  #pollMs: number;
  #identity: PersistedValue<AuthIdentity>;
  #identityGeneration = 0;
  #stopped = false;
  #checking = false;
  #checkingUpgrade = false;
  #probing = false;
  // Whether the current initial-access flow ever got a real answer from the server (a landed POST
  // or a non-transport poll response). Distinguishes an unanswered request from an unreachable
  // server when the poll budget exhausts.
  #accessReachedServer = false;
  #watching = false;
  // Reactive: today every write is paired with a reactive sibling (upgrading, upgradeOutcome) so
  // the banner happens to update, but a later path that changes one without the other would leave
  // the banner naming a stale request id.
  #upgradeClientId = $state<string | undefined>();
  // One poll loop per flow: the initial access request and the read/write upgrade. Each owns its href,
  // attempt budget, and scheduled flag; the shared driver keeps the cadence identical across both.
  #accessPoll: AccessRequestPoll;
  #upgradePoll: AccessRequestPoll;
  // Retries a startup probe whose fetch failed in transit while a stored token exists. Without it
  // the status latches 'unknown' with no timer-driven retry, and the stream never connects until a
  // reload. On exhaustion it degrades to the slow probe heartbeat: 'unknown' stays retryable
  // through the focus, visibility, and net-online rechecks, and it must never read as a denial
  // while a possibly-valid token is still stored.
  #probePoll: AccessRequestPoll;
  #probeHeartbeat: unknown;

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
      // Exhaustion is never an admin refusal (a real one resolves through checkRequest); record
      // whether the request was ever seen by the server so the banner offers a same-id retry
      // instead of announcing a denial the admin never made.
      () => {
        this.accessOutcome = this.#accessReachedServer ? 'unanswered' : 'unreachable';
        this.status = 'denied';
      },
    );
    this.#probePoll = new AccessRequestPoll(
      this.#schedule,
      this.#cancelSchedule,
      this.#pollMs,
      () => !this.#stopped && this.status === 'unknown',
      () => this.#armProbeHeartbeat(),
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
    // The in-flight guard mirrors checkRequest: a tab return fires focus and visibilitychange
    // together, and the scheduled re-probe can overlap either, so one probe runs at a time.
    if (this.#stopped || this.#probing) return;
    this.#probing = true;
    try {
      await this.#probeOnce();
    } finally {
      this.#probing = false;
    }
  }

  async #probeOnce(): Promise<void> {
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
      // A definitive answer is success or an explicit auth rejection; a transport failure or a
      // proxy 502 while the server boots is indefinite. Only definitive answers restore the fast
      // budget, or a spinning proxy would keep the fast poll alive forever instead of letting it
      // degrade to the heartbeat.
      const definitive =
        authed !== undefined && (authed.ok || authed.status === 401 || authed.status === 403);
      if (definitive) this.#probePoll.reset();
      if (authed?.ok) {
        this.token = stored;
        this.status = 'authenticated';
        return;
      }
      // An indefinite outcome proves nothing about the token: clearing it here would wipe an
      // admin-approved token on a flaky boat network. Keep it, skip the anonymous probe (it
      // would also fail and could mislabel the server), and schedule a bounded re-probe: without
      // one, a PWA shell that loaded while the server was still booting (usually a proxy 502,
      // sometimes a failed fetch) stays 'unknown' forever and the stream never connects.
      if (!definitive) {
        this.#probePoll.schedule(() => void this.probe());
        return;
      }
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
    // The href is server-supplied and is concatenated onto the origin, so it must be an absolute
    // same-origin path. A protocol-relative or backslash form would send the access-request poll,
    // and the approved token it carries, to another host.
    const href =
      typeof body.href === 'string' && isSameOriginPath(body.href) ? body.href : undefined;
    return { ok: true, href };
  }

  // Poll a pending access-request href once. 'gone' = the request expired or was cleared (404/410),
  // 'unreachable' = the fetch never completed (rescheduled like 'pending', but it proves nothing
  // about the request), 'pending' = the server answered without a verdict yet, 'denied' = completed
  // but not approved, and an object carries the approved token. Shared by the initial flow and the
  // read/write upgrade flow.
  async #pollAccessRequest(
    href: string,
  ): Promise<'gone' | 'pending' | 'unreachable' | 'denied' | { token: string }> {
    const res = await this.#safeFetch(`${this.#base}${href}`, { credentials: 'omit' });
    if (!res) return 'unreachable';
    if (res.status === 404 || res.status === 410) return 'gone';
    if (!res.ok) return 'pending';
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
    // A declined clientId stays declined: the server re-returns the existing refused grant, so a
    // retry has to introduce Binnacle as a new device or it is a silent no-op. Same reasoning as
    // requestWriteAccess, which mints a fresh id for exactly this reason. An exhaustion outcome
    // ('unanswered' or 'unreachable') is not a refusal: the original request may still be waiting
    // server-side, so the id survives and the retry can pick up its approval.
    // A user retry after exhaustion or refusal is a fresh attempt: it needs a fresh poll budget
    // (or the retry button visibly does nothing after exhaustion) and fresh reached-server
    // evidence (or a retry whose POSTs all fail in transit reports 'unanswered' on the previous
    // attempt's evidence, sending the navigator to the admin instead of the network). This runs
    // BEFORE the forget below: forgetting routes through #applyIdentity, which moves status off
    // 'denied', so a later guard would silently skip the genuine-refusal path.
    if (this.status === 'denied') {
      this.#accessPoll.reset();
      this.#accessReachedServer = false;
    }
    if (this.status === 'denied' && this.accessOutcome === undefined) {
      this.forgetDeviceCredentials();
    }
    // A fresh attempt supersedes any prior exhaustion outcome, as requestWriteAccess does with its
    // upgradeOutcome.
    this.accessOutcome = undefined;
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
    this.#accessReachedServer = true;
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
      if (result !== 'unreachable') this.#accessReachedServer = true;
      if (result === 'gone') {
        // The request expired or was cleared server-side; start a fresh one rather than poll a dead
        // href forever (which left the first tab stuck until the user opened a new one).
        await this.requestAccess();
      } else if (result === 'pending' || result === 'unreachable') {
        this.#accessPoll.schedule(() => void this.checkRequest());
      } else if (result === 'denied') {
        // A real admin refusal, so no exhaustion outcome may soften it: the next requestAccess
        // must introduce a fresh device id.
        this.accessOutcome = undefined;
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
    // The network returning is the same "circumstances changed, revalidate" signal as a tab
    // return, and it belongs to this controller's lifecycle, not the composition root: any
    // precondition recheck() learns applies to every wake path at once.
    window.addEventListener('online', this.#onFocus);
    if (typeof document !== 'undefined')
      document.addEventListener('visibilitychange', this.#onFocus);
  }

  recheck(): void {
    if (this.#stopped) return;
    // 'unknown' means a startup probe failed in transit (or never ran): re-probe so a stored token
    // is revalidated the moment the tab returns, instead of latching a dead session until reload.
    if (this.status === 'unknown') void this.probe();
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
      `${CLIENT_DESCRIPTION} (read and write)`,
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
    // Skip if a check is already in flight, as checkRequest does: a tab return fires focus and
    // visibilitychange together, so two polls would otherwise reach #applyIdentity or #endUpgrade.
    const href = this.#upgradePoll.href;
    if (this.#stopped || this.#checkingUpgrade || !href) return;
    this.#checkingUpgrade = true;
    const identityGeneration = this.#identityGeneration;
    const upgradeClientId = this.#upgradeClientId;
    try {
      const result = await this.#pollAccessRequest(href);
      if (
        this.#stopped ||
        identityGeneration !== this.#identityGeneration ||
        href !== this.#upgradePoll.href ||
        upgradeClientId !== this.#upgradeClientId
      )
        return;
      if (result === 'pending' || result === 'unreachable') {
        this.#upgradePoll.schedule(() => void this.checkUpgrade());
        return;
      }
      // On approval adopt the new read/write identity wholesale (which ends the upgrade and clears
      // the outcome), leaving the live read token in place until then so the chart keeps updating.
      if (typeof result === 'object' && this.#upgradeClientId) {
        this.#applyIdentity({ clientId: this.#upgradeClientId, token: result.token }, true);
        return;
      }
      // The admin refused it ('denied'), or the request expired or vanished without an answer
      // ('gone'); either way the read-only token stays. The server answered in both cases, so
      // neither is 'unreachable'. Record which so the banner explains it and offers a retry.
      this.#endUpgrade(result === 'denied' ? 'declined' : 'unanswered');
    } finally {
      this.#checkingUpgrade = false;
    }
  }

  // Each failed heartbeat probe re-enters through the exhausted poll's schedule call, so the
  // heartbeat sustains itself at its own slow cadence until a probe succeeds or the controller
  // stops.
  #armProbeHeartbeat(): void {
    if (this.#stopped || this.status !== 'unknown' || this.#probeHeartbeat !== undefined) return;
    this.#probeHeartbeat = this.#schedule(() => {
      this.#probeHeartbeat = undefined;
      if (this.#stopped || this.status !== 'unknown') return;
      void this.probe();
    }, PROBE_HEARTBEAT_MS);
  }

  stop(): void {
    this.#stopped = true;
    this.#accessPoll.cancel();
    this.#probePoll.cancel();
    if (this.#probeHeartbeat !== undefined) {
      this.#cancelSchedule(this.#probeHeartbeat);
      this.#probeHeartbeat = undefined;
    }
    this.#endUpgrade();
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', this.#onFocus);
      window.removeEventListener('storage', this.#onStorage);
      window.removeEventListener('online', this.#onFocus);
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
    this.accessOutcome = undefined;
    this.#accessReachedServer = false;
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
