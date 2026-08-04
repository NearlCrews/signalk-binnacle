import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  capabilitiesFromControls,
  discoverRadars,
  fetchCapabilities,
  fetchRadarControls,
  parseRadarControls,
  setPower,
  spokesUrl,
  writeControl,
  writeStructuredControl,
} from './radar-client';
import type { RadarInfo } from './radar-types';

afterEach(() => vi.restoreAllMocks());

const RADARS_PATH = '/signalk/v2/api/vessels/self/radars';

const radar: RadarInfo = {
  id: 'nav1034A',
  name: 'Halo',
  brand: 'Navico',
  status: 'transmit',
  spokesPerRevolution: 2048,
  maxSpokeLen: 1024,
  range: 926,
  controls: { gain: { value: 50 }, rain: { value: 10, auto: false } },
  legend: [{ color: '#00ff00', label: 'weak', minValue: 0, maxValue: 63 }],
  streamUrl: 'ws://boat.local/signalk/v2/api/vessels/self/radars/nav1034A/stream',
};

describe('discoverRadars', () => {
  it('returns the parsed array on a 200 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                id: 'nav1034A',
                name: 'Halo',
                brand: 'Navico',
                status: 'transmit',
                spokesPerRevolution: 2048,
                maxSpokeLen: 1024,
                range: 926,
                controls: { gain: { value: 50 } },
              },
            ]),
            { status: 200 },
          ),
      ),
    );
    const result = await discoverRadars('http://boat.local', undefined);
    expect(result.radars).toHaveLength(1);
    expect(result.availability).toBe('available');
    expect(result.radars[0].id).toBe('nav1034A');
    expect(result.radars[0].name).toBe('Halo');
    expect(result.radars[0].status).toBe('transmit');
    expect(result.radars[0].spokesPerRevolution).toBe(2048);
    expect(result.radars[0].maxSpokeLen).toBe(1024);
    expect(result.radars[0].controls.gain?.value).toBe(50);
  });

  it('accepts bounded control-free string ids from the Radar API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                ...radar,
                id: 'radar:port.1/alpha',
                controls: { 'gain.fine': { value: 25 } },
              },
            ]),
            { status: 200 },
          ),
      ),
    );
    const result = await discoverRadars('http://boat.local', undefined);
    expect(result.radars[0].id).toBe('radar:port.1/alpha');
    expect(result.radars[0].controls['gain.fine']?.value).toBe(25);
  });

  it('collapses identical radar ids and rejects a conflicting radar identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              radar,
              { ...radar },
              { ...radar, id: 'conflict', name: 'First' },
              { ...radar, id: 'conflict', name: 'Second' },
            ]),
            { status: 200 },
          ),
      ),
    );

    const result = await discoverRadars('http://boat.local', undefined);
    expect(result.radars.map(({ id }) => id)).toEqual(['nav1034A']);
  });

  it('reports an absent provider on a 404 with no discovery detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );
    const result = await discoverRadars('http://boat.local', undefined);
    expect(result.availability).toBe('absent');
    expect(result.detail).toBeUndefined();
  });

  it('reports auth-required on a 403 auth refusal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 403 })),
    );
    expect((await discoverRadars('http://boat.local', undefined)).availability).toBe(
      'auth-required',
    );
  });

  it('returns no radars when fetch throws (network error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network failure');
      }),
    );
    expect((await discoverRadars('http://boat.local', undefined)).availability).toBe('unreachable');
  });

  it('returns no radars when the body is not an array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ nav1034A: { id: 'nav1034A' } }), { status: 200 }),
      ),
    );
    expect((await discoverRadars('http://boat.local', undefined)).radars).toEqual([]);
  });

  it('skips entries that have no id field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              { name: 'no-id', status: 'off', spokesPerRevolution: 2048, maxSpokeLen: 1024 },
              {
                id: 'good',
                name: 'Good',
                status: 'standby',
                spokesPerRevolution: 2048,
                maxSpokeLen: 1024,
                range: 0,
                controls: {},
              },
            ]),
            { status: 200 },
          ),
      ),
    );
    const result = await discoverRadars('http://boat.local', undefined);
    expect(result.radars).toHaveLength(1);
    expect(result.radars[0].id).toBe('good');
  });

  it('hits the v2 radars path', async () => {
    let capturedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        capturedUrl = url;
        return new Response(JSON.stringify([]), { status: 200 });
      }),
    );
    await discoverRadars('http://boat.local', undefined);
    expect(capturedUrl).toBe(`http://boat.local${RADARS_PATH}`);
  });

  it('drops legend entries that have no color', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                id: 'r',
                name: 'R',
                status: 'transmit',
                spokesPerRevolution: 2048,
                maxSpokeLen: 1024,
                range: 0,
                controls: {},
                legend: [{ label: 'no color' }, { color: '#00ff00', label: 'weak' }],
              },
            ]),
            { status: 200 },
          ),
      ),
    );
    const result = await discoverRadars('http://boat.local', undefined);
    expect(result.radars[0].legend).toEqual([
      { color: '#00ff00', label: 'weak', minValue: undefined, maxValue: undefined },
    ]);
  });

  it('treats a blank streamUrl as absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                id: 'r',
                name: 'R',
                status: 'transmit',
                spokesPerRevolution: 2048,
                maxSpokeLen: 1024,
                range: 0,
                controls: {},
                streamUrl: '   ',
              },
            ]),
            { status: 200 },
          ),
      ),
    );
    const result = await discoverRadars('http://boat.local', undefined);
    expect(result.radars[0].streamUrl).toBeUndefined();
  });

  it('rejects unsafe geometry instead of allocating an unbounded frame', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                id: 'unsafe',
                spokesPerRevolution: Number.MAX_SAFE_INTEGER,
                maxSpokeLen: 8192,
                controls: {},
              },
            ]),
            { status: 200 },
          ),
      ),
    );
    const result = await discoverRadars('http://boat.local', undefined);
    expect(result.radars).toEqual([]);
    expect(result.availability).toBe('invalid');
  });

  it('rejects an oversized radar catalog', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify(
              Array.from({ length: 17 }, (_, index) => ({
                id: `radar-${index}`,
                spokesPerRevolution: 2048,
                maxSpokeLen: 1024,
                controls: {},
              })),
            ),
            { status: 200 },
          ),
      ),
    );
    const result = await discoverRadars('http://boat.local', undefined);
    expect(result.radars).toEqual([]);
    expect(result.availability).toBe('invalid');
  });
});

