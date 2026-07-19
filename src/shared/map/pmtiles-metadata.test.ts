import { type Header, TileType } from 'pmtiles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapPmtilesMeta, readPmtilesMeta } from './pmtiles-metadata';

function header(over: Partial<Header> = {}): Header {
  return {
    specVersion: 3,
    rootDirectoryOffset: 0,
    rootDirectoryLength: 0,
    jsonMetadataOffset: 0,
    jsonMetadataLength: 0,
    leafDirectoryOffset: 0,
    tileDataOffset: 0,
    numAddressedTiles: 0,
    numTileEntries: 0,
    numTileContents: 0,
    clustered: true,
    internalCompression: 1,
    tileCompression: 1,
    tileType: TileType.Mvt,
    minZoom: 0,
    maxZoom: 14,
    minLon: -122.5,
    minLat: 37.7,
    maxLon: -122.3,
    maxLat: 37.9,
    centerZoom: 7,
    centerLon: -122.4,
    centerLat: 37.8,
    ...over,
  } as Header;
}

describe('mapPmtilesMeta', () => {
  it('maps an MVT header to a vector kind with header zoom and bounds', () => {
    const meta = mapPmtilesMeta(header(), {});
    expect(meta.kind).toBe('vector');
    expect(meta.minzoom).toBe(0);
    expect(meta.maxzoom).toBe(14);
    // [west, south, east, north]
    expect(meta.bounds).toEqual([-122.5, 37.7, -122.3, 37.9]);
  });

  it('maps an MLT header to a vector kind', () => {
    expect(mapPmtilesMeta(header({ tileType: TileType.Mlt }), {}).kind).toBe('vector');
  });

  it('treats every non-vector tile type as raster', () => {
    for (const tileType of [
      TileType.Png,
      TileType.Jpeg,
      TileType.Webp,
      TileType.Avif,
      TileType.Unknown,
    ]) {
      expect(mapPmtilesMeta(header({ tileType }), {}).kind).toBe('raster');
    }
  });

  it('reads name and vector_layers ids from metadata', () => {
    const meta = mapPmtilesMeta(header(), {
      name: 'Coastal',
      vector_layers: [{ id: 'water' }, { id: 'roads' }, { notId: 'x' }],
    });
    expect(meta.name).toBe('Coastal');
    expect(meta.vectorLayers).toEqual(['water', 'roads']);
  });

  it('omits optional fields when metadata is absent or empty', () => {
    const meta = mapPmtilesMeta(header(), undefined);
    expect(meta.name).toBeUndefined();
    expect(meta.vectorLayers).toBeUndefined();
  });

  it('omits degenerate latitude bounds and preserves an antimeridian crossing', () => {
    const zeroArea = mapPmtilesMeta(header({ minLon: 0, maxLon: 0, minLat: 0, maxLat: 0 }), {});
    expect(zeroArea.bounds).toBeUndefined();
    const crossing = mapPmtilesMeta(header({ minLon: 170, maxLon: -170 }), {});
    expect(crossing.bounds).toEqual([170, 37.7, -170, 37.9]);
  });

  it('bounds metadata text, deduplicates layers, and normalizes invalid zoom', () => {
    const meta = mapPmtilesMeta(header({ minZoom: -1, maxZoom: 99 }), {
      name: ` ${'x'.repeat(300)} `,
      vector_layers: [{ id: ' water ' }, { id: 'water' }, { id: 'bad\nlayer' }],
    });
    expect(meta.name).toBeUndefined();
    expect(meta.vectorLayers).toEqual(['water']);
    expect(meta.minzoom).toBe(0);
    expect(meta.maxzoom).toBe(0);
  });
});

describe('readPmtilesMeta', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('propagates caller cancellation into archive range reads', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const requestSignal = init?.signal;
      if (!requestSignal) throw new Error('missing request signal');
      return new Promise<Response>((_resolve, reject) => {
        requestSignal.addEventListener('abort', () => reject(requestSignal.reason), { once: true });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const pending = readPmtilesMeta('blob:http://localhost/chart.pmtiles', controller.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const requestSignal = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.signal;

    controller.abort(new DOMException('Import canceled', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(requestSignal?.aborted).toBe(true);
  });
});
