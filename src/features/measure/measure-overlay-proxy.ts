import type { MeasureStore } from '$entities/measure';
import type { UnitsMode } from '$shared/lib';
import { createRetryableLazyLoader } from '$shared/lib';
import type { MeasureOverlay } from './measure-overlay';
import { MEASURE_LAYER_IDS, MEASURE_OVERLAY_ID } from './measure-overlay-contract';

const loadMeasureOverlay = createRetryableLazyLoader(() => import('./measure-overlay'));

// Keep the expanded editing renderer out of the main application chunk. The layer manager awaits
// add(), so failure retains its normal supporting-overlay reporting and every later method delegates
// only after the real overlay is ready.
export function createMeasureOverlay(
  measure: MeasureStore,
  units: { mode: UnitsMode },
): MeasureOverlay {
  let delegate: MeasureOverlay | undefined;
  let generation = 0;

  return {
    id: MEASURE_OVERLAY_ID,
    title: 'Measure',
    band: 'routes',
    listed: false,
    supportsOpacity: true,
    layerIds: MEASURE_LAYER_IDS,
    async add(ctx) {
      if (delegate) {
        await delegate.add(ctx);
        return;
      }
      const current = ++generation;
      const module = await loadMeasureOverlay();
      if (current !== generation) return;
      const next = module.createMeasureOverlay(measure, units);
      await next.add(ctx);
      if (current !== generation) {
        next.remove(ctx);
        return;
      }
      delegate = next;
    },
    reset() {
      delegate?.reset?.();
    },
    sync(ctx) {
      delegate?.sync(ctx);
    },
    hitTestVertex(point) {
      return delegate?.hitTestVertex(point);
    },
    consumeTrailingClick() {
      return delegate?.consumeTrailingClick() ?? false;
    },
    cancelInteraction() {
      delegate?.cancelInteraction();
    },
    setVisible(ctx, visible) {
      delegate?.setVisible(ctx, visible);
    },
    setOpacity(ctx, opacity) {
      delegate?.setOpacity?.(ctx, opacity);
    },
    applyTheme(ctx, paint) {
      delegate?.applyTheme?.(ctx, paint);
    },
    remove(ctx) {
      generation += 1;
      delegate?.remove(ctx);
      delegate = undefined;
    },
  };
}
