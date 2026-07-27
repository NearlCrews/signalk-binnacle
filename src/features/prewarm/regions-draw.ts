/** A panel-scoped Terra Draw instance with only the rectangle mode, separate from the route
 * editor's instance (which uses prefixId 'binnacle-route-draw') so the two never conflict.
 * Emits the drawn box as a [minLng, minLat, maxLng, maxLat] tuple on finish. */

import type { Map as MapLibreMap } from 'maplibre-gl';
import type { LngLatBbox } from 'signalk-chart-sources';
import { type GeoJSONStoreFeatures, TerraDraw, TerraDrawRectangleMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import { bboxFromRectangle, rectangleRingFromBbox } from './estimate.js';

export interface RegionRectangle {
  start(): void;
  set(bbox: LngLatBbox): void;
  clear(): void;
  onFinish(cb: (bbox: LngLatBbox | null) => void): void;
  destroy(): void;
}

export function createRegionRectangle(map: MapLibreMap): RegionRectangle {
  const draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map, prefixId: 'chart-locker-region-draw' }),
    modes: [new TerraDrawRectangleMode({ drawInteraction: 'click-move-or-drag' })],
  });

  let onFinishCb: (bbox: LngLatBbox | null) => void = () => {};
  let started = false;

  const onFinish = (id: string | number): void => {
    const feature = draw.getSnapshotFeature(id);
    if (feature?.geometry.type !== 'Polygon') {
      onFinishCb(null);
      return;
    }
    const ring = (feature.geometry.coordinates as number[][][])[0].map(
      (p) => [p[0], p[1]] as [number, number],
    );
    try {
      onFinishCb(bboxFromRectangle(ring));
    } catch (cause) {
      if (!(cause instanceof TypeError || cause instanceof RangeError)) throw cause;
      onFinishCb(null);
    }
  };
  draw.on('finish', onFinish);

  return {
    start() {
      if (!started) {
        draw.start();
        started = true;
      }
      draw.setMode('rectangle');
    },
    set(bbox) {
      if (!started) {
        draw.start();
        started = true;
      }
      draw.clear();
      const feature: GeoJSONStoreFeatures<GeoJSON.Polygon> = {
        type: 'Feature',
        properties: { mode: 'rectangle' },
        geometry: {
          type: 'Polygon',
          coordinates: [rectangleRingFromBbox(bbox)],
        },
      };
      const [validation] = draw.addFeatures([feature]);
      if (validation && !validation.valid) console.warn('Offline area seed rejected by Terra Draw');
      draw.setMode('rectangle');
    },
    clear() {
      // draw.clear() runs terra-draw's checkEnabled(), which throws when the instance was never
      // started, so guard it with the same started flag start() uses; the null change still fires.
      if (started) draw.clear();
      onFinishCb(null);
    },
    onFinish(cb) {
      onFinishCb = cb;
    },
    destroy() {
      if (started) {
        started = false;
      }
      // Drop the finish listener, mirroring the draw.on('finish', ...) registration above.
      draw.off('finish', onFinish);
      // draw.stop() calls adapter.unregister() which removes all prefixed MapLibre sources and
      // layers. It is a no-op when the instance was never started (_enabled=false), so calling
      // it unconditionally is safe and ensures teardown always runs.
      draw.stop();
    },
  };
}
