import { isRecord, isSafeNonNegativeInteger, withTimeout } from '$shared/lib';
import { authInit } from '$shared/signalk';
import type {
  Profile,
  ProfileServerMutation,
  ProfileTombstone,
  RemoteProfilesSnapshot,
} from './profile-types';
import {
  cleanProfileId,
  isProfileTombstone,
  isStoredProfile,
  MAX_PROFILES,
  sanitizeProfileSettings,
} from './profile-validation';
import type {
  AsyncProfileAdapter,
  ProfileRemoteLoadResult,
  ProfileRemoteMutationResult,
} from './profiles-store.svelte';

const APP_ID = 'signalk-binnacle';
const V1 = '1.0.0';
const V2 = '2.0.0';

const appDataUrl = (base: string, version: string) =>
  `${base}/signalk/v1/applicationData/user/${APP_ID}/${version}`;

interface StoredProfilesV2 {
  schemaVersion: 2;
  revision: number;
  profiles: Record<string, Profile>;
  tombstones: Record<string, ProfileTombstone>;
  defaultId: string | null;
}

interface SignalKProfileAdapterOptions {
  fetch?: typeof fetch;
  onWriteOutcome?: (ok: boolean, status: number) => void;
}

interface ParsedV2Document {
  snapshot: RemoteProfilesSnapshot;
  profileKeys: Set<string>;
  tombstoneKeys: Set<string>;
  settingKeys: Map<string, Set<string>>;
}

interface PatchContext {
  profileKeys: ReadonlySet<string>;
  tombstoneKeys: ReadonlySet<string>;
  settingKeys: ReadonlyMap<string, ReadonlySet<string>>;
}

const MAX_STORED_TOMBSTONES = MAX_PROFILES * 10;
const MAX_PROFILE_RESPONSE_CHARACTERS = 5_000_000;

type GetResult = { state: 'ok'; body: unknown } | { state: 'unavailable' } | { state: 'corrupt' };

function hasKeys(value: object): boolean {
  return Object.keys(value).length > 0;
}

function parseV2(value: unknown): ParsedV2Document | 'empty' | 'corrupt' {
  if (!isRecord(value)) return 'corrupt';
  if (!hasKeys(value)) return 'empty';
  if (
    value.schemaVersion !== 2 ||
    !isSafeNonNegativeInteger(value.revision) ||
    !isRecord(value.profiles) ||
    !isRecord(value.tombstones) ||
    (value.defaultId !== null && typeof value.defaultId !== 'string')
  ) {
    return 'corrupt';
  }
  const profileEntries = Object.entries(value.profiles);
  const tombstoneEntries = Object.entries(value.tombstones);
  if (profileEntries.length > MAX_PROFILES || tombstoneEntries.length > MAX_STORED_TOMBSTONES) {
    return 'corrupt';
  }
  const profiles: Profile[] = [];
  const profileKeys = new Set<string>();
  const settingKeys = new Map<string, Set<string>>();
  for (const [key, profile] of profileEntries) {
    if (cleanProfileId(key) === undefined) return 'corrupt';
    profileKeys.add(key);
    if (!isStoredProfile(profile) || profile.id !== key) return 'corrupt';
    profiles.push({ ...profile, settings: sanitizeProfileSettings(profile.settings) });
    settingKeys.set(key, new Set(Object.keys(profile.settings)));
  }
  const tombstones: ProfileTombstone[] = [];
  const tombstoneKeys = new Set<string>();
  for (const [key, tombstone] of tombstoneEntries) {
    if (cleanProfileId(key) === undefined) return 'corrupt';
    tombstoneKeys.add(key);
    if (!isProfileTombstone(tombstone) || tombstone.id !== key) return 'corrupt';
    tombstones.push(tombstone);
  }
  if (
    value.defaultId !== null &&
    (cleanProfileId(value.defaultId) === undefined ||
      !profiles.some((profile) => profile.id === value.defaultId))
  ) {
    return 'corrupt';
  }
  return {
    snapshot: {
      profiles,
      tombstones,
      defaultId: value.defaultId ?? undefined,
      revision: value.revision,
    },
    profileKeys,
    tombstoneKeys,
    settingKeys,
  };
}

