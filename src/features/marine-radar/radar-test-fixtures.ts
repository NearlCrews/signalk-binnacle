import type { RadarInfo } from './radar-types';

// Test-only RadarInfo fixture shared by the marine-radar suites. Imported by *.test.ts files, never
// by production code.
//
// Each call returns a fresh object, including a fresh controls map: the store writes reconciled
// controls back onto the RadarInfo it was handed, so a fixture shared across tests would carry one
// test's reconcile into the next.
export function makeRadar(overrides: Partial<RadarInfo> = {}): RadarInfo {
  return {
    id: 'a',
    name: 'A',
    status: 'standby',
    spokesPerRevolution: 2048,
    maxSpokeLen: 1024,
    range: 1852,
    controls: { gain: { value: 50 } },
    ...overrides,
  };
}