describe('parseRadarControls', () => {
  it('drops control-character ids and non-finite values', () => {
    const controls = parseRadarControls({
      gain: { value: 12, autoValue: 10 },
      'bad\u0000id': { value: 50 },
      rain: { value: Number.NaN },
    });
    expect(controls).toEqual({
      gain: {
        value: 12,
        auto: undefined,
        autoValue: 10,
        enabled: undefined,
        endValue: undefined,
        startDistance: undefined,
        endDistance: undefined,
        x1: undefined,
        y1: undefined,
        x2: undefined,
        y2: undefined,
        width: undefined,
        allowed: undefined,
      },
      rain: {
        value: undefined,
        auto: undefined,
        autoValue: undefined,
        enabled: undefined,
        endValue: undefined,
        startDistance: undefined,
        endDistance: undefined,
        x1: undefined,
        y1: undefined,
        x2: undefined,
        y2: undefined,
        width: undefined,
        allowed: undefined,
      },
    });
  });

  it('parses the documented zone and rectangle fields and drops unsafe magnitudes', () => {
    const controls = parseRadarControls({
      guardZone1: {
        value: -1,
        endValue: 1,
        startDistance: 200,
        endDistance: 500,
        enabled: false,
        allowed: true,
      },
      exclusionRect1: { x1: -100, y1: 50, x2: 100, y2: 50, width: 20 },
      unsafe: { startDistance: -1, endDistance: 1_000_001, x1: Number.POSITIVE_INFINITY },
    });
    expect(controls.guardZone1).toMatchObject({
      value: -1,
      endValue: 1,
      startDistance: 200,
      endDistance: 500,
      enabled: false,
      allowed: true,
    });
    expect(controls.exclusionRect1).toMatchObject({
      x1: -100,
      y1: 50,
      x2: 100,
      y2: 50,
      width: 20,
    });
    expect(controls.unsafe?.startDistance).toBeUndefined();
    expect(controls.unsafe?.endDistance).toBeUndefined();
    expect(controls.unsafe?.x1).toBeUndefined();
  });
});

