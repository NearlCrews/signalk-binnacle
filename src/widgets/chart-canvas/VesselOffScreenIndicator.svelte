<script lang="ts">
import Navigation from '@lucide/svelte/icons/navigation';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { bboxContainsPoint, type LatLon, latLonToLonLat, lngLatBoundsToBbox4 } from '$shared/geo';

interface Props {
  map: MapLibreMap;
  position: LatLon | undefined;
  // The fix is stale: the arrow still points at the LAST fix, and the action must say so instead
  // of promising to center on a vessel whose position is no longer known.
  positionStale?: boolean;
  onCenter: () => void;
}

const { map, position, positionStale = false, onCenter }: Props = $props();

// Keeps the arrow's whole hit target inside the canvas, never clipped at the edge.
const EDGE_INSET = 28;

let visible = $state(false);
let x = $state(0);
let y = $state(0);
let bearingDeg = $state(0);

function recompute(): void {
  const pos = position;
  if (!pos || bboxContainsPoint(lngLatBoundsToBbox4(map.getBounds()), pos)) {
    visible = false;
    return;
  }
  const canvas = map.getCanvas();
  const centerX = canvas.clientWidth / 2;
  const centerY = canvas.clientHeight / 2;
  const point = map.project(latLonToLonLat(pos));
  const dx = point.x - centerX;
  const dy = point.y - centerY;
  bearingDeg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  // Clamp the true (possibly far off-canvas) point to the inset canvas rectangle, projected along
  // the line from center to that point, so the arrow sits at the edge closest to the vessel.
  const halfW = centerX - EDGE_INSET;
  const halfH = centerY - EDGE_INSET;
  const scale = Math.min(
    dx !== 0 ? Math.abs(halfW / dx) : Number.POSITIVE_INFINITY,
    dy !== 0 ? Math.abs(halfH / dy) : Number.POSITIVE_INFINITY,
  );
  x = centerX + dx * scale;
  y = centerY + dy * scale;
  visible = true;
}

// The map instance is a stable prop for this component's lifetime, so this listener is registered
// once; recompute also runs on every repaint (pan and zoom), matching the cadence overlay-tick.ts
// already drives every GL-layer overlay from.
$effect(() => {
  map.on('render', recompute);
  return () => map.off('render', recompute);
});

// Vessel position updates over the WebSocket independent of any camera move, so it needs its own
// trigger. The bare read is the dependency: recompute reads the map, not the prop, so without it
// the effect would never rerun on a fix that did not also move the camera.
$effect(() => {
  void position;
  recompute();
});
</script>

{#if visible}
  <button
    type="button"
    class="icon-pill off-screen-indicator"
    class:off-screen-indicator--stale={positionStale}
    style:left="{x}px"
    style:top="{y}px"
    style:rotate="{bearingDeg}deg"
    aria-label={positionStale
      ? 'Last known vessel position is off screen; the GPS fix is stale. Tap to center the chart on the last fix.'
      : 'Vessel is off screen. Tap to center the chart on it.'}
    title={positionStale ? 'Center on last fix (GPS stale)' : 'Center on vessel'}
    onclick={onCenter}
  >
    <Navigation size={18} aria-hidden="true" />
  </button>
{/if}

<style>
/* Rotation is applied via the style:rotate directive so it can vary per frame without a scoped
   style recalculation; translate(-50%, -50%) centers the pill on the clamped point rather than
   the point sitting at its corner. */
.off-screen-indicator {
  position: absolute;
  translate: -50% -50%;
  z-index: var(--z-overlay);
}
/* A stale fix reads in the caution tone, matching the strip's fix-lost treatment. */
.off-screen-indicator--stale {
  color: var(--warning);
  border-color: var(--warning);
}
</style>