function parseV1(value: unknown): Omit<RemoteProfilesSnapshot, 'revision'> | 'empty' | 'corrupt' {
  if (!isRecord(value)) return 'corrupt';
  if (!hasKeys(value)) return 'empty';
  if (!Array.isArray(value.profiles) || value.profiles.length > MAX_PROFILES) return 'corrupt';
  const storedProfiles = value.profiles.filter(isStoredProfile);
  if (storedProfiles.length !== value.profiles.length) return 'corrupt';
  const profiles = storedProfiles.map((profile) => ({
    ...profile,
    settings: sanitizeProfileSettings(profile.settings),
  }));
  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) return 'corrupt';
  return {
    profiles,
    tombstones: [],
    defaultId:
      typeof value.defaultId === 'string' &&
      profiles.some((profile) => profile.id === value.defaultId)
        ? value.defaultId
        : undefined,
  };
}

function storedDocument(snapshot: Omit<RemoteProfilesSnapshot, 'revision'>): StoredProfilesV2 {
  return {
    schemaVersion: 2,
    revision: 0,
    profiles: Object.fromEntries(snapshot.profiles.map((profile) => [profile.id, profile])),
    tombstones: Object.fromEntries(
      snapshot.tombstones.map((tombstone) => [tombstone.id, tombstone]),
    ),
    defaultId: snapshot.defaultId ?? null,
  };
}

function pointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

type JsonPatchOperation =
  | { op: 'test'; path: string; value: unknown }
  | { op: 'add' | 'replace'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'copy'; from: string; path: string };

function toPatch(
  revision: number,
  mutation: ProfileServerMutation,
  context: PatchContext,
): JsonPatchOperation[] {
  const patch: JsonPatchOperation[] = [{ op: 'test', path: '/revision', value: revision }];
  for (const operation of mutation.profiles) {
    if (operation.type === 'put') {
      const id = pointerSegment(operation.profile.id);
      patch.push({ op: 'add', path: `/profiles/${id}`, value: operation.profile });
      if (context.tombstoneKeys.has(operation.profile.id)) {
        patch.push({ op: 'remove', path: `/tombstones/${id}` });
      }
      continue;
    }
    if (operation.type === 'delete') {
      const id = pointerSegment(operation.tombstone.id);
      patch.push({ op: 'add', path: `/tombstones/${id}`, value: operation.tombstone });
      if (context.profileKeys.has(operation.tombstone.id)) {
        patch.push({ op: 'remove', path: `/profiles/${id}` });
      }
      continue;
    }
    const id = pointerSegment(operation.id);
    if (operation.type === 'patch') {
      for (const [key, value] of Object.entries(operation.settings)) {
        const path = `/profiles/${id}/settings/${pointerSegment(key)}`;
        if (value === undefined) {
          if (context.settingKeys.get(operation.id)?.has(key)) patch.push({ op: 'remove', path });
        } else {
          patch.push({ op: 'add', path, value });
        }
      }
      patch.push({
        op: 'add',
        path: `/profiles/${id}/settingUpdatedAt`,
        value: operation.settingUpdatedAt,
      });
      patch.push({
        op: 'add',
        path: `/profiles/${id}/updatedAt`,
        value: operation.updatedAt,
      });
      continue;
    }
    patch.push({ op: 'add', path: `/profiles/${id}/name`, value: operation.name });
    patch.push({
      op: 'add',
      path: `/profiles/${id}/nameUpdatedAt`,
      value: operation.nameUpdatedAt,
    });
    patch.push({
      op: 'add',
      path: `/profiles/${id}/updatedAt`,
      value: operation.updatedAt,
    });
  }
  if (mutation.defaultId !== undefined) {
    patch.push({ op: 'add', path: '/defaultId', value: mutation.defaultId });
  }
  patch.push({ op: 'replace', path: '/revision', value: revision + 1 });
  return patch;
}