describe('spokesUrl', () => {
  it('uses streamUrl when present, rewriting http to ws', () => {
    const r: RadarInfo = {
      ...radar,
      streamUrl: 'http://boat.local/signalk/v2/api/vessels/self/radars/nav1034A/stream',
    };
    expect(spokesUrl('http://boat.local', r)).toBe(
      'ws://boat.local/signalk/v2/api/vessels/self/radars/nav1034A/stream',
    );
  });

  it('preserves a streamUrl that is already a ws:// URL', () => {
    expect(spokesUrl('http://boat.local', radar)).toBe(radar.streamUrl);
  });

  it('falls back to the built-in /stream path when streamUrl is absent', () => {
    const r: RadarInfo = { ...radar, streamUrl: undefined };
    expect(spokesUrl('http://boat.local', r)).toBe(`ws://boat.local${RADARS_PATH}/nav1034A/stream`);
  });

  it('reuses the origin scheme for the built-in path', () => {
    const r: RadarInfo = { ...radar, streamUrl: undefined };
    // origin uses http, so the built-in path starts with http before replacement
    const url = spokesUrl('http://boat.local', r);
    expect(url.startsWith('ws://')).toBe(true);
  });

  it('appends the token as a query param on the built-in same-origin path', () => {
    const r: RadarInfo = { ...radar, streamUrl: undefined };
    expect(spokesUrl('http://boat.local', r, 'tok 1')).toBe(
      `ws://boat.local${RADARS_PATH}/nav1034A/stream?token=tok%201`,
    );
  });

  it('appends the token to a same-origin provider streamUrl', () => {
    const r: RadarInfo = {
      ...radar,
      streamUrl: 'http://boat.local/signalk/v2/api/vessels/self/radars/nav1034A/stream',
    };
    expect(spokesUrl('http://boat.local', r, 'tok')).toBe(
      'ws://boat.local/signalk/v2/api/vessels/self/radars/nav1034A/stream?token=tok',
    );
  });

  it('appends the token to same-endpoint ws and wss provider URLs', () => {
    expect(spokesUrl('http://boat.local', radar, 'tok')).toBe(
      'ws://boat.local/signalk/v2/api/vessels/self/radars/nav1034A/stream?token=tok',
    );
    expect(
      spokesUrl(
        'https://boat.local:3443',
        { ...radar, streamUrl: 'wss://boat.local:3443/radar/stream' },
        'tok',
      ),
    ).toBe('wss://boat.local:3443/radar/stream?token=tok');
  });

  it('does not send the token across ports or transport security families', () => {
    expect(
      spokesUrl(
        'http://boat.local:3000',
        { ...radar, streamUrl: 'ws://boat.local:3001/radar/stream' },
        'tok',
      ),
    ).toBe('ws://boat.local:3001/radar/stream');
    expect(
      spokesUrl(
        'https://boat.local',
        { ...radar, streamUrl: 'ws://boat.local:80/radar/stream' },
        'tok',
      ),
    ).toBe('ws://boat.local/radar/stream');
  });

  it('never leaks the token to a cross-origin provider streamUrl', () => {
    const r: RadarInfo = { ...radar, streamUrl: 'ws://other.host:6502/stream' };
    expect(spokesUrl('http://boat.local', r, 'tok')).toBe('ws://other.host:6502/stream');
  });

  it('resolves a relative provider stream URL against the Signal K origin', () => {
    const r: RadarInfo = { ...radar, streamUrl: '/radar/nav1034A/stream' };
    expect(spokesUrl('https://boat.local', r, 'tok')).toBe(
      'wss://boat.local/radar/nav1034A/stream?token=tok',
    );
  });

  it('rejects provider stream credentials and fragments', () => {
    expect(() =>
      spokesUrl('https://boat.local', {
        ...radar,
        streamUrl: 'wss://user:pass@boat.local/radar',
      }),
    ).toThrow(/credentials/);
    expect(() => spokesUrl('https://boat.local', { ...radar, streamUrl: '/radar#secret' })).toThrow(
      /fragment/,
    );
  });
});

function capabilitiesResponse(controls: Record<string, unknown>): () => Promise<Response> {
  return async () => new Response(JSON.stringify({ controls }), { status: 200 });
}

