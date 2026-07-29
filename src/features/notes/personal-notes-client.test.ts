import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '$shared/testing';
import { PERSONAL_NOTE_NAMESPACE } from './personal-note-contract';
import {
  deletePersonalNote,
  probePersonalNotesCapability,
  savePersonalNote,
} from './personal-notes-client';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const input = {
  name: 'Quiet cove',
  text: 'Good holding in mud.',
  category: 'anchorage' as const,
  position: { latitude: 44, longitude: -86 },
};

describe('personal notes client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('probes v2 first and reports a v1-only server as read-only', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(404, {}))
        .mockResolvedValueOnce(jsonResponse(200, {})),
    );
    expect(await probePersonalNotesCapability('http://sk', 'token')).toBe('read-only-v1');
  });

  it('writes the standard note resource and returns the optimistic chart point', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    const result = await savePersonalNote('http://sk', 'token', ID, input);
    expect(result).toMatchObject({
      result: 'ok',
      note: {
        id: ID,
        name: 'Quiet cove',
        description: 'Good holding in mud.',
        ownedByBinnacle: true,
      },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://sk/signalk/v2/api/resources/notes/${ID}`);
    expect(init.method).toBe('PUT');
    const body = JSON.parse(String(init.body));
    expect(body.properties[PERSONAL_NOTE_NAMESPACE]).toEqual({
      schemaVersion: 1,
      kind: 'personal-note',
      category: 'anchorage',
    });
  });

  it('classifies access refusal and never deletes an unowned note', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(403, {})));
    expect((await savePersonalNote('http://sk', 'token', ID, input)).result).toBe('access-denied');
    expect(
      await deletePersonalNote('http://sk', 'token', {
        id: ID,
        ownedByBinnacle: false,
      }),
    ).toBe('failed');
  });
});
