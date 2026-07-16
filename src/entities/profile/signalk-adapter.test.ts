import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '$shared/testing';
import type { Profile, ProfileServerMutation, ProfileSettings } from './profile-types';
import { SignalKProfileAdapter } from './signalk-adapter';

const V1_URL = 'http://pi/signalk/v1/applicationData/user/signalk-binnacle/1.0.0';
const V2_URL = 'http://pi/signalk/v1/applicationData/user/signalk-binnacle/2.0.0';

function settings(): ProfileSettings {
  return {
    theme: 'day',
    layers: {},
    layerOrder: [],
    weatherLayers: {},
    thresholds: {
      dangerCpaMeters: 926,
      dangerTcpaSeconds: 600,
      warningCpaMeters: 1852,
      warningTcpaSeconds: 1200,
    },
    trackSettings: { intervalSeconds: 10, minMeters: 10, colorMode: 'speed' },
    planningSpeedKn: 6,
  };
}

const PROFILE: Profile = {
  id: 'a',
  name: 'Coastal',
  settings: settings(),
  createdAt: 1,
  updatedAt: 2,
};

function v2Document(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    revision: 0,
    profiles: { a: PROFILE },
    tombstones: {},
    defaultId: 'a',
    ...overrides,
  };
}

describe('SignalKProfileAdapter', () => {
  it('loads and validates a v2 document with bearer authentication', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        schemaVersion: 2,
        revision: 4,
        profiles: { a: PROFILE },
        tombstones: {},
        defaultId: 'a',
      }),
    );
    const loaded = await new SignalKProfileAdapter('http://pi', () => 'tok', {
      fetch: fetchMock,
    }).load();
    expect(loaded).toEqual({
      state: 'ok',
      snapshot: {
        profiles: [PROFILE],
        tombstones: [],
        defaultId: 'a',
        revision: 4,
      },
    });
    expect(fetchMock.mock.calls[0][0]).toBe(V2_URL);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer tok',
    });
  });

  it('migrates v1 into an initialized v2 document without modifying v1', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, {}))
      .mockResolvedValueOnce(
        jsonResponse(200, { profiles: [PROFILE], activeId: 'a', defaultId: 'a' }),
      )
      .mockResolvedValueOnce(jsonResponse(200, {}))
      .mockResolvedValueOnce(jsonResponse(200, v2Document()));
    const loaded = await new SignalKProfileAdapter('http://pi', () => 'tok', {
      fetch: fetchMock,
    }).load();
    expect(loaded.state).toBe('ok');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([V2_URL, V1_URL, V2_URL, V2_URL]);
    const init = fetchMock.mock.calls[2][1] as RequestInit;
    const body = JSON.parse(init.body as string) as Array<Record<string, unknown>>;
    expect(body[0]).toEqual({
      op: 'add',
      path: '/_binnacleProfileSchemaVersion',
      value: 2,
    });
    expect(body[1]).toEqual({
      op: 'copy',
      from: '/_binnacleProfileSchemaVersion',
      path: '/schemaVersion',
    });
    expect(body).toContainEqual({ op: 'add', path: '/revision', value: 0 });
    expect(body).toContainEqual({ op: 'add', path: '/defaultId', value: 'a' });
    expect(JSON.stringify(body)).not.toContain('activeId');
  });

  it('reads back a concurrently initialized v2 document without overwriting it', async () => {
    const concurrent = v2Document({
      revision: 3,
      profiles: { a: { ...PROFILE, name: 'Concurrent helm', updatedAt: 3 } },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, {}))
      .mockResolvedValueOnce(jsonResponse(200, { profiles: [PROFILE], defaultId: 'a' }))
      .mockResolvedValueOnce(jsonResponse(500, 'Value at schemaVersion exists'))
      .mockResolvedValueOnce(jsonResponse(200, concurrent));

    const loaded = await new SignalKProfileAdapter('http://pi', () => 'tok', {
      fetch: fetchMock,
    }).load();

    expect(loaded.state).toBe('ok');
    if (loaded.state === 'ok') {
      expect(loaded.writable).toBe(true);
      expect(loaded.snapshot.revision).toBe(3);
      expect(loaded.snapshot.profiles[0].name).toBe('Concurrent helm');
    }
  });

  it('still loads v1 profiles when the account cannot initialize v2', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, {}))
      .mockResolvedValueOnce(jsonResponse(200, { profiles: [PROFILE], defaultId: 'a' }))
      .mockResolvedValueOnce(jsonResponse(403, {}))
      .mockResolvedValueOnce(jsonResponse(200, {}));
    const loaded = await new SignalKProfileAdapter('http://pi', () => 'tok', {
      fetch: fetchMock,
    }).load();

    expect(loaded).toEqual({
      state: 'ok',
      snapshot: {
        profiles: [PROFILE],
        tombstones: [],
        defaultId: 'a',
        revision: 0,
      },
      writable: false,
    });
  });

  it('does not overwrite a nonempty malformed v2 document', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { schemaVersion: 9 }));
    expect(
      await new SignalKProfileAdapter('http://pi', () => 'tok', { fetch: fetchMock }).load(),
    ).toEqual({ state: 'corrupt' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects unsafe record keys and dangling defaults in v2 documents', async () => {
    const unsafeKey = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, v2Document({ profiles: { 'a.__proto__': null } })));
    expect(
      await new SignalKProfileAdapter('http://pi', () => 'tok', { fetch: unsafeKey }).load(),
    ).toEqual({ state: 'corrupt' });

    const danglingDefault = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, v2Document({ defaultId: 'missing' })));
    expect(
      await new SignalKProfileAdapter('http://pi', () => 'tok', {
        fetch: danglingDefault,
      }).load(),
    ).toEqual({ state: 'corrupt' });
  });

  it('strips legacy device and safety settings while loading', async () => {
    const legacy = {
      ...PROFILE,
      settings: {
        ...PROFILE.settings,
        layerCategories: { charts: true },
        arrivalMuted: true,
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, v2Document({ profiles: { a: legacy } })));
    const loaded = await new SignalKProfileAdapter('http://pi', () => 'tok', {
      fetch: fetchMock,
    }).load();

    expect(loaded.state).toBe('ok');
    if (loaded.state === 'ok') {
      expect(loaded.snapshot.profiles[0].settings).not.toHaveProperty('layerCategories');
      expect(loaded.snapshot.profiles[0].settings).not.toHaveProperty('arrivalMuted');
    }
  });

  it('posts a revision test and field-level profile patch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const mutation: ProfileServerMutation = {
      profiles: [
        {
          type: 'patch',
          id: 'a',
          settings: { instrumentTiles: ['depth', 'battery:house'] },
          settingUpdatedAt: { instrumentTiles: 9 },
          updatedAt: 9,
        },
      ],
    };
    const result = await new SignalKProfileAdapter('http://pi', () => 'tok', {
      fetch: fetchMock,
    }).mutate(4, mutation);
    expect(result).toBe('ok');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(V2_URL);
    const patch = JSON.parse((init as RequestInit).body as string) as Array<
      Record<string, unknown>
    >;
    expect(patch[0]).toEqual({ op: 'test', path: '/revision', value: 4 });
    expect(patch).toContainEqual({
      op: 'add',
      path: '/profiles/a/settings/instrumentTiles',
      value: ['depth', 'battery:house'],
    });
    expect(patch).toContainEqual({
      op: 'add',
      path: '/profiles/a/settingUpdatedAt',
      value: { instrumentTiles: 9 },
    });
    expect(patch.at(-1)).toEqual({ op: 'replace', path: '/revision', value: 5 });
  });

  it('classifies a failed revision test as a conflict', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, 'Patch test failed'));
    expect(
      await new SignalKProfileAdapter('http://pi', () => 'tok', { fetch: fetchMock }).mutate(2, {
        profiles: [],
        defaultId: null,
      }),
    ).toBe('conflict');
  });

  it('does not misclassify an unrelated server error as a conflict', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, 'Disk write failed'));
    expect(
      await new SignalKProfileAdapter('http://pi', () => 'tok', { fetch: fetchMock }).mutate(2, {
        profiles: [],
      }),
    ).toBe('unavailable');
  });

  it('refuses to overflow the server revision', async () => {
    const fetchMock = vi.fn();
    expect(
      await new SignalKProfileAdapter('http://pi', () => 'tok', { fetch: fetchMock }).mutate(
        Number.MAX_SAFE_INTEGER,
        { profiles: [] },
      ),
    ).toBe('unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a profile response that exceeds the size limit', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Length': '5000001' }),
      text: async () => '{}',
    } as Response);
    expect(
      await new SignalKProfileAdapter('http://pi', () => 'tok', { fetch: fetchMock }).load(),
    ).toEqual({ state: 'corrupt' });
  });

  it('removes the superseded profile record when writing a tombstone', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          schemaVersion: 2,
          revision: 4,
          profiles: { a: PROFILE },
          tombstones: {},
          defaultId: null,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, {}));
    const adapter = new SignalKProfileAdapter('http://pi', () => 'tok', { fetch: fetchMock });
    await adapter.load();
    await adapter.mutate(4, {
      profiles: [{ type: 'delete', tombstone: { id: 'a', deletedAt: 9 } }],
    });

    const patch = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as Array<
      Record<string, unknown>
    >;
    expect(patch).toContainEqual({
      op: 'add',
      path: '/tombstones/a',
      value: { id: 'a', deletedAt: 9 },
    });
    expect(patch).toContainEqual({ op: 'remove', path: '/profiles/a' });
  });

  it('reports profile write outcomes to authentication state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, {}));
    const onWriteOutcome = vi.fn();
    await new SignalKProfileAdapter('http://pi', () => 'tok', {
      fetch: fetchMock,
      onWriteOutcome,
    }).mutate(2, { profiles: [] });
    expect(onWriteOutcome).toHaveBeenCalledWith(false, 403);
  });
});