describe('fetchCapabilities', () => {
  it('parses the object-keyed capabilities map into control definitions', async () => {
    // The radar API serves `controls` as an object keyed by control id, each carrying a `dataType`
    // and flat minValue/maxValue/stepValue/units, with `hasAuto` for an automatic mode.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        capabilitiesResponse({
          gain: {
            id: 4,
            name: 'Gain',
            dataType: 'number',
            minValue: 0,
            maxValue: 100,
            stepValue: 1,
            hasAuto: true,
          },
          rain: { id: 6, name: 'Rain Clutter', dataType: 'number', minValue: 0, maxValue: 100 },
        }),
      ),
    );
    const caps = await fetchCapabilities('http://boat.local', undefined, 'nav1034A');
    expect(caps?.controls.map((c) => c.id)).toEqual(['gain', 'rain']);
    const gain = caps?.controls.find((c) => c.id === 'gain');
    expect(gain?.type).toBe('number');
    expect(gain?.range).toEqual({ min: 0, max: 100, step: 1 });
    expect(gain?.modes).toEqual(['auto', 'manual']);
    expect(caps?.controls.find((c) => c.id === 'rain')?.modes).toBeUndefined();
  });

  it('parses an enum control from descriptions, restricted to validValues', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        capabilitiesResponse({
          mode: {
            id: 1,
            name: 'Mode',
            dataType: 'enum',
            descriptions: { '0': 'Harbor', '1': 'Offshore', '2': 'Bird' },
            validValues: [0, 1],
          },
        }),
      ),
    );
    const caps = await fetchCapabilities('http://boat.local', undefined, 'nav1034A');
    const mode = caps?.controls.find((c) => c.id === 'mode');
    expect(mode?.type).toBe('enum');
    expect(mode?.values).toEqual([
      { value: 0, label: 'Harbor' },
      { value: 1, label: 'Offshore' },
    ]);
  });

  it('keeps every supported Radar API control schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        capabilitiesResponse({
          gain: { id: 4, name: 'Gain', dataType: 'number', minValue: 0, maxValue: 100 },
          noTransmit: {
            id: 35,
            name: 'No Transmit',
            dataType: 'sector',
            minValue: -3.14,
            maxValue: 3.14,
          },
          clear: { id: 15, name: 'Clear trails', dataType: 'button' },
          label: { id: 53, name: 'Custom name', dataType: 'string' },
        }),
      ),
    );
    const caps = await fetchCapabilities('http://boat.local', undefined, 'nav1034A');
    expect(caps?.controls.map((c) => c.id)).toEqual(['gain', 'noTransmit', 'clear', 'label']);
  });

  it('marks native radar-area capabilities with their complete bounds and dialect', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        capabilitiesResponse({
          guardZone1: {
            name: 'Guard zone 1',
            dataType: 'zone',
            minValue: -Math.PI,
            maxValue: Math.PI,
            stepValue: Math.PI / 180,
            units: 'rad',
            maxDistance: 100_000,
            hasEnabled: true,
          },
          noTransmitSector1: {
            name: 'No-transmit sector 1',
            dataType: 'sector',
            minValue: -Math.PI,
            maxValue: Math.PI,
            stepValue: Math.PI / 180,
            units: 'rad',
            hasEnabled: true,
          },
          exclusionRect1: {
            name: 'Exclusion rectangle 1',
            dataType: 'rect',
            minValue: 0,
            maxValue: 100_000,
            units: 'm',
            maxDistance: 100_000,
            hasEnabled: true,
          },
        }),
      ),
    );
    const controls = (await fetchCapabilities('http://boat.local', undefined, 'nav1034A'))
      ?.controls;
    const zone = controls?.find((control) => control.id === 'guardZone1');
    expect(zone).toMatchObject({
      dialect: 'native',
      type: 'zone',
      hasEnabled: true,
      maxDistance: 100_000,
      range: { min: -Math.PI, max: Math.PI, step: Math.PI / 180, unit: 'rad' },
    });
    expect(controls?.find((control) => control.id === 'noTransmitSector1')).toMatchObject({
      dialect: 'native',
      type: 'sector',
      hasEnabled: true,
      range: { min: -Math.PI, max: Math.PI, step: Math.PI / 180, unit: 'rad' },
    });
    expect(controls?.find((control) => control.id === 'exclusionRect1')).toMatchObject({
      dialect: 'native',
      type: 'rect',
      hasEnabled: true,
      maxDistance: 100_000,
      range: { min: 0, max: 100_000, unit: 'm' },
    });
  });

  it('marks an isReadOnly control read-only', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        capabilitiesResponse({
          txTime: {
            id: 47,
            name: 'Transmit time',
            dataType: 'number',
            minValue: 0,
            maxValue: 100,
            isReadOnly: true,
          },
        }),
      ),
    );
    const caps = await fetchCapabilities('http://boat.local', undefined, 'nav1034A');
    expect(caps?.controls[0].readOnly).toBe(true);
  });

  it('returns undefined on a 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );
    expect(await fetchCapabilities('http://boat.local', undefined, 'nav1034A')).toBeUndefined();
  });

  it('returns undefined when fetch throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network failure');
      }),
    );
    expect(await fetchCapabilities('http://boat.local', undefined, 'nav1034A')).toBeUndefined();
  });

  it('collapses a malformed control range to undefined', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        capabilitiesResponse({
          gain: { id: 4, name: 'Gain', dataType: 'number', minValue: 'x', maxValue: 100 },
        }),
      ),
    );
    const caps = await fetchCapabilities('http://boat.local', undefined, 'nav1034A');
    expect(caps?.controls[0].range).toBeUndefined();
  });

  it('parses the ControlDefinitionV5 array shape (server-api dialect)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              controls: [
                {
                  id: 'gain',
                  name: 'Gain',
                  type: 'number',
                  range: { min: 0, max: 100, step: 1, unit: '%' },
                  modes: ['auto', 'manual'],
                },
                {
                  id: 'power',
                  name: 'Power',
                  type: 'enum',
                  values: [
                    { value: 1, label: 'Standby' },
                    { value: 2, label: 'Transmit' },
                  ],
                },
                { id: 'zone', name: 'Guard zone', type: 'compound' },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const caps = await fetchCapabilities('http://boat.local', undefined, 'r');
    expect(caps?.controls.map((c) => c.id)).toEqual(['gain', 'power', 'zone']);
    const gain = caps?.controls.find((c) => c.id === 'gain');
    expect(gain?.dialect).toBe('v5');
    expect(gain?.range).toEqual({ min: 0, max: 100, step: 1, unit: '%' });
    expect(gain?.modes).toEqual(['auto', 'manual']);
    expect(caps?.controls.find((c) => c.id === 'power')?.values).toEqual([
      { value: 1, label: 'Standby' },
      { value: 2, label: 'Transmit' },
    ]);
  });

  it('normalizes repeated v5 control ids and typed enum identities', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              controls: [
                { id: 'gain', name: 'Gain', type: 'number' },
                { id: 'gain', name: 'Gain', type: 'number' },
                { id: 'conflict', name: 'First', type: 'number' },
                { id: 'conflict', name: 'Second', type: 'number' },
                {
                  id: 'mode',
                  name: 'Mode',
                  type: 'enum',
                  values: [
                    { value: 1, label: 'Numeric' },
                    { value: '1', label: 'String' },
                    { value: '1', label: 'String' },
                    { value: 2, label: 'First label' },
                    { value: 2, label: 'Conflicting label' },
                  ],
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );

    const controls = (await fetchCapabilities('http://boat.local', undefined, 'r'))?.controls;
    expect(controls?.map(({ id }) => id)).toEqual(['gain', 'mode']);
    expect(controls?.find(({ id }) => id === 'mode')?.values).toEqual([
      { value: 1, label: 'Numeric' },
      { value: '1', label: 'String' },
    ]);
  });
});

