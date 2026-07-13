export type { CpaResult, Kinematics } from './cpa';
export { computeCpa } from './cpa';
export {
  EARTH_RADIUS_M,
  geodesicCircleRing,
  geodesicDestination,
  haversineMeters,
  METERS_PER_DEG,
  normalizeLonDeltaDeg,
} from './distance';
export {
  etaSeconds,
  rhumbBearingRad,
  rhumbCrossTrackErrorMeters,
  rhumbDistanceMeters,
  steerSide,
  vmgMps,
} from './route-geometry';
