import type { AisTargets } from '$entities/ais';
import { latLonToLonLat } from '$shared/geo';
import { headingDegrees } from '$shared/lib';
import {
  createSymbolOverlay,
  featureCollection,
  mapThemePaint,
  type Rgba,
  type SymbolOverlay,
} from '$shared/map';
import { AIS_ICON_ID, aisIconImage } from './ais-icon';
import { createAisRefreshGate } from './ais-refresh';

const SOURCE_ID = 'binnacle-ais';
const LAYER_ID = 'binnacle-ais-symbol';
// The transient color shown for the single frame before the first recolor; taken from the day theme
// so there is one source for the day AIS color rather than a literal that could drift.
const DEFAULT_COLOR: Rgba = mapThemePaint('day').aisTarget;

// Purely presentational: stale-target expiry lives on an app-level timer (store.pruneAis with the
// entities/ais TTL), never in this render path, which pauses in a hidden tab while the collision
// math keeps consuming the store.
export function createAisOverlay(targets: AisTargets, now: () => number = Date.now): SymbolOverlay {
  const gate = createAisRefreshGate(targets, now);

  function buildFeatures(): GeoJSON.FeatureCollection {
    return featureCollection(
      targets.list().map((target) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: latLonToLonLat(target.position),
        },
        properties: {
          id: target.id,
          name: target.name ?? '',
          heading: headingDegrees(target.headingRad, target.cogRad),
        },
      })),
    );
  }

  return createSymbolOverlay({
    id: 'ais',
    title: 'AIS targets',
    description: 'Other vessels broadcasting their position over AIS.',
    band: 'traffic',
    sourceId: SOURCE_ID,
    layerId: LAYER_ID,
    iconId: AIS_ICON_ID,
    iconImage: aisIconImage,
    defaultColor: DEFAULT_COLOR,
    paintColor: (paint) => paint.aisTarget,
    features: buildFeatures,
    shouldRefresh: () => gate.shouldRefresh(),
  });
}
