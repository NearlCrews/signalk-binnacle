import type { SKFrame } from '$shared/signalk';

// Test-only SKFrame builder with an advancing epoch, so consumers that dedupe work per fix by
// epoch (the anchor watch) see each frame as a new fix. The optional second argument carries AIS
// vessels as plain path-to-value records, so an AIS test does not hand-build the nested maps.
// Imported by *.test.ts files only.
export function createFrameFactory(start = 1000) {
  let epoch = start;
  return (
    self: Record<string, unknown>,
    ais?: Record<string, Record<string, unknown>>,
  ): SKFrame => {
    epoch += 1000;
    const frame: SKFrame = {
      self: new Map(Object.entries(self)) as SKFrame['self'],
      connection: { phase: 'open', attempt: 0 },
      epoch,
    };
    if (ais) {
      frame.ais = new Map(
        Object.entries(ais).map(([id, paths]) => [id, new Map(Object.entries(paths))]),
      ) as SKFrame['ais'];
    }
    return frame;
  };
}
