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

// The chart reaches the top of the screen, where a status bar or cutout may overlay it and the
// access banner may sit: the arrow keeps clear of both. Both are measured off the render path: the
// inset (an env() expression) through a probe inside the chart when the chart resizes, and the
// banner's height, which the chart host publishes, when that style changes.
function measureTopClearance(): number {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:absolute;visibility:hidden;padding-block-start:calc(var(--chrome-inset-top) + var(--auth-banner-height, 0px))';
  map.getContainer().append(probe);
  const clearance = Number.parseFloat(getComputedStyle(probe).paddingBlockStart) || 0;
  probe.remove();
  return clearance;
}
let topClearance = 0;

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
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  // The clear rectangle the arrow may sit in: inset from every edge, and below the top clearance.
  const left = EDGE_INSET;
  const right = width - EDGE_INSET;
  const top = EDGE_INSET + topClearance;
  const bottom = height - EDGE_INSET;
  if (right <= left || bottom <= top) {
    visible = false;
    return;
  }
  const point = map.project(latLonToLonLat(pos));
  bearingDeg = (Math.atan2(point.x - width / 2, -(point.y - height / 2)) * 180) / Math.PI;
  // Clamp the true (possibly far off-canvas) point to that rectangle along the line from its
  // center, so the arrow sits at the edge closest to the vessel.
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const dx = point.x - centerX;
  const dy = point.y - centerY;
  const scale = Math.min(
    1,
    dx !== 0 ? Math.abs((right - centerX) / dx) : Number.POSITIVE_INFINITY,
    dy !== 0 ? Math.abs((bottom - centerY) / dy) : Number.POSITIVE_INFINITY,
  );
  x = centerX + dx * scale;
  y = centerY + dy * scale;
  visible = true;
}

// The map instance is a stable prop for this component's lifetime, so these listeners are
// registered once; recompute also runs on every repaint (pan and zoom), matching the cadence
// overlay-tick.ts already drives every GL-layer overlay from.
$effect(() => {
  const remeasure = (): void => {
    topClearance = measureTopClearance();
    recompute();
  };
  topClearance = measureTopClearance();
  const container = map.getContainer();
  const resize = new ResizeObserver(remeasure);
  resize.observe(container);
  // Whichever ancestor publishes the banner's height, watched for that style changing.
  let host = container.parentElement;
  while (host && !host.style.getPropertyValue('--auth-banner-height')) host = host.parentElement;
  const banner = new MutationObserver(remeasure);
  if (host) banner.observe(host, { attributes: true, attributeFilter: ['style'] });
  map.on('render', recompute);
  return () => {
    resize.disconnect();
    banner.disconnect();
    map.off('render', recompute);
  };
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
    class="icon-pill icon-pill--float off-screen-indicator"
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
/* A stale fix reads in the caution tone, matching the status strip's last-fix cell. */
.off-screen-indicator--stale {
  color: var(--warning);
  border-color: var(--warning);
}
</style>