describe('setPower', () => {
  it('PUTs the status string to the dedicated /power endpoint', async () => {
    let url = '';
    let body: unknown;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string, init: RequestInit) => {
        url = u;
        body = JSON.parse(init.body as string);
        return new Response('', { status: 200 });
      }),
    );
    const result = await setPower('http://boat.local', 'tok', 'nav1034A', 'transmit');
    expect(result.ok).toBe(true);
    expect(url).toBe(`http://boat.local${RADARS_PATH}/nav1034A/power`);
    expect(body).toEqual({ value: 'transmit' });
  });

  it('falls back to the generic control path with the numeric index on a 404', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string, init: RequestInit) => {
        calls.push({ url: u, body: JSON.parse(init.body as string) });
        return new Response('', { status: u.includes('/controls/') ? 200 : 404 });
      }),
    );
    const result = await setPower('http://boat.local', 'tok', 'nav1034A', 'standby');
    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe(`http://boat.local${RADARS_PATH}/nav1034A/power`);
    expect(calls[1].url).toBe(`http://boat.local${RADARS_PATH}/nav1034A/controls/power`);
    expect(calls[1].body).toEqual({ value: 1 });
  });

  it('returns ok false and the status on a 403 from the dedicated endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 403 })),
    );
    const result = await setPower('http://boat.local', 'tok', 'nav1034A', 'transmit');
    expect(result).toEqual({ ok: false, status: 403 });
  });
});

