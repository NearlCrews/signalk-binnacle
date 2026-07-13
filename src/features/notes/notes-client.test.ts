import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '$shared/testing/fetch-stub';
import { fetchNotes } from './notes-client';

describe('fetchNotes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requests with a bbox and no provider, and parses positioned notes with detail', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        a: {
          name: 'Harbor Marina',
          position: { latitude: 42.6, longitude: -83.5 },
          url: 'https://example/poi/1',
          properties: {
            skIcon: 'marina',
            source: 'activecaptain',
            attribution: 'Data from Garmin ActiveCaptain',
          },
        },
        b: {
          title: 'Quiet Cove',
          position: { latitude: 42.7, longitude: -83.4 },
          properties: { skIcon: 'anchorage' },
        },
        c: { name: 'No position here', properties: { skIcon: 'hazard' } },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const notes = (await fetchNotes('http://pi', 'tok', [-84, 42, -83, 43])) ?? [];
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({
      id: 'a',
      name: 'Harbor Marina',
      position: { latitude: 42.6, longitude: -83.5 },
      category: 'marina',
      skIcon: 'marina',
      url: 'https://example/poi/1',
      source: 'activecaptain',
      attribution: 'Data from Garmin ActiveCaptain',
    });
    // name falls back to title; category from skIcon.
    expect(notes[1]).toMatchObject({ name: 'Quiet Cove', category: 'anchorage' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/signalk/v2/api/resources/notes?');
    expect(url).toContain('bbox=');
    expect(url).not.toContain('provider=');
    expect((init as RequestInit).headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('returns undefined on an error response so the overlay keeps its markers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(400, { state: 'FAILED' })));
    expect(await fetchNotes('http://pi', undefined, [0, 0, 1, 1])).toBeUndefined();
  });

  it('returns undefined when the fetch throws so the overlay keeps its markers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    expect(await fetchNotes('http://pi', undefined, [0, 0, 1, 1])).toBeUndefined();
  });

  it('returns an empty list for a reachable area with no notes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {})));
    expect(await fetchNotes('http://pi', undefined, [0, 0, 1, 1])).toEqual([]);
  });

  it('falls back to the v1 notes collection', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          old: { name: 'Legacy note', position: { latitude: 42, longitude: -83 } },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchNotes('http://pi', undefined, [-84, 41, -82, 43])).toEqual([
      expect.objectContaining({ id: 'old', name: 'Legacy note' }),
    ]);
    expect(fetchMock.mock.calls[1][0]).toContain('/signalk/v1/api/resources/notes?');
  });

  it('rejects out-of-range coordinates and cleans provider text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          north: { name: 'Past the pole', position: { latitude: 91, longitude: 0 } },
          east: { name: 'Past the dateline', position: { latitude: 0, longitude: 181 } },
          clean: {
            name: '   ',
            title: '  Fuel Dock  ',
            position: { latitude: 42, longitude: -83 },
            url: '  https://example/clean  ',
            properties: { source: '  Harbor Guide  ', attribution: '   ' },
          },
        }),
      ),
    );

    expect(await fetchNotes('http://pi', undefined, [-84, 41, -82, 43])).toEqual([
      expect.objectContaining({
        id: 'clean',
        name: 'Fuel Dock',
        url: 'https://example/clean',
        source: 'Harbor Guide',
        attribution: undefined,
      }),
    ]);
  });

  it('rejects unsafe ids and bounds provider strings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          '\u0000bad': { name: 'Bad id', position: { latitude: 42, longitude: -83 } },
          good: {
            name: `  ${'n'.repeat(400)}  `,
            position: { latitude: 42, longitude: -83 },
            properties: { source: 's'.repeat(400), attribution: 'a'.repeat(2_000) },
          },
        }),
      ),
    );
    const notes = await fetchNotes('http://pi', undefined, [-84, 41, -82, 43]);
    expect(notes).toHaveLength(1);
    expect(notes?.[0].name).toHaveLength(256);
    expect(notes?.[0].source).toHaveLength(256);
    expect(notes?.[0].attribution).toHaveLength(1024);
  });
});
