import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubFetch } from '$shared/testing';
import { NO_ANCHOR_TRANSPORT, resolveAnchorTransport } from './anchor-transport';

const BASE = 'https://boat.example';
const API = `${BASE}/signalk/v2/api/vessels/self/navigation/anchor`;
const PLUGIN = `${BASE}/plugins/anchoralarm`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveAnchorTransport', () => {
  it('picks the standard API when the features endpoint advertises it', async () => {
    const mock = stubFetch({ ok: true });
    const transport = resolveAnchorTransport(BASE, () => 'tok', { standardApiAvailable: true });
    expect(transport.kind).toBe('standard');
    await expect(transport.raise()).resolves.toBe(true);
    await transport.setRadius(75);
    await transport.setPosition({ latitude: 1.5, longitude: -2.5 });
    await transport.reposition?.(40, 8);
    const urls = mock.mock.calls.map((call) => call[0]);
    expect(urls).toEqual([
      `${API}/raise`,
      `${API}/radius`,
      `${BASE}/signalk/v1/api/vessels/self/navigation/anchor/position`,
      `${API}/reposition`,
    ]);
  });

  it('standard drop posts drop then the radius', async () => {
    const mock = stubFetch({ ok: true });
    const transport = resolveAnchorTransport(BASE, () => 'tok', { standardApiAvailable: true });
    await expect(transport.drop(45)).resolves.toBe(true);
    const urls = mock.mock.calls.map((call) => call[0]);
    expect(urls).toEqual([`${API}/drop`, `${API}/radius`]);
    const radiusInit = mock.mock.calls[1][1];
    expect(JSON.parse(radiusInit?.body as string)).toEqual({ value: 45 });
  });

  it('standard drop fails without attempting the radius when the drop is refused', async () => {
    const mock = stubFetch({ ok: false });
    const transport = resolveAnchorTransport(BASE, () => undefined, { standardApiAvailable: true });
    await expect(transport.drop(45)).resolves.toBe(false);
    expect(mock.mock.calls.map((call) => call[0])).toEqual([`${API}/drop`]);
  });

  it('standard drop still succeeds when only the radius call fails', async () => {
    stubFetch((url) => ({ ok: !url.endsWith('/radius') }));
    const transport = resolveAnchorTransport(BASE, () => undefined, { standardApiAvailable: true });
    await expect(transport.drop(45)).resolves.toBe(true);
  });

  it('falls back to the plugin endpoints when the standard API is absent', async () => {
    const mock = stubFetch({ ok: true });
    const transport = resolveAnchorTransport(BASE, () => 'tok', { standardApiAvailable: false });
    expect(transport.kind).toBe('plugin');
    expect(transport.reposition).toBeUndefined();
    await expect(transport.drop(45)).resolves.toBe(true);
    await transport.setRadius(60);
    await transport.raise();
    await transport.setPosition({ latitude: 1.5, longitude: -2.5 });
    const urls = mock.mock.calls.map((call) => call[0]);
    expect(urls).toEqual([
      `${PLUGIN}/dropAnchor`,
      `${PLUGIN}/setRadius`,
      `${PLUGIN}/raiseAnchor`,
      `${BASE}/signalk/v1/api/vessels/self/navigation/anchor/position`,
    ]);
    expect(JSON.parse(mock.mock.calls[0][1]?.body as string)).toEqual({ radius: 45 });
  });

  it('the none transport refuses every action without touching the network', async () => {
    const mock = stubFetch({ ok: true });
    expect(NO_ANCHOR_TRANSPORT.kind).toBe('none');
    await expect(NO_ANCHOR_TRANSPORT.drop(45)).resolves.toBe(false);
    await expect(NO_ANCHOR_TRANSPORT.raise()).resolves.toBe(false);
    await expect(NO_ANCHOR_TRANSPORT.setRadius(60)).resolves.toBe(false);
    await expect(NO_ANCHOR_TRANSPORT.setPosition({ latitude: 1.5, longitude: -2.5 })).resolves.toBe(
      false,
    );
    expect(mock).not.toHaveBeenCalled();
  });
});