describe('fetchRadarControls', () => {
  it('parses control values from the standard controls endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              controls: { gain: { value: 42, auto: true }, range: { value: 1852 } },
            }),
            { status: 200 },
          ),
      ),
    );
    const controls = await fetchRadarControls('http://boat.local', undefined, 'nav1034A');
    expect(controls?.gain?.value).toBe(42);
    expect(controls?.gain?.auto).toBe(true);
    expect(controls?.range?.value).toBe(1852);
  });

  it('returns undefined on a non-object body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('null', { status: 200 })),
    );
    expect(await fetchRadarControls('http://boat.local', undefined, 'r')).toBeUndefined();
  });
});

describe('capabilitiesFromControls', () => {
  it('synthesizes numeric control definitions from a discovery, with auto where reported', () => {
    const defs = capabilitiesFromControls({
      ...radar,
      controls: { gain: { value: 28, auto: true }, sea: { value: 10 } },
    });
    expect(defs.map((d) => d.id)).toEqual(['gain', 'sea']);
    expect(defs.every((d) => d.type === 'number')).toBe(true);
    expect(defs.every((d) => d.readOnly)).toBe(true);
    expect(defs.find((d) => d.id === 'gain')?.modes).toEqual(['auto', 'manual']);
    expect(defs.find((d) => d.id === 'sea')?.modes).toBeUndefined();
  });
});

describe('writeControl', () => {
  it('PUTs { value } to the single control path and returns ok true on 200', async () => {
    let capturedUrl = '';
    let capturedBody: unknown;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedBody = JSON.parse(init.body as string);
        return new Response('', { status: 200 });
      }),
    );
    const result = await writeControl('http://boat.local', undefined, 'nav1034A', 'gain', {
      value: 50,
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(capturedUrl).toBe(`http://boat.local${RADARS_PATH}/nav1034A/controls/gain`);
    expect(capturedBody).toEqual({ value: 50 });
  });

  it('PUTs { auto } with no value so the server does not drop the auto flag', async () => {
    let capturedBody: unknown;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        capturedBody = JSON.parse(init.body as string);
        return new Response('', { status: 200 });
      }),
    );
    await writeControl('http://boat.local', undefined, 'nav1034A', 'gain', { auto: true });
    expect(capturedBody).toEqual({ auto: true });
  });

  it('returns ok false and the status code on a 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 403 })),
    );
    const result = await writeControl('http://boat.local', 'tok', 'nav1034A', 'gain', {
      value: 50,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it('returns ok false and status 0 on a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network failure');
      }),
    );
    const result = await writeControl('http://boat.local', undefined, 'nav1034A', 'gain', {
      value: 50,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
  });

  it('URL-encodes a control id that contains a slash', async () => {
    let capturedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        capturedUrl = url;
        return new Response('', { status: 200 });
      }),
    );
    await writeControl('http://boat.local', undefined, 'nav1034A', 'sector/blank', { value: 10 });
    expect(capturedUrl).toContain('sector%2Fblank');
  });
});

describe('writeStructuredControl', () => {
  it('uses the bulk route so the server and provider preserve the complete zone', async () => {
    let capturedUrl = '';
    let capturedBody: unknown;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedBody = JSON.parse(init.body as string);
        return new Response('', { status: 200 });
      }),
    );
    const zone = {
      value: -1,
      endValue: 1,
      startDistance: 200,
      endDistance: 500,
      enabled: false,
    };
    const result = await writeStructuredControl(
      'http://boat.local',
      undefined,
      'nav1034A',
      'guardZone1',
      zone,
    );
    expect(result).toEqual({ ok: true, status: 200 });
    expect(capturedUrl).toBe('http://boat.local/signalk/v2/api/vessels/self/radars/nav1034A');
    expect(capturedBody).toEqual({ value: { guardZone1: zone } });
  });

  it.each([
    ['noTransmitSector1', { value: -0.5, endValue: 0.75, enabled: true }],
    ['exclusionRect1', { x1: -100, y1: 50, x2: 100, y2: 50, width: 25, enabled: false }],
  ])('preserves every field of native %s values in the bulk envelope', async (controlId, value) => {
    let capturedBody: unknown;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        capturedBody = JSON.parse(init.body as string);
        return new Response('', { status: 200 });
      }),
    );

    const result = await writeStructuredControl(
      'http://boat.local',
      undefined,
      'nav1034A',
      controlId,
      value,
    );

    expect(result).toEqual({ ok: true, status: 200 });
    expect(capturedBody).toEqual({ value: { [controlId]: value } });
  });
});