function toInitializationPatch(document: StoredProfilesV2): JsonPatchOperation[] {
  const sentinel = '/_binnacleProfileSchemaVersion';
  return [
    // Signal K's json-patch copy operation refuses to replace an existing destination. Create a
    // temporary source, then copy it to schemaVersion. The copy succeeds only for an empty document,
    // making initialization conditional under the server's per-file write lock.
    { op: 'add', path: sentinel, value: document.schemaVersion },
    { op: 'copy', from: sentinel, path: '/schemaVersion' },
    { op: 'remove', path: sentinel },
    { op: 'add', path: '/revision', value: document.revision },
    { op: 'add', path: '/profiles', value: document.profiles },
    { op: 'add', path: '/tombstones', value: document.tombstones },
    { op: 'add', path: '/defaultId', value: document.defaultId },
  ];
}

function isRevisionConflict(response: { status: number; body?: string }): boolean {
  return (
    response.status === 409 ||
    response.status === 412 ||
    (response.status === 500 && response.body?.includes('Patch test failed') === true)
  );
}

function isInitializationConflict(response: { status: number; body?: string }): boolean {
  return (
    isRevisionConflict(response) ||
    (response.status === 500 && response.body?.includes('Value at schemaVersion exists') === true)
  );
}

export class SignalKProfileAdapter implements AsyncProfileAdapter {
  #base: string;
  #token: () => string | undefined;
  #fetch: typeof fetch;
  #onWriteOutcome: ((ok: boolean, status: number) => void) | undefined;
  #profileKeys = new Set<string>();
  #tombstoneKeys = new Set<string>();
  #settingKeys = new Map<string, Set<string>>();

  constructor(
    base: string,
    token: () => string | undefined,
    options: SignalKProfileAdapterOptions = {},
  ) {
    this.#base = base;
    this.#token = token;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#onWriteOutcome = options.onWriteOutcome;
  }

