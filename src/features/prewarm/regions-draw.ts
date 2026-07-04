/** A panel-scoped Terra Draw instance with only the rectangle mode, separate from the route
 * editor's instance (which uses prefixId 'binnacle-route-draw') so the two never conflict.
 * Emits the drawn box as a [minLng, minLat, maxLng, maxLat] tuple on finish. */

import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Bbox } from 'signalk-chart-sources';
import { TerraDraw, TerraDrawRectangleMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import { bboxFromRectangle } from './estimate.js';

export interface RegionRectangle {
  start(): void;
  clear(): void;
  onChange(cb: (bbox: Bbox | null) => void): void;
  destroy(): void;
}

export function createRegionRectangle(map: MapLibreMap): RegionRectangle {
  const draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map, prefixId: 'chart-locker-region-draw' }),
    modes: [new TerraDrawRectangleMode()],
  });

  let onChangeCb: (bbox: Bbox | null) => void = () => {};
  let started = false;

  const onFinish = (): void => {
    const snapshot = draw.getSnapshot();
    const polygon = snapshot.find((f) => f.geometry.type === 'Polygon');
    if (!polygon) {
      onChangeCb(null);
      return;
    }
    const ring = (polygon.geometry.coordinates as number[][][])[0].map(
      (p) => [p[0], p[1]] as [number, number],
    );
    onChangeCb(bboxFromRectangle(ring));
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
    clear() {
      // draw.clear() runs terra-draw's checkEnabled(), which throws when the instance was never
      // started, so guard it with the same started flag start() uses; the null change still fires.
      if (started) draw.clear();
      onChangeCb(null);
    },
    onChange(cb) {
      onChangeCb = cb;
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
