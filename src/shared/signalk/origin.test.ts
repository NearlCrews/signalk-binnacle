import { describe, expect, it } from 'vitest';
import { isInsecureTransportOrigin } from './origin';

describe('isInsecureTransportOrigin', () => {
  it('warns for non-loopback HTTP origins', () => {
    expect(isInsecureTransportOrigin('http://boat.local:3000')).toBe(true);
    expect(isInsecureTransportOrigin('http://192.168.1.10')).toBe(true);
  });

  it('does not warn for HTTPS, loopback, or malformed origins', () => {
    expect(isInsecureTransportOrigin('https://boat.local')).toBe(false);
    expect(isInsecureTransportOrigin('http://localhost:3000')).toBe(false);
    expect(isInsecureTransportOrigin('http://chart.localhost:3000')).toBe(false);
    expect(isInsecureTransportOrigin('http://localhost.:3000')).toBe(false);
    expect(isInsecureTransportOrigin('http://127.0.0.1:3000')).toBe(false);
    expect(isInsecureTransportOrigin('http://127.0.0.2:3000')).toBe(false);
    expect(isInsecureTransportOrigin('http://[::1]:3000')).toBe(false);
    expect(isInsecureTransportOrigin('not an origin')).toBe(false);
  });
});
