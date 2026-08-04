import type * as maplibregl from 'maplibre-gl';

// A touch long-press that holds still this long, and within this pixel slop, stands in for the
// contextmenu event that touch browsers do not reliably fire.
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_PX = 10;

export interface ContextMenuPoint {
  lng: number;
  lat: number;
  x: number;
  y: number;
}

export interface ContextMenuHandle {
  // Cancel any in-flight long-press timer, so a single press cannot emit twice.
  cancel: () => void;
  // Detach the map contextmenu handler and the canvas pointer listeners on destroy, so a re-install on
  // the same map (a base-style swap keeps the map) cannot stack a second contextmenu handler and
  // double-emit, and the closures do not keep the map instance alive after teardown.
  remove: () => void;
}

// A right-click or long-press at a point, surfaced for the "go to here" menu. The desktop path is
// MapLibre's own contextmenu event; touch browsers do not all fire it, so a still-held finger past
// a timeout (canceled by movement, lift, or a second touch) synthesizes the same emit.
export function installContextMenu(
  map: maplibregl.Map,
  emit: (point: ContextMenuPoint) => void,
): ContextMenuHandle {
  const canvas = map.getCanvas();
  let pressTimer = 0;
  let startX = 0;
  let startY = 0;
  const cancel = () => {
    if (!pressTimer) return;
    clearTimeout(pressTimer);
    pressTimer = 0;
  };
  const onContextMenu = (e: maplibregl.MapMouseEvent) => {
    // Android Chrome fires the native contextmenu for a long press too; cancel the synthesized
    // timer so a single press cannot emit twice.
    cancel();
    emit({ lng: e.lngLat.lng, lat: e.lngLat.lat, x: e.point.x, y: e.point.y });
  };
  map.on('contextmenu', onContextMenu);
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    cancel();
    startX = e.clientX;
    startY = e.clientY;
    pressTimer = window.setTimeout(() => {
      pressTimer = 0;
      const rect = canvas.getBoundingClientRect();
      const x = startX - rect.left;
      const y = startY - rect.top;
      const at = map.unproject([x, y]);
      emit({ lng: at.lng, lat: at.lat, x, y });
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (pressTimer && Math.hypot(e.clientX - startX, e.clientY - startY) > LONG_PRESS_MOVE_PX) {
      cancel();
    }
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', cancel);
  canvas.addEventListener('pointercancel', cancel);
  const onKeyDown = (event: KeyboardEvent) => {
    if (!(event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))) return;
    event.preventDefault();
    const x = canvas.clientWidth / 2;
    const y = canvas.clientHeight / 2;
    const at = map.unproject([x, y]);
    emit({ lng: at.lng, lat: at.lat, x, y });
  };
  canvas.addEventListener('keydown', onKeyDown);
  const remove = () => {
    map.off('contextmenu', onContextMenu);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', cancel);
    canvas.removeEventListener('pointercancel', cancel);
    canvas.removeEventListener('keydown', onKeyDown);
  };
  return { cancel, remove };
}

// The advertised chord list for the keyboard handler above, in aria-keyshortcuts format
// (space-separated alternatives). It lives beside the key test so the chart canvas cannot
// advertise keys this file stopped listening for.
export const CONTEXT_MENU_KEYSHORTCUTS = 'Shift+F10 ContextMenu';
