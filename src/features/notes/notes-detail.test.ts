import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '$shared/testing';
import { createNoteDetailLoader, fetchNoteDetail, plainText, safeHttpUrl } from './notes-detail';

const structured = {
  name: 'Whipple Point Light',
  url: 'https://example/poi/1',
  description: '<h4>Whipple Point Light</h4>',
  properties: {
    attribution: '© USCG',
    sources: ['usclightlist'],
    crowsNest: {
      schemaVersion: 1,
      type: 'Navigational',
      sections: [
        {
          id: 'light',
          title: 'Light',
          items: [
            { label: 'Character', value: 'Fl W 4s', kind: 'text' },
            { label: 'Nominal range', value: 14, kind: 'measure', unit: 'NM' },
          ],
        },
      ],
    },
  },
};

describe('fetchNoteDetail', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses a schema-1 detail into sections', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, structured)));
    const detail = await fetchNoteDetail('http://pi', 'tok', 'lll-1');
    expect(detail).toMatchObject({
      id: 'lll-1',
      name: 'Whipple Point Light',
      type: 'Navigational',
      attribution: '© USCG',
      sources: ['usclightlist'],
      url: 'https://example/poi/1',
    });
    expect(detail?.sections).toHaveLength(1);
    expect(detail?.sections?.[0].items[1]).toEqual({
      label: 'Nominal range',
      value: 14,
      kind: 'measure',
      unit: 'NM',
    });
    expect(detail?.fallbackText).toBeUndefined();
  });

  it('defaults a kind-less item with a unit to a measure so the unit renders', async () => {
    const body = {
      ...structured,
      properties: {
        ...structured.properties,
        crowsNest: {
          schemaVersion: 1,
          type: 'Navigational',
          sections: [
            { id: 'd', title: 'Depths', items: [{ label: 'Depth', value: 4.2, unit: 'm' }] },
          ],
        },
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, body)));
    const detail = await fetchNoteDetail('http://pi', undefined, 'd-1');
    expect(detail?.sections?.[0].items[0]).toEqual({
      label: 'Depth',
      value: 4.2,
      kind: 'measure',
      unit: 'm',
    });
  });

  it('drops non-finite measures and out-of-range ratings', async () => {
    const body = {
      ...structured,
      properties: {
        ...structured.properties,
        crowsNest: {
          schemaVersion: 1,
          type: 'Marina',
          sections: [
            {
              id: 'quality',
              title: 'Quality',
              items: [
                { label: 'Depth', value: Number.NaN, kind: 'measure', unit: 'm' },
                { label: 'Rating', value: 99, kind: 'rating' },
                { label: 'Valid rating', value: 4.5, kind: 'rating' },
              ],
            },
          ],
        },
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, body)));
    const detail = await fetchNoteDetail('http://pi', undefined, 'safe');
    expect(detail?.sections?.[0].items).toEqual([
      { label: 'Valid rating', value: 4.5, kind: 'rating' },
    ]);
  });

  it('keeps duplicate structured sections with deterministic unique ids', async () => {
    const section = {
      title: 'Details',
      items: [{ label: 'Value', value: 'Kept' }],
    };
    const body = {
      ...structured,
      properties: {
        ...structured.properties,
        crowsNest: {
          schemaVersion: 1,
          type: 'Marina',
          sections: [
            { ...section, id: 'details' },
            { ...section, id: 'details' },
            { ...section, id: 'details:2' },
          ],
        },
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, body)));

    const detail = await fetchNoteDetail('http://pi', undefined, 'duplicate-sections');

    expect(detail?.sections?.map(({ id }) => id)).toEqual(['details', 'details:3', 'details:2']);
    expect(detail?.sections).toHaveLength(3);
  });

  it('falls back to plain text when crowsNest is absent', async () => {
    const body = { name: 'Plain Note', description: '<p>Hello <b>there</b></p>', properties: {} };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, body)));
    const detail = await fetchNoteDetail('http://pi', undefined, 'n1');
    expect(detail?.sections).toBeUndefined();
    expect(detail?.fallbackText).toBe('Hello there');
  });

  it('falls back when the schemaVersion is unrecognized', async () => {
    const body = {
      name: 'Future Note',
      description: '<p>future</p>',
      properties: { crowsNest: { schemaVersion: 2, type: 'Marina', sections: [] } },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, body)));
    const detail = await fetchNoteDetail('http://pi', undefined, 'n2');
    expect(detail?.sections).toBeUndefined();
    expect(detail?.fallbackText).toBe('future');
  });

  it('tries v1 when v2 is not ok', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(jsonResponse(200, structured));
    vi.stubGlobal('fetch', fetchMock);
    const detail = await fetchNoteDetail('http://pi', undefined, 'lll-1');
    expect(detail?.name).toBe('Whipple Point Light');
    expect(fetchMock.mock.calls[1][0]).toContain('/signalk/v1/api/resources/notes/lll-1');
  });

  it('returns undefined on error and on a thrown fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {})));
    expect(await fetchNoteDetail('http://pi', undefined, 'x')).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('net')));
    expect(await fetchNoteDetail('http://pi', undefined, 'x')).toBeUndefined();
  });

  it('refuses an empty id without fetching the collection endpoint', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchNoteDetail('http://pi', undefined, '')).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('createNoteDetailLoader', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('caches by id and does not cache a failure', async () => {
    // A failed load does both v2 and v1 (two fetches) and is not cached; the next load
    // succeeds on v2 (one fetch) and is cached, so the third load does not fetch.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, {})) // load1 v2
      .mockResolvedValueOnce(jsonResponse(500, {})) // load1 v1
      .mockResolvedValue(jsonResponse(200, structured)); // load2 v2
    vi.stubGlobal('fetch', fetchMock);
    const loader = createNoteDetailLoader('http://pi', () => 'tok');
    expect(await loader.load('lll-1')).toBeUndefined();
    expect((await loader.load('lll-1'))?.name).toBe('Whipple Point Light');
    await loader.load('lll-1'); // cached, no fetch
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('invalidates an accepted detail after an edit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, structured));
    vi.stubGlobal('fetch', fetchMock);
    const loader = createNoteDetailLoader('http://pi', () => 'tok');
    await loader.load('lll-1');
    await loader.load('lll-1');
    expect(fetchMock).toHaveBeenCalledOnce();
    loader.invalidate('lll-1');
    await loader.load('lll-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('plainText and safeHttpUrl', () => {
  it('strips tags and collapses whitespace', () => {
    expect(plainText('<p>a   <b>b</b></p>\n c')).toBe('a b c');
  });
  it('allows only http(s) urls', () => {
    expect(safeHttpUrl('https://x.test/p')).toBe('https://x.test/p');
    expect(safeHttpUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeHttpUrl('not a url')).toBeUndefined();
    expect(safeHttpUrl(`https://x.test/${'x'.repeat(3_000)}`)).toBeUndefined();
  });
});
