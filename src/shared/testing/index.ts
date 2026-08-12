// Named re-exports only, the same rule every other slice barrel follows: a wildcard hides what the
// harness actually offers, so a test re-rolls a fake it already has rather than finding it here.
export { expectCatalogFacts } from './catalog-facts';
export { createFakeAlarmControl } from './fake-alarm';
export { failingIdbFactory, fakeIdbFactory } from './fake-idb';
export {
  createFakeMap,
  declaredSource,
  type FakeMap,
  fakeOverlayContext,
  sourceFeatures,
} from './fake-map';
export { createFakeStorage } from './fake-storage';
export { fakeVesselFix } from './fake-vessel';
export { FakeWebSocket } from './fake-websocket';
export { expectBearerAuth, jsonResponse, stubFetch } from './fetch-stub';
export { attribute, tag } from './markup';
export { createFrameFactory } from './sk-frame';
