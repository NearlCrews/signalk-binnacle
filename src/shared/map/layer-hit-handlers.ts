import type { MapLayerMouseEvent } from 'maplibre-gl';
import type { OverlayContext } from './types';

export interface LayerHitHandlers {
  attach(ctx: OverlayContext): void;
  detach(ctx: OverlayContext): void;
}

export function createLayerHitHandlers(
  layerId: string,
  onClick: (event: MapLayerMouseEvent) => void,
): LayerHitHandlers {
  let attachedContext: OverlayContext | undefined;
  const onEnter = (): void => {
    if (attachedContext) attachedContext.map.getCanvas().style.cursor = 'pointer';
  };
  const onLeave = (): void => {
    if (attachedContext) attachedContext.map.getCanvas().style.cursor = '';
  };

  return {
    attach(ctx) {
      if (attachedContext) return;
      attachedContext = ctx;
      ctx.map.on('click', layerId, onClick);
      ctx.map.on('mouseenter', layerId, onEnter);
      ctx.map.on('mouseleave', layerId, onLeave);
    },
    detach() {
      if (!attachedContext) return;
      attachedContext.map.off('click', layerId, onClick);
      attachedContext.map.off('mouseenter', layerId, onEnter);
      attachedContext.map.off('mouseleave', layerId, onLeave);
      if (attachedContext.map.getCanvas().style.cursor === 'pointer') {
        attachedContext.map.getCanvas().style.cursor = '';
      }
      attachedContext = undefined;
    },
  };
}