  async load(): Promise<ProfileRemoteLoadResult> {
    const v2 = await this.#get(appDataUrl(this.#base, V2));
    if (v2.state !== 'ok') return { state: v2.state };
    const parsedV2 = parseV2(v2.body);
    if (parsedV2 !== 'empty') {
      if (parsedV2 === 'corrupt') return { state: 'corrupt' };
      this.#profileKeys = parsedV2.profileKeys;
      this.#tombstoneKeys = parsedV2.tombstoneKeys;
      this.#settingKeys = parsedV2.settingKeys;
      return { state: 'ok', snapshot: parsedV2.snapshot };
    }

    const v1 = await this.#get(appDataUrl(this.#base, V1));
    if (v1.state !== 'ok') return { state: v1.state };
    const parsedV1 = parseV1(v1.body);
    if (parsedV1 === 'corrupt') return { state: 'corrupt' };
    const initial =
      parsedV1 === 'empty'
        ? storedDocument({ profiles: [], tombstones: [], defaultId: undefined })
        : storedDocument(parsedV1);
    this.#profileKeys = new Set(Object.keys(initial.profiles));
    this.#tombstoneKeys = new Set(Object.keys(initial.tombstones));
    this.#settingKeys = new Map(
      Object.values(initial.profiles).map((profile) => [
        profile.id,
        new Set(Object.keys(profile.settings)),
      ]),
    );
    const initialized = await this.#post(
      appDataUrl(this.#base, V2),
      toInitializationPatch(initial),
    );
    const readback = await this.#get(appDataUrl(this.#base, V2));
    if (readback.state !== 'ok') return { state: readback.state };
    const parsedReadback = parseV2(readback.body);
    if (parsedReadback === 'corrupt' || (parsedReadback === 'empty' && initialized.ok)) {
      return { state: 'corrupt' };
    }
    if (parsedReadback === 'empty') {
      return {
        state: 'ok',
        snapshot: {
          profiles: Object.values(initial.profiles),
          tombstones: Object.values(initial.tombstones),
          defaultId: initial.defaultId ?? undefined,
          revision: initial.revision,
        },
        writable: false,
      };
    }
    this.#profileKeys = parsedReadback.profileKeys;
    this.#tombstoneKeys = parsedReadback.tombstoneKeys;
    this.#settingKeys = parsedReadback.settingKeys;
    return {
      state: 'ok',
      snapshot: parsedReadback.snapshot,
      writable: initialized.ok || isInitializationConflict(initialized),
    };
  }

  async mutate(
    revision: number,
    mutation: ProfileServerMutation,
  ): Promise<ProfileRemoteMutationResult> {
    if (revision >= Number.MAX_SAFE_INTEGER) return 'unavailable';
    const response = await this.#post(
      appDataUrl(this.#base, V2),
      toPatch(revision, mutation, {
        profileKeys: this.#profileKeys,
        tombstoneKeys: this.#tombstoneKeys,
        settingKeys: this.#settingKeys,
      }),
    );
    if (response.ok) {
      this.#applyMutationContext(mutation);
      return 'ok';
    }
    if (isRevisionConflict(response)) return 'conflict';
    return 'unavailable';
  }

  #applyMutationContext(mutation: ProfileServerMutation): void {
    for (const operation of mutation.profiles) {
      if (operation.type === 'put') {
        this.#profileKeys.add(operation.profile.id);
        this.#tombstoneKeys.delete(operation.profile.id);
        this.#settingKeys.set(
          operation.profile.id,
          new Set(Object.keys(operation.profile.settings)),
        );
      } else if (operation.type === 'delete') {
        this.#tombstoneKeys.add(operation.tombstone.id);
        this.#profileKeys.delete(operation.tombstone.id);
        this.#settingKeys.delete(operation.tombstone.id);
      } else if (operation.type === 'patch') {
        const keys = this.#settingKeys.get(operation.id) ?? new Set<string>();
        for (const [key, value] of Object.entries(operation.settings)) {
          if (value === undefined) keys.delete(key);
          else keys.add(key);
        }
        this.#settingKeys.set(operation.id, keys);
      }
    }
  }

  async #post(url: string, body: unknown): Promise<{ ok: boolean; status: number; body?: string }> {
    try {
      const response = await this.#fetch(
        url,
        withTimeout(
          authInit(this.#token(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
        ),
      );
      this.#onWriteOutcome?.(response.ok, response.status);
      let responseBody: string | undefined;
      if (!response.ok) {
        try {
          responseBody = await response.text();
        } catch {
          // The status still distinguishes authorization and transport failures when no body exists.
        }
      }
      return { ok: response.ok, status: response.status, body: responseBody };
    } catch {
      this.#onWriteOutcome?.(false, 0);
      return { ok: false, status: 0 };
    }
  }

  async #get(url: string): Promise<GetResult> {
    try {
      const response = await this.#fetch(url, withTimeout(authInit(this.#token())));
      if (!response.ok) return { state: 'unavailable' };
      const contentLength = Number(response.headers.get('Content-Length'));
      if (Number.isFinite(contentLength) && contentLength > MAX_PROFILE_RESPONSE_CHARACTERS) {
        return { state: 'corrupt' };
      }
      const text = await response.text();
      if (text.length > MAX_PROFILE_RESPONSE_CHARACTERS) return { state: 'corrupt' };
      try {
        return { state: 'ok', body: JSON.parse(text) };
      } catch {
        return { state: 'corrupt' };
      }
    } catch {
      return { state: 'unavailable' };
    }
  }
}
